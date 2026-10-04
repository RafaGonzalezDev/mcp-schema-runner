#!/usr/bin/env node
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { ProcessSupervisor, waitForHttp } from './processes.mjs';
const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
async function ports() {
  const listeners = [createServer(), createServer()];
  try {
    for (const listener of listeners) await new Promise((done, reject) => { listener.once('error', reject); listener.listen(0, '127.0.0.1', done); });
    return listeners.map((listener) => {
      const address = listener.address();
      assert(address && typeof address === 'object');
      return address.port;
    });
  } finally {
    await Promise.all(listeners.map((listener) => new Promise((done) => listener.close(done))));
  }
}
async function main() {
  const prefix = resolve(tmpdir(), 'runner-dev-smoke-');
  const temporary = await mkdtemp(prefix);
  const [apiPort, frontendPort] = await ports();
  const apiBase = `http://127.0.0.1:${apiPort}`;
  const frontendBase = `http://127.0.0.1:${frontendPort}`;
  const supervisor = new ProcessSupervisor();
  const onSignal = () => { void supervisor.stop(1); };
  process.on('SIGINT', onSignal);
  process.on('SIGTERM', onSignal);
  try {
    // Launch from outside the checkout to verify cwd-independent supervision.
    supervisor.start(process.execPath, [join(root, 'scripts/dev.mjs')], {
      cwd: temporary,
      env: { ...process.env, PORT: String(apiPort), FRONTEND_PORT: String(frontendPort), MCP_CONFIG_PATH: join(temporary, 'servers.json') },
    });
    await Promise.all([
      waitForHttp(`${apiBase}/api/health`, { signal: supervisor.abortController.signal, expected: async (response) => (await response.json()).service === 'mcp-schema-runner' }),
      waitForHttp(frontendBase, { signal: supervisor.abortController.signal, expected: async (response) => (await response.text()).includes('/@vite/client') }),
    ]);
    const session = await fetch(`${frontendBase}/api/session`, { headers: { Origin: frontendBase }, signal: AbortSignal.timeout(5000) });
    assert.equal(session.status, 200);
    const { token } = await session.json();
    const state = await fetch(`${frontendBase}/api/servers`, { headers: { Origin: frontendBase, Authorization: `Bearer ${token}` }, signal: AbortSignal.timeout(5000) });
    assert.equal(state.status, 200);
    const data = await state.json();
    assert.equal(data.migrationPending, false);
    assert(data.servers.length >= 3, 'built-in demos must be listed without starting them');
    const hostile = await fetch(`${frontendBase}/api/session`, { headers: { Origin: 'https://unrelated.example' }, signal: AbortSignal.timeout(5000) });
    assert.equal(hostile.status, 403, 'proxy must preserve the checked browser origin');
    await hostile.body?.cancel();
  } finally {
    const cleanupCode = await supervisor.stop(0);
    process.removeListener('SIGINT', onSignal);
    process.removeListener('SIGTERM', onSignal);
    try {
      assert.equal(cleanupCode, 0, 'development process tree must close');
      for (const base of [apiBase, frontendBase]) {
        await assert.rejects(fetch(base, { signal: AbortSignal.timeout(1000) }), 'development listeners must not remain after cleanup');
      }
    } finally {
      assert(temporary.startsWith(prefix) && temporary !== prefix);
      await rm(temporary, { recursive: true, force: true });
    }
  }
  console.log('Development smoke passed: external cwd, API/client readiness, authenticated proxy and closed listeners.');
}
main().catch((error) => { console.error(error); process.exitCode = 1; });
