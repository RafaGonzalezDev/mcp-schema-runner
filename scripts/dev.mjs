#!/usr/bin/env node
import { existsSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { ProcessSupervisor, waitForHttp } from './processes.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const serverEntry = resolve(root, 'server/node_modules/tsx/dist/cli.mjs');
const clientEntry = resolve(root, 'client/node_modules/vite/bin/vite.js');

function port(value, fallback, name) {
  const number = Number(value ?? fallback);
  if (!/^\d+$/.test(String(value ?? fallback)) || !Number.isInteger(number) || number < 1 || number > 65535) {
    throw new Error(`${name} must be an integer between 1 and 65535`);
  }
  return number;
}

async function main() {
  for (const entry of [serverEntry, clientEntry]) {
    if (!existsSync(entry)) throw new Error('missing dependencies; run npm run install:all first');
  }
  const apiPort = port(process.env.PORT, 3001, 'PORT');
  const clientPort = port(process.env.FRONTEND_PORT, 5173, 'FRONTEND_PORT');
  const supervisor = new ProcessSupervisor();
  const onSignal = () => { void supervisor.stop(0); };
  process.on('SIGINT', onSignal);
  process.on('SIGTERM', onSignal);
  try {
    console.log(`mcp-schema-runner: starting API (${apiPort}) and client (${clientPort})`);
    supervisor.start(process.execPath, [serverEntry, 'watch', 'src/index.ts'], {
      cwd: resolve(root, 'server'), env: { ...process.env, PORT: String(apiPort) },
    });
    if (!supervisor.stopping) {
      supervisor.start(process.execPath, [clientEntry, '--host', '127.0.0.1',
        '--port', String(clientPort), '--strictPort'], {
        cwd: resolve(root, 'client'),
        env: { ...process.env, PORT: String(apiPort), FRONTEND_PORT: String(clientPort) },
      });
    }
    try {
      await Promise.all([
        waitForHttp(`http://127.0.0.1:${apiPort}/api/health`, {
          signal: supervisor.abortController.signal,
          expected: async (response) => (await response.json()).service === 'mcp-schema-runner',
        }),
        waitForHttp(`http://127.0.0.1:${clientPort}/`, {
          signal: supervisor.abortController.signal,
          expected: async (response) => (await response.text()).includes('/@vite/client'),
        }),
      ]);
      if (!supervisor.stopping) console.log(`frontend ready at http://127.0.0.1:${clientPort}`);
    } catch (error) {
      if (!supervisor.stopping) {
        console.error(error.message);
        await supervisor.stop(1);
      }
    }
    process.exitCode = await supervisor.done;
  } finally {
    process.removeListener('SIGINT', onSignal);
    process.removeListener('SIGTERM', onSignal);
  }
}

main().catch((error) => { console.error(error.message); process.exitCode = 1; });
