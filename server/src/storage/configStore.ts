import * as fs from 'node:fs';
import { randomUUID } from 'node:crypto';
import { basename, dirname, resolve } from 'node:path';
import { isRecord, isStringRecord, isValidMcpServerConfig, type McpServerConfig } from '../../../shared/types.js';

export type StoredConfig = { version: 2; servers: McpServerConfig[] };
export type ConfigStoreIO = Pick<typeof fs,
  'readFileSync' | 'mkdirSync' | 'openSync' | 'writeFileSync' | 'fsyncSync' |
  'closeSync' | 'renameSync' | 'unlinkSync'>;
export type ConfigStoreOptions = {
  filePath: string;
  /** Overrides only the filesystem operations needed for deterministic failure tests. */
  io?: Partial<ConfigStoreIO>;
  platform?: NodeJS.Platform;
};
export type StoreErrorCode = 'STORE_INVALID' | 'STORE_IO' | 'MIGRATION_REQUIRED' | 'SESSION_ENV_INVALID' | 'NOT_FOUND';
export class ConfigStoreError extends Error {
  constructor(public readonly code: StoreErrorCode, message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = 'ConfigStoreError';
  }
}

/** Versioned metadata on disk; literal environment values live only in this session. */
export class ConfigStore {
  private readonly filePath: string;
  private readonly io: ConfigStoreIO;
  private readonly platform: NodeJS.Platform;
  private cache: McpServerConfig[] | null = null;
  private migrationPending = false;

  constructor(options: ConfigStoreOptions) {
    this.filePath = resolve(options.filePath);
    this.io = { ...fs, ...options.io };
    this.platform = options.platform ?? process.platform;
  }

  list(): McpServerConfig[] {
    this.ensureLoaded();
    return this.cache!.map((config) => {
      const copy = structuredClone(config);
      // Reading a legacy file does not confirm use of its literal secrets.
      if (this.migrationPending) delete copy.env;
      return copy;
    });
  }

  needsMigration(): boolean {
    this.ensureLoaded();
    return this.migrationPending;
  }

  /** Explicit confirmation: rewrite metadata first, then enable legacy session values. */
  migrate(): void {
    this.ensureLoaded();
    if (!this.migrationPending) return;
    this.persist(this.cache!);
    this.migrationPending = false;
  }

  save(servers: McpServerConfig[]): McpServerConfig[] {
    this.assertWritable();
    const next = this.validateServers(servers, false);
    this.persist(next);
    this.cache = next;
    return this.list();
  }

  add(server: McpServerConfig): McpServerConfig {
    this.assertWritable();
    const next = this.validateServers([...this.cache!, server], false);
    this.persist(next);
    this.cache = next;
    return structuredClone(next[next.length - 1]!);
  }

  remove(id: string): boolean {
    this.assertWritable();
    const next = this.cache!.filter((config) => config.id !== id);
    if (next.length === this.cache!.length) return false;
    this.persist(next);
    this.cache = next;
    return true;
  }

  setSessionEnvironment(id: string, env: Record<string, string>): McpServerConfig {
    this.assertWritable();
    const index = this.cache!.findIndex((config) => config.id === id);
    if (index === -1) throw new ConfigStoreError('NOT_FOUND', 'server not found');
    const config = this.cache![index]!;
    const keys = config.sessionEnvKeys ?? [];
    if (!isStringRecord(env) || Object.keys(env).length !== keys.length ||
        !keys.every((key) => Object.hasOwn(env, key))) {
      throw new ConfigStoreError('SESSION_ENV_INVALID', 'provide exactly the configured session environment keys');
    }
    const updated = { ...config, env: structuredClone(env) };
    this.validateServers([updated], false);
    this.cache = this.cache!.map((item, i) => i === index ? updated : item);
    return structuredClone(updated);
  }

  /** Drops session values and forces the next access to re-read metadata. */
  reset(): void {
    this.cache = null;
    this.migrationPending = false;
  }

  private assertWritable(): void {
    this.ensureLoaded();
    if (this.migrationPending) {
      throw new ConfigStoreError('MIGRATION_REQUIRED', 'confirm migration before changing stored servers');
    }
  }

  private ensureLoaded(): void {
    if (this.cache !== null) return;
    let raw: string;
    try {
      raw = this.io.readFileSync(this.filePath, 'utf8');
    } catch (error) {
      if (typeof error === 'object' && error !== null && 'code' in error && error.code === 'ENOENT') {
        this.cache = [];
        return;
      }
      throw new ConfigStoreError('STORE_IO', 'failed to read server configuration', { cause: error });
    }
    let parsed: unknown;
    try { parsed = JSON.parse(raw); } catch (error) {
      throw new ConfigStoreError('STORE_INVALID', 'server configuration contains invalid JSON', { cause: error });
    }
    if (!isRecord(parsed) || Object.keys(parsed).some((key) => key !== 'version' && key !== 'servers') ||
        !Array.isArray(parsed.servers)) {
      throw new ConfigStoreError('STORE_INVALID', 'invalid server configuration document');
    }
    const legacy = !Object.hasOwn(parsed, 'version');
    if (!legacy && parsed.version !== 2) {
      throw new ConfigStoreError('STORE_INVALID', 'unsupported server configuration version');
    }
    const next = this.validateServers(parsed.servers, legacy, !legacy);
    this.cache = next;
    this.migrationPending = legacy;
  }

  private validateServers(values: unknown, legacy: boolean, persisted = false): McpServerConfig[] {
    if (!Array.isArray(values)) throw new ConfigStoreError('STORE_INVALID', 'servers must be an array');
    const ids = new Set<string>();
    return values.map((value: unknown) => {
      if (!isRecord(value)) throw new ConfigStoreError('STORE_INVALID', 'invalid server configuration');
      const candidate = { ...value };
      if (legacy && (candidate.source === 'opencode' || candidate.source === 'hermes')) candidate.source = 'inline';
      if (persisted && Object.hasOwn(candidate, 'env')) {
        throw new ConfigStoreError('STORE_INVALID', 'version 2 must not contain literal environment values');
      }
      if (!isValidMcpServerConfig(candidate)) throw new ConfigStoreError('STORE_INVALID', 'invalid server configuration');
      if (ids.has(candidate.id)) throw new ConfigStoreError('STORE_INVALID', 'duplicate server identifier');
      ids.add(candidate.id);
      this.validateEnvironment(candidate);
      const keys = new Set([...candidate.sessionEnvKeys ?? [], ...Object.keys(candidate.env ?? {})]);
      candidate.sessionEnvKeys = [...keys];
      return structuredClone(candidate);
    });
  }

  private validateEnvironment(config: McpServerConfig): void {
    const canonical = (key: string) => this.platform === 'win32' ? key.toUpperCase() : key;
    const refs = Object.keys(config.envRefs ?? {});
    const literals = Object.keys(config.env ?? {});
    const session = config.sessionEnvKeys ?? [];
    for (const keys of [refs, literals, session]) {
      if (new Set(keys.map(canonical)).size !== keys.length) {
        throw new ConfigStoreError('STORE_INVALID', 'duplicate environment key');
      }
    }
    const refKeys = new Set(refs.map(canonical));
    if ([...literals, ...session].some((key) => refKeys.has(canonical(key)))) {
      throw new ConfigStoreError('STORE_INVALID', 'environment reference overlaps a session key');
    }
    if (literals.some((key) => session.some((other) => key !== other && canonical(key) === canonical(other)))) {
      throw new ConfigStoreError('STORE_INVALID', 'ambiguous session environment key');
    }
  }

  private persist(servers: McpServerConfig[]): void {
    const directory = dirname(this.filePath);
    const tempPath = resolve(directory, `.${basename(this.filePath)}.${randomUUID()}.store-tmp`);
    const metadata = servers.map(({ env: _env, ...config }) => config);
    let fd: number | undefined;
    let created = false;
    try {
      this.io.mkdirSync(directory, { recursive: true });
      fd = this.io.openSync(tempPath, 'wx', 0o600);
      created = true;
      this.io.writeFileSync(fd, `${JSON.stringify({ version: 2, servers: metadata }, null, 2)}\n`, 'utf8');
      this.io.fsyncSync(fd);
      this.io.closeSync(fd);
      fd = undefined;
      this.io.renameSync(tempPath, this.filePath);
      created = false;
    } catch (error) {
      throw new ConfigStoreError('STORE_IO', 'failed to persist server configuration', { cause: error });
    } finally {
      if (fd !== undefined) {
        try { this.io.closeSync(fd); } catch { /* Preserve the original failure. */ }
      }
      if (created) {
        try { this.io.unlinkSync(tempPath); } catch { /* Best effort; metadata contains no literal values. */ }
      }
    }
  }
}
