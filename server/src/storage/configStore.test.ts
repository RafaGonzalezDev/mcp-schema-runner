import { describe, expect, it, beforeEach } from 'vitest';
import { existsSync, rmSync, mkdtempSync } from 'node:fs';
import { writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ConfigStore } from './configStore.js';
import type { McpServerConfig } from '../../../shared/types.js';

const validServer: McpServerConfig = {
  id: 'test',
  name: 'test',
  transport: 'stdio',
  command: 'node',
  args: ['server.js'],
  env: {},
};

let dir: string;
let path: string;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'mcp-store-'));
  path = join(dir, 'servers.json');
});

describe('ConfigStore', () => {
  it('returns empty state when file does not exist', () => {
    const store = new ConfigStore({ filePath: path });
    expect(store.list()).toEqual([]);
  });

  it('adds a valid server and persists', () => {
    const store = new ConfigStore({ filePath: path });
    store.add(validServer);
    expect(existsSync(path)).toBe(true);
    store.reset();
    const store2 = new ConfigStore({ filePath: path });
    expect(store2.list()).toEqual([validServer]);
  });

  it('rejects invalid config on add', () => {
    const store = new ConfigStore({ filePath: path });
    expect(() => store.add({ ...validServer, transport: 'http' as 'stdio' })).toThrow();
  });

  it('removes by id', () => {
    const store = new ConfigStore({ filePath: path });
    store.add(validServer);
    expect(store.remove('test')).toBe(true);
    expect(store.remove('test')).toBe(false);
    expect(store.list()).toEqual([]);
  });

  it('filters out invalid entries on load', () => {
    // Pre-populate with a mix of valid/invalid entries.
    const dir2 = mkdtempSync(join(tmpdir(), 'mcp-store-bad-'));
    const p = join(dir2, 'servers.json');
    writeFileSync(
      p,
      JSON.stringify({
        servers: [
          validServer,
          { id: 'x', transport: 'http', command: 'node', args: [] },
          null,
        ],
      }),
    );
    const store = new ConfigStore({ filePath: p });
    expect(store.list()).toEqual([validServer]);
    rmSync(dir2, { recursive: true, force: true });
  });

  it('save replaces the whole list', () => {
    const store = new ConfigStore({ filePath: path });
    store.save([validServer, { ...validServer, id: 'test2', name: 'test2' }]);
    expect(store.list()).toHaveLength(2);
  });
});
