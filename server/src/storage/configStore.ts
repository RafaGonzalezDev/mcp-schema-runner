/**
 * Persistencia local de configuraciones MCP normalizadas.
 *
 * El MVP usa un único archivo JSON en disco. No se persiste historial
 * ni secretos en claro (las configs externas con `env` se redactan al
 * cargar).
 *
 * Estructura del archivo:
 *   {
 *     "servers": [ McpServerConfig, ... ]
 *   }
 */

import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { isValidMcpServerConfig, type McpServerConfig } from '../../../shared/types.js';

export type StoredConfig = {
  servers: McpServerConfig[];
};

export type ConfigStoreOptions = {
  /** Ruta absoluta al archivo JSON. Si no existe, se crea al guardar. */
  filePath: string;
};

export class ConfigStore {
  private readonly filePath: string;
  private cache: StoredConfig | null = null;

  constructor(options: ConfigStoreOptions) {
    this.filePath = resolve(options.filePath);
  }

  /** Carga el archivo desde disco. Si no existe, devuelve estado vacío. */
  load(): StoredConfig {
    if (this.cache) return this.cache;
    if (!existsSync(this.filePath)) {
      this.cache = { servers: [] };
      return this.cache;
    }
    try {
      const raw = readFileSync(this.filePath, 'utf8');
      const parsed = JSON.parse(raw) as unknown;
      if (
        typeof parsed !== 'object' ||
        parsed === null ||
        !Array.isArray((parsed as StoredConfig).servers)
      ) {
        this.cache = { servers: [] };
        return this.cache;
      }
      const valid = (parsed as StoredConfig).servers.filter(isValidMcpServerConfig);
      this.cache = { servers: valid };
      return this.cache;
    } catch {
      // Archivo corrupto: estado vacío, no propagamos el error.
      this.cache = { servers: [] };
      return this.cache;
    }
  }

  /** Devuelve la lista actual de servidores. */
  list(): McpServerConfig[] {
    return [...this.load().servers];
  }

  /**
   * Sustituye el conjunto completo de servidores y persiste.
   * Valida cada entrada y descarta las inválidas.
   */
  save(servers: McpServerConfig[]): McpServerConfig[] {
    const valid = servers.filter(isValidMcpServerConfig);
    this.cache = { servers: valid };
    this.persist();
    return valid;
  }

  /** Añade un servidor y persiste. */
  add(server: McpServerConfig): McpServerConfig {
    if (!isValidMcpServerConfig(server)) {
      throw new Error('invalid McpServerConfig');
    }
    const data = this.load();
    data.servers = [...data.servers, server];
    this.cache = data;
    this.persist();
    return server;
  }

  /** Elimina un servidor por `id` y persiste. */
  remove(id: string): boolean {
    const data = this.load();
    const before = data.servers.length;
    data.servers = data.servers.filter((s) => s.id !== id);
    if (data.servers.length === before) return false;
    this.cache = data;
    this.persist();
    return true;
  }

  /** Invalida la caché. Útil en tests. */
  reset(): void {
    this.cache = null;
  }

  private persist(): void {
    if (!this.cache) return;
    const dir = dirname(this.filePath);
    if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
    writeFileSync(this.filePath, JSON.stringify(this.cache, null, 2), 'utf8');
  }
}
