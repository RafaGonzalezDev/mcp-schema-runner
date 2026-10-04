#!/usr/bin/env node
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { ProcessSupervisor, waitForHttp } from './processes.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const entry = resolve(root, 'server/dist/server/src/index.js');
const fixture = resolve(root, 'server/test/fixtures/mcp-server.mjs');

async function availablePort() {
  const listener = createServer();
  await new Promise((resolve, reject) => {
    listener.once('error', reject);
    listener.listen(0, '127.0.0.1', resolve);
  });
  const address = listener.address();
  assert(address && typeof address === 'object');
  await new Promise((resolve, reject) => listener.close((error) => error ? reject(error) : resolve()));
  return address.port;
}

function alive(pid) {
  try { process.kill(pid, 0); return true; }
  catch (error) { if (error.code === 'ESRCH') return false; throw error; }
}

async function expectProcessExit(pid) {
  if (!pid) return;
  const deadline = Date.now() + 3000;
  while (alive(pid) && Date.now() < deadline) await new Promise((resolve) => setTimeout(resolve, 50));
  assert.equal(alive(pid), false, `process ${pid} must not linger`);
}

async function main() {
  assert(existsSync(entry), 'build the server before running smoke (npm run build)');
  assert(existsSync(resolve(root, 'client/dist/index.html')), 'build the client before running smoke');
  assert(existsSync(fixture), 'the local deterministic MCP fixture is required');
  const port = await availablePort();
  const temporaryPrefix = resolve(tmpdir(), 'mcp-schema-runner-smoke-');
  const temporary = await mkdtemp(temporaryPrefix);
  const configPath = join(temporary, 'servers.json');
  const base = `http://127.0.0.1:${port}`;
  const supervisor = new ProcessSupervisor();
  let token;
  let fixturePid;
  let added = false;
  let backend;
  const onSignal = () => { void supervisor.stop(1); };
  process.on('SIGINT', onSignal);
  process.on('SIGTERM', onSignal);
  async function api(method, path, body, status = 200) {
    const response = await fetch(`${base}/api${path}`, {
      method, signal: AbortSignal.timeout(10000),
      headers: { Authorization: `Bearer ${token}`, ...(body ? { 'Content-Type': 'application/json' } : {}) },
      ...(body ? { body: JSON.stringify(body) } : {}),
    });
    const text = await response.text();
    assert.equal(response.status, status, `${method} ${path}: ${text}`);
    return status === 204 ? undefined : JSON.parse(text);
  }
  try {
    backend = supervisor.start(process.execPath, [entry], {
      cwd: root,
      env: { ...process.env, PORT: String(port), NODE_ENV: 'production', MCP_CONFIG_PATH: configPath },
    });
    assert(backend, 'backend process must start');
    await waitForHttp(`${base}/api/health`, {
      signal: supervisor.abortController.signal,
      expected: async (response) => (await response.json()).service === 'mcp-schema-runner',
    });
    const sessionResponse = await fetch(`${base}/api/session`, { signal: AbortSignal.timeout(5000) });
    assert.equal(sessionResponse.status, 200);
    ({ token } = await sessionResponse.json());
    assert.equal(typeof token, 'string');
    assert(token.length > 0);
    const unauthenticated = await fetch(`${base}/api/servers`, { signal: AbortSignal.timeout(5000) });
    assert.equal(unauthenticated.status, 401, 'server configuration must require authentication');
    await unauthenticated.body?.cancel();

    const frontend = await fetch(`${base}/`, { signal: AbortSignal.timeout(5000) });
    assert.equal(frontend.status, 200);
    assert.match(frontend.headers.get('content-type') ?? '', /text\/html/);
    const html = await frontend.text();
    assert.match(html, /id="root"/);
    const assets = [...html.matchAll(/(?:src|href)="(\/assets\/[^"<>]+)"/g)].map((match) => match[1]);
    assert(assets.length > 0, 'production HTML must reference built assets');
    for (const path of assets) {
      const asset = await fetch(`${base}${path}`, { signal: AbortSignal.timeout(5000) });
      assert.equal(asset.status, 200, `built asset must be served: ${path}`);
      assert((await asset.arrayBuffer()).byteLength > 0, `built asset must not be empty: ${path}`);
    }

    const config = {
      id: 'smoke', name: 'smoke', transport: 'stdio', command: process.execPath,
      args: [fixture], env: { SESSION_KEY: 'smoke-secret' },
      ...(process.env.RUNNER_TRACKING_ID !== undefined
        ? { envRefs: { RUNNER_TRACKING_ID: 'RUNNER_TRACKING_ID' } } : {}),
    };
    const created = await api('POST', '/servers', { config }, 201);
    added = true;
    assert.equal(created.server.config.id, 'smoke');
    assert.equal(created.server.config.env, undefined, 'API must not expose environment values');
    assert(!(await readFile(configPath, 'utf8')).includes('smoke-secret'), 'secret values must not be persisted');
    const connected = await api('POST', '/servers/smoke/connect');
    assert.equal(connected.server.status, 'connected');
    fixturePid = connected.server.pid;
    assert.equal(typeof fixturePid, 'number');
    assert.deepEqual(connected.server.tools.map((tool) => tool.name).sort(), ['echo', 'fail']);
    const listed = await api('GET', '/servers/smoke/tools');
    assert.deepEqual(listed.tools.map((tool) => tool.name).sort(), ['echo', 'fail']);

    const args = { text: 'hello' };
    const { trace } = await api('POST', '/servers/smoke/tools/echo/call', { arguments: args });
    assert.equal(trace.serverId, 'smoke');
    assert.equal(trace.toolName, 'echo');
    assert.equal(trace.status, 'success');
    assert.deepEqual(trace.request, args, 'trace must show the exact arguments sent');
    assert.deepEqual(trace.response.content, [{ type: 'text', text: 'hello' }]);
    assert.equal(typeof trace.durationMs, 'number');
    assert(trace.durationMs >= 0);
    assert(Number.isFinite(Date.parse(trace.timestamp)));
    const { trace: failed } = await api('POST', '/servers/smoke/tools/fail/call', { arguments: {} });
    assert.equal(failed.status, 'error');
    assert.equal(failed.error.raw.isError, true);
    assert.equal(failed.error.message, 'Fixture tool failure');

    await api('POST', '/servers/smoke/disconnect', undefined, 204);
    await expectProcessExit(fixturePid);
    const disconnected = await api('GET', '/servers');
    assert.equal(disconnected.servers.find((server) => server.config.id === 'smoke').status, 'disconnected');
    await api('DELETE', '/servers/smoke', undefined, 204);
    added = false;
    const deleted = await api('GET', '/servers');
    assert(!deleted.servers.some((server) => server.config.id === 'smoke'));
    console.log('Smoke passed: authenticated API, built frontend/assets, paginated MCP tools, traces and cleanup.');
  } finally {
    // Disconnect first even when an assertion fails, so the backend can close its MCP child.
    if (added && token && !supervisor.stopping) {
      await api('POST', '/servers/smoke/disconnect', undefined, 204).catch(() => {});
      await api('DELETE', '/servers/smoke', undefined, 204).catch(() => {});
    }
    const exitCode = await supervisor.stop(0);
    process.removeListener('SIGINT', onSignal);
    process.removeListener('SIGTERM', onSignal);
    try {
      await expectProcessExit(fixturePid);
      await expectProcessExit(backend?.pid);
      assert.equal(exitCode, 0, 'backend must remain healthy until intentional shutdown');
    } finally {
      // The only removed path is the absolute directory returned by mkdtemp above.
      assert(temporary.startsWith(temporaryPrefix) && temporary !== temporaryPrefix);
      await rm(temporary, { recursive: true, force: true });
    }
  }
}

main().catch((error) => { console.error(error); process.exitCode = 1; });
