import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createServer, request as httpRequest, type Server } from 'node:http';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createApp } from './app.js';
import { ConfigStore } from './storage/configStore.js';
import { McpManager } from './mcp/manager.js';
import { projectPath } from './config/projectPaths.js';

const token = 'test-session-token';
const fixture = { id: 'builtin', name: 'builtin', transport: 'stdio' as const, command: 'fixture', args: [] };
const config = { id: 'test', name: 'test', transport: 'stdio' as const, command: process.execPath, args: [projectPath('server/test/fixtures/mcp-server.mjs')] };
let directory: string;
let file: string;
let store: ConfigStore;
let manager: McpManager;
let http: Server;
let base: string;
let stopping: boolean;
beforeEach(async () => {
  directory = mkdtempSync(join(tmpdir(), 'runner-api-'));
  file = join(directory, 'servers.json');
  store = new ConfigStore({ filePath: file });
  manager = new McpManager({ timeoutMs: 2000 });
  stopping = false;
  http = createServer(createApp({ port: 3001, token, store, manager, fixtures: [fixture], isStopping: () => stopping }));
  await new Promise<void>((resolve) => http.listen(0, '127.0.0.1', resolve));
  const address = http.address();
  if (!address || typeof address === 'string') throw new Error('Missing server address');
  base = `http://127.0.0.1:${address.port}`;
});
afterEach(async () => {
  await manager.disconnectAll();
  http.closeAllConnections();
  await new Promise<void>((resolve) => http.close(() => resolve()));
  rmSync(directory, { recursive: true, force: true });
});
// Node fetch can normalize Host; use HTTP directly to exercise hostile headers.
function rawRequest(path: string, method: string, body?: string, extra: Record<string, string> = {}): Promise<Response> {
  return new Promise((resolve, reject) => {
    const req = httpRequest(base + path, { method, headers: { Host: '127.0.0.1:3001', Authorization: `Bearer ${token}`, ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}), ...extra } }, (res) => {
      const chunks: Buffer[] = [];
      res.on('data', (chunk: Buffer) => chunks.push(chunk));
      res.on('end', () => {
        const headers = new Headers();
        for (const [key, val] of Object.entries(res.headers)) if (val !== undefined) for (const item of Array.isArray(val) ? val : [val]) headers.append(key, item);
        resolve(new Response(res.statusCode === 204 ? null : Buffer.concat(chunks), { status: res.statusCode, headers }));
      });
    });
    req.on('error', reject);
    req.end(body);
  });
}
async function request(path: string, method = 'GET', body?: unknown, extra: Record<string, string> = {}) {
  return rawRequest(path, method, body === undefined ? undefined : JSON.stringify(body), extra);
}

describe('local HTTP boundary', () => {
  it('bootstraps without auth and disables caching/CORS disclosure', async () => {
    const response = await request('/api/session', 'GET', undefined, { Authorization: '' });
    expect(await response.json()).toEqual({ token });
    expect(response.headers.get('cache-control')).toBe('no-store');
    expect(response.headers.get('access-control-allow-origin')).toBeNull();
    expect(response.headers.get('x-powered-by')).toBeNull();
    expect((await request('/api/health', 'GET', undefined, { Authorization: '' })).status).toBe(200);
  });
  it.each([{ Host: 'attacker.example:3001' }, { Origin: 'https://attacker.example' }, { Origin: 'null' }, { 'Sec-Fetch-Site': 'cross-site' }] as Record<string, string>[])('rejects hostile host/origin/metadata %#', async (headers) => {
    expect((await request('/api/session', 'GET', undefined, headers)).status).toBe(403);
  });
  it.each(['', 'wrong', token])('requires a Bearer token, not just its value: %s', async (authorization) => {
    expect((await request('/api/servers', 'GET', undefined, { Authorization: authorization })).status).toBe(401);
  });
  it('allows exact local development origin but does not enable cross-origin reads', async () => {
    expect((await request('/api/servers', 'GET', undefined, { Origin: 'http://127.0.0.1:5173' })).status).toBe(200);
  });
  it('does not trust forwarded origin/host', async () => {
    expect((await request('/api/servers', 'GET', undefined, { Host: 'evil.test:3001', 'X-Forwarded-Host': '127.0.0.1:3001' })).status).toBe(403);
  });
  it('rejects malformed and oversized bodies with stable codes', async () => {
    const malformed = await rawRequest('/api/servers', 'POST', '{');
    expect(malformed.status).toBe(400);
    expect((await request('/api/servers', 'POST', { padding: 'x'.repeat(270000) })).status).toBe(413);
  });
  it('rejects new work while shutting down', async () => {
    stopping = true;
    expect((await request('/api/health')).status).toBe(503);
  });
});
describe('canonical configurations and environment', () => {
  it('stores names/references only and requests session values after reload', async () => {
    const response = await request('/api/servers', 'POST', { config: { ...config, env: { SECRET: 'do-not-persist' }, envRefs: { API_KEY: 'BACKEND_API_KEY' } } });
    expect(response.status).toBe(201);
    const text = await response.text();
    expect(text).not.toContain('do-not-persist');
    expect(readFileSync(file, 'utf8')).not.toContain('do-not-persist');
    expect(readFileSync(file, 'utf8')).toContain('BACKEND_API_KEY');
    store.reset();
    const list = await (await request('/api/servers')).json() as { servers: { config: { id: string }; missingEnvKeys: string[] }[] };
    expect(list.servers.find((item) => item.config.id === 'test')?.missingEnvKeys).toContain('SECRET');
    expect((await request('/api/servers/test/environment', 'POST', { env: { OTHER: 'no' } })).status).toBe(400);
    expect((await request('/api/servers/test/environment', 'POST', { env: { SECRET: 'new-session-value' } })).status).toBe(200);
    expect(readFileSync(file, 'utf8')).not.toContain('new-session-value');
    expect((await request('/api/servers/test/connect', 'POST')).status).toBe(409);
  });
  it('accepts empty args but rejects invalid properties and duplicate/reserved ids', async () => {
    expect((await request('/api/servers', 'POST', { config: { ...config, args: [] } })).status).toBe(201);
    expect((await request('/api/servers', 'POST', { config })).status).toBe(409);
    expect((await request('/api/servers', 'POST', { config: { ...config, id: 'builtin' } })).status).toBe(409);
    expect((await request('/api/servers', 'POST', { config: { ...config, id: 'bad', env: [] } })).status).toBe(400);
    expect((await request('/api/servers', 'POST', { config: { ...config, id: 'bad', notes: {} } })).status).toBe(400);
    expect((await request('/api/servers/builtin', 'DELETE')).status).toBe(403);
    expect((await request('/api/servers/missing', 'DELETE')).status).toBe(404);
  });
  it('requires explicit legacy migration without exposing or losing env values', async () => {
    writeFileSync(file, JSON.stringify({ servers: [{ ...config, source: 'hermes', env: { SECRET: 'legacy-value' } }] }));
    const response = await request('/api/servers');
    const text = await response.text();
    expect(text).not.toContain('legacy-value');
    expect(JSON.parse(text).migrationPending).toBe(true);
    expect((await request('/api/servers/test/connect', 'POST')).status).toBe(409);
    expect(readFileSync(file, 'utf8')).toContain('legacy-value');
    expect((await request('/api/config/migrate', 'POST')).status).toBe(204);
    expect(readFileSync(file, 'utf8')).not.toContain('legacy-value');
    expect(store.list()[0]?.env).toEqual({ SECRET: 'legacy-value' });
  });
  it('rejects NUL environment values before changing memory or metadata', async () => {
    expect((await request('/api/servers', 'POST', { config: { ...config, env: { TOKEN: 'a\u0000b' } } })).status).toBe(400);
    expect(store.list()).toEqual([]);
    await request('/api/servers', 'POST', { config: { ...config, env: { TOKEN: 'valid' } } });
    expect((await request('/api/servers/test/environment', 'POST', { env: { TOKEN: 'a\u0000b' } })).status).toBe(400);
    expect(store.list()[0]?.env).toEqual({ TOKEN: 'valid' });
  });
  it('rejects stored builtin id collisions for every operation, not only listing', async () => {
    store.add({ ...config, id: 'builtin' });
    expect((await request('/api/servers')).status).toBe(500);
    expect((await request('/api/servers/builtin/connect', 'POST')).status).toBe(500);
    expect(manager.isBusy('builtin')).toBe(false);
  });
  it('never overwrites corrupt documents', async () => {
    writeFileSync(file, '{corrupt');
    expect((await request('/api/servers')).status).toBe(500);
    expect((await request('/api/servers', 'POST', { config })).status).toBe(500);
    expect(readFileSync(file, 'utf8')).toBe('{corrupt');
  });
});
describe('real stdio API lifecycle', () => {
  it('connects, paginates, executes exact arguments, refreshes, and cleans up', async () => {
    expect((await request('/api/servers', 'POST', { config })).status).toBe(201);
    const connected = await request('/api/servers/test/connect', 'POST');
    expect(connected.status).toBe(200);
    const data = await connected.json() as { server: { status: string; tools: { name: string }[] } };
    expect(data.server.status).toBe('connected');
    expect(data.server.tools.map((tool) => tool.name)).toEqual(['echo', 'fail']);
    const args = { text: 'hello', nested: { value: 1 } };
    const called = await (await request('/api/servers/test/tools/echo/call', 'POST', { arguments: args })).json() as { trace: { request: unknown; response: { content: unknown } } };
    expect(called.trace.request).toEqual(args);
    expect(called.trace.response.content).toEqual([{ type: 'text', text: 'hello' }]);
    const failed = await (await request('/api/servers/test/tools/fail/call', 'POST', { arguments: {} })).json() as { trace: { status: string; error: { raw: { isError: boolean } } } };
    expect(failed.trace.status).toBe('error');
    expect(failed.trace.error.raw.isError).toBe(true);
    expect((await request('/api/servers/test/tools')).status).toBe(200);
    expect((await request('/api/servers/test/environment', 'POST', { env: {} })).status).toBe(409);
    for (const args of [null, [], 4, 'text']) expect((await request('/api/servers/test/tools/echo/call', 'POST', { arguments: args })).status).toBe(400);
    expect((await request('/api/servers/test/disconnect', 'POST')).status).toBe(204);
    expect((await request('/api/servers/test/tools')).status).toBe(409);
    expect((await request('/api/servers/test', 'DELETE')).status).toBe(204);
    expect(store.list()).toEqual([]);
  });
});
