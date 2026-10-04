import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import * as fs from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ConfigStore, ConfigStoreError, type ConfigStoreIO, type StoreErrorCode } from './configStore.js';
import type { McpServerConfig } from '../../../shared/types.js';

const server: McpServerConfig = {
  id: 'test', name: 'test', transport: 'stdio', command: 'node', args: [], source: 'inline',
};
let directory: string;
let filePath: string;
beforeEach(() => {
  directory = fs.mkdtempSync(join(tmpdir(), 'mcp-store-'));
  filePath = join(directory, 'servers.json');
});
afterEach(() => {
  vi.restoreAllMocks();
  fs.rmSync(directory, { recursive: true, force: true });
});
function writeDocument(value: unknown): string {
  const raw = JSON.stringify(value);
  fs.writeFileSync(filePath, raw);
  return raw;
}
function assertCode(action: () => unknown, code: StoreErrorCode): void {
  try { action(); } catch (error) {
    expect(error).toBeInstanceOf(ConfigStoreError);
    expect((error as ConfigStoreError).code).toBe(code);
    return;
  }
  throw new Error(`expected ${code}`);
}
function ioFailure(): never {
  throw Object.assign(new Error('injected IO failure'), { code: 'EACCES' });
}
function disk(): { version: number; servers: McpServerConfig[] } {
  return JSON.parse(fs.readFileSync(filePath, 'utf8')) as { version: number; servers: McpServerConfig[] };
}

describe('ConfigStore v2', () => {
  it('treats only a missing file as an empty store without writing', () => {
    const store = new ConfigStore({ filePath });
    expect(store.list()).toEqual([]);
    expect(store.needsMigration()).toBe(false);
    expect(fs.existsSync(filePath)).toBe(false);
  });

  it('persists references and session key names, never literal values', () => {
    const config = { ...server, env: { API_KEY: 'super-secret' }, envRefs: { HOME_DIR: 'HOME' } };
    const store = new ConfigStore({ filePath });
    expect(store.add(config)).toEqual({ ...config, sessionEnvKeys: ['API_KEY'] });
    expect(store.list()[0]?.env).toEqual({ API_KEY: 'super-secret' });
    expect(disk()).toEqual({ version: 2, servers: [{ ...server, envRefs: { HOME_DIR: 'HOME' }, sessionEnvKeys: ['API_KEY'] }] });
    expect(fs.readFileSync(filePath, 'utf8')).not.toContain('super-secret');
    store.reset();
    expect(store.list()[0]?.env).toBeUndefined();
    expect(store.list()[0]?.sessionEnvKeys).toEqual(['API_KEY']);
  });

  it('deep clones arguments, inputs and returned environment records', () => {
    const input = { ...server, args: ['original'], env: { API_KEY: 'secret' }, envRefs: { PATH_REF: 'PATH' } };
    const store = new ConfigStore({ filePath });
    const added = store.add(input);
    input.args.push('input change');
    input.env.API_KEY = 'input change';
    added.args.push('result change');
    const listed = store.list()[0]!;
    listed.env!.API_KEY = 'list change';
    listed.envRefs!.PATH_REF = 'OTHER';
    listed.sessionEnvKeys!.push('EXTRA');
    expect(store.list()[0]).toEqual({ ...server, args: ['original'], env: { API_KEY: 'secret' }, envRefs: { PATH_REF: 'PATH' }, sessionEnvKeys: ['API_KEY'] });
  });

  it('save replaces all servers atomically and returns isolated copies', () => {
    const store = new ConfigStore({ filePath });
    store.add(server);
    const replacement = { ...server, id: 'replacement', env: { TOKEN: 'value' } };
    const saved = store.save([replacement]);
    saved[0]!.name = 'mutated';
    expect(store.list()).toEqual([{ ...replacement, sessionEnvKeys: ['TOKEN'] }]);
    expect(disk().servers.map((config) => config.id)).toEqual(['replacement']);
  });

  it('removes by id and does not write when the id is absent', () => {
    const rename = vi.fn(fs.renameSync);
    const store = new ConfigStore({ filePath, io: { renameSync: rename } });
    store.add(server);
    expect(store.remove('missing')).toBe(false);
    expect(rename).toHaveBeenCalledTimes(1);
    expect(store.remove(server.id)).toBe(true);
    expect(disk().servers).toEqual([]);
    expect(store.list()).toEqual([]);
  });

  it('rejects duplicates on add or save without changing disk or cache', () => {
    const store = new ConfigStore({ filePath });
    store.add(server);
    const before = fs.readFileSync(filePath, 'utf8');
    assertCode(() => store.add({ ...server, name: 'other' }), 'STORE_INVALID');
    assertCode(() => store.save([server, server]), 'STORE_INVALID');
    expect(fs.readFileSync(filePath, 'utf8')).toBe(before);
    expect(store.list()).toEqual([{ ...server, sessionEnvKeys: [] }]);
  });

  it.each([
    'invalid JSON', 'null', '{}', '{"servers":null}', '{"version":1,"servers":[]}',
    '{"version":3,"servers":[]}', '{"version":2,"servers":[],"extra":true}',
  ])('rejects malformed or unknown document %s without overwriting it', (raw) => {
    fs.writeFileSync(filePath, raw);
    const store = new ConfigStore({ filePath });
    assertCode(() => store.list(), 'STORE_INVALID');
    assertCode(() => store.add(server), 'STORE_INVALID');
    expect(fs.readFileSync(filePath, 'utf8')).toBe(raw);
  });

  it.each([
    { version: 2, servers: [server, server] },
    { servers: [server, server] },
    { version: 2, servers: [null] },
    { servers: [{ ...server, notes: {} }] },
    { version: 2, servers: [{ ...server, env: {} }] },
    { version: 2, servers: [{ ...server, source: 'hermes' }] },
    { version: 2, servers: [{ ...server, envRefs: { TOKEN: 'BAD-NAME' } }] },
  ])('rejects invalid entries rather than silently filtering them: %j', (document) => {
    const raw = writeDocument(document);
    assertCode(() => new ConfigStore({ filePath }).list(), 'STORE_INVALID');
    expect(fs.readFileSync(filePath, 'utf8')).toBe(raw);
  });

  it('rejects overlapping reference and session keys', () => {
    const store = new ConfigStore({ filePath });
    assertCode(() => store.add({ ...server, env: { TOKEN: 'value' }, envRefs: { TOKEN: 'PARENT_TOKEN' } }), 'STORE_INVALID');
    assertCode(() => store.add({ ...server, sessionEnvKeys: ['TOKEN'], envRefs: { TOKEN: 'PARENT_TOKEN' } }), 'STORE_INVALID');
    expect(fs.existsSync(filePath)).toBe(false);
  });

  it.each([
    { env: { token: 'value' }, envRefs: { TOKEN: 'PARENT_TOKEN' } },
    { sessionEnvKeys: ['token'], envRefs: { TOKEN: 'PARENT_TOKEN' } },
    { env: { token: 'one', TOKEN: 'two' } },
    { sessionEnvKeys: ['token', 'TOKEN'] },
    { envRefs: { token: 'ONE', TOKEN: 'TWO' } },
    { env: { token: 'one' }, sessionEnvKeys: ['TOKEN'] },
  ])('rejects ambiguous Windows environment names: %j', (environment) => {
    const store = new ConfigStore({ filePath, platform: 'win32' });
    assertCode(() => store.add({ ...server, ...environment } as McpServerConfig), 'STORE_INVALID');
  });

  it('preserves case-sensitive environment names on POSIX', () => {
    const store = new ConfigStore({ filePath, platform: 'linux' });
    expect(store.add({ ...server, env: { token: 'value' }, envRefs: { TOKEN: 'PARENT_TOKEN' } }).env).toEqual({ token: 'value' });
  });
});

describe('explicit legacy migration', () => {
  it('reads metadata without exposing or rewriting legacy environment values', () => {
    const raw = writeDocument({ servers: [{ ...server, source: 'hermes', env: { TOKEN: 'legacy-secret' } }] });
    const store = new ConfigStore({ filePath });
    expect(store.needsMigration()).toBe(true);
    expect(store.list()).toEqual([{ ...server, source: 'inline', sessionEnvKeys: ['TOKEN'] }]);
    expect(fs.readFileSync(filePath, 'utf8')).toBe(raw);
    for (const action of [() => store.add(server), () => store.save([]), () => store.remove('missing'), () => store.setSessionEnvironment(server.id, { TOKEN: 'new' })]) {
      assertCode(action, 'MIGRATION_REQUIRED');
    }
    store.migrate();
    expect(store.needsMigration()).toBe(false);
    expect(store.list()[0]?.env).toEqual({ TOKEN: 'legacy-secret' });
    expect(disk()).toEqual({ version: 2, servers: [{ ...server, sessionEnvKeys: ['TOKEN'] }] });
    expect(fs.readdirSync(directory)).toEqual(['servers.json']);
    expect(fs.readFileSync(filePath, 'utf8')).not.toContain('legacy-secret');
    store.reset();
    expect(store.list()[0]?.env).toBeUndefined();
  });

  it('normalizes obsolete source metadata only during legacy loading', () => {
    writeDocument({ servers: [{ ...server, source: 'opencode' }] });
    const store = new ConfigStore({ filePath });
    store.migrate();
    expect(disk().servers[0]?.source).toBe('inline');
  });

  it('requires explicit migration even for an empty legacy store', () => {
    const raw = writeDocument({ servers: [] });
    const store = new ConfigStore({ filePath });
    expect(store.list()).toEqual([]);
    expect(store.needsMigration()).toBe(true);
    expect(fs.readFileSync(filePath, 'utf8')).toBe(raw);
    store.migrate();
    expect(disk()).toEqual({ version: 2, servers: [] });
    store.migrate();
    expect(store.needsMigration()).toBe(false);
  });

  it('keeps migration pending and legacy disk unchanged after a failed rename', () => {
    const raw = writeDocument({ servers: [{ ...server, env: { TOKEN: 'legacy' } }] });
    const rename = vi.fn(fs.renameSync).mockImplementationOnce(ioFailure);
    const store = new ConfigStore({ filePath, io: { renameSync: rename } });
    assertCode(() => store.migrate(), 'STORE_IO');
    expect(store.needsMigration()).toBe(true);
    expect(store.list()[0]?.env).toBeUndefined();
    expect(fs.readFileSync(filePath, 'utf8')).toBe(raw);
    expect(fs.readdirSync(directory)).toEqual(['servers.json']);
    store.migrate();
    expect(store.list()[0]?.env).toEqual({ TOKEN: 'legacy' });
  });
});

describe('session environment replacement', () => {
  it('replaces exactly configured session values without changing disk', () => {
    const store = new ConfigStore({ filePath });
    store.add({ ...server, envRefs: { HOME_DIR: 'HOME' }, sessionEnvKeys: ['TOKEN', 'PORT'] });
    const raw = fs.readFileSync(filePath, 'utf8');
    const env = { TOKEN: 'replacement', PORT: '8080' };
    const updated = store.setSessionEnvironment(server.id, env);
    env.TOKEN = 'input mutation';
    updated.env!.PORT = 'return mutation';
    expect(store.list()[0]?.env).toEqual({ TOKEN: 'replacement', PORT: '8080' });
    expect(fs.readFileSync(filePath, 'utf8')).toBe(raw);
    store.reset();
    expect(store.list()[0]?.env).toBeUndefined();
  });

  it('rejects missing, extra, differently cased and reference keys without altering memory', () => {
    const store = new ConfigStore({ filePath, platform: 'win32' });
    store.add({ ...server, env: { TOKEN: 'original' }, envRefs: { HOME_DIR: 'HOME' } });
    for (const env of [{}, { token: 'other' }, { TOKEN: 'other', EXTRA: 'extra' }, { HOME_DIR: 'override' }, { TOKEN: 5 }]) {
      assertCode(() => store.setSessionEnvironment(server.id, env as Record<string, string>), 'SESSION_ENV_INVALID');
    }
    expect(store.list()[0]?.env).toEqual({ TOKEN: 'original' });
    assertCode(() => store.setSessionEnvironment('missing', {}), 'NOT_FOUND');
  });
});

describe('filesystem failures and atomic replacement', () => {
  it('does not cache read errors as an empty store', () => {
    writeDocument({ version: 2, servers: [{ ...server, sessionEnvKeys: [] }] });
    const read = vi.fn(fs.readFileSync).mockImplementationOnce(ioFailure);
    const store = new ConfigStore({ filePath, io: { readFileSync: read as ConfigStoreIO['readFileSync'] } });
    assertCode(() => store.list(), 'STORE_IO');
    expect(store.list()).toEqual([{ ...server, sessionEnvKeys: [] }]);
  });

  it.each(['mkdirSync', 'openSync', 'writeFileSync', 'fsyncSync', 'closeSync', 'renameSync'] as const)(
    'preserves cache and disk when %s fails', (method) => {
      const store = new ConfigStore({ filePath });
      store.add({ ...server, env: { TOKEN: 'session-secret' } });
      const raw = fs.readFileSync(filePath, 'utf8');
      const failingIO = { [method]: vi.fn(fs[method]).mockImplementationOnce(ioFailure) } as Partial<ConfigStoreIO>;
      const failingStore = new ConfigStore({ filePath, io: failingIO });
      failingStore.setSessionEnvironment(server.id, { TOKEN: 'session-secret' });
      assertCode(() => failingStore.save([{ ...server, id: 'other', env: { TOKEN: 'never-write-this' } }]), 'STORE_IO');
      expect(failingStore.list()).toEqual([{ ...server, env: { TOKEN: 'session-secret' }, sessionEnvKeys: ['TOKEN'] }]);
      expect(fs.readFileSync(filePath, 'utf8')).toBe(raw);
      expect(fs.readdirSync(directory)).toEqual(['servers.json']);
    },
  );

  it('failed add and remove preserve the previous memory state', () => {
    const rename = vi.fn(fs.renameSync);
    const store = new ConfigStore({ filePath, io: { renameSync: rename } });
    store.add(server);
    const raw = fs.readFileSync(filePath, 'utf8');
    rename.mockImplementationOnce(ioFailure);
    assertCode(() => store.add({ ...server, id: 'other' }), 'STORE_IO');
    rename.mockImplementationOnce(ioFailure);
    assertCode(() => store.remove(server.id), 'STORE_IO');
    expect(store.list()).toEqual([{ ...server, sessionEnvKeys: [] }]);
    expect(fs.readFileSync(filePath, 'utf8')).toBe(raw);
  });

  it('creates exclusive owner-only temporary files, syncs and closes before rename', () => {
    const calls: string[] = [];
    const store = new ConfigStore({ filePath, io: {
      openSync: (path, flags, mode) => {
        expect(String(path)).toMatch(/\.servers\.json\.[\w-]+\.store-tmp$/);
        expect(flags).toBe('wx');
        expect(mode).toBe(0o600);
        calls.push('open');
        return fs.openSync(path, flags, mode);
      },
      fsyncSync: (fd) => { calls.push('sync'); fs.fsyncSync(fd); },
      closeSync: (fd) => { calls.push('close'); fs.closeSync(fd); },
      renameSync: (from, to) => { calls.push('rename'); fs.renameSync(from, to); },
    } });
    store.add({ ...server, env: { TOKEN: 'secret' } });
    expect(calls).toEqual(['open', 'sync', 'close', 'rename']);
    expect(fs.readdirSync(directory)).toEqual(['servers.json']);
    if (process.platform !== 'win32') expect(fs.statSync(filePath).mode & 0o777).toBe(0o600);
  });
});
