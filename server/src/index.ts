import { existsSync } from 'node:fs';
import { createApp } from './app.js';
import { McpManager } from './mcp/manager.js';
import { ConfigStore } from './storage/configStore.js';
import { serverBuiltinFixtures } from './config/fixtures.js';
import { defaultConfigPath, projectPath } from './config/projectPaths.js';

function integerSetting(name: string, fallback: number, min: number, max: number): number {
  const raw = process.env[name];
  const value = raw === undefined ? fallback : Number(raw);
  if ((raw !== undefined && !/^\d+$/.test(raw)) || !Number.isInteger(value) || value < min || value > max) throw new Error(`Invalid ${name}: expected an integer between ${min} and ${max}`);
  return value;
}
const port = integerSetting('PORT', 3001, 1, 65535);
const frontendPort = integerSetting('FRONTEND_PORT', 5173, 1, 65535);
const manager = new McpManager({ timeoutMs: integerSetting('MCP_REQUEST_TIMEOUT_MS', 30_000, 1, 600_000) });
const store = new ConfigStore({ filePath: process.env.MCP_CONFIG_PATH ? projectPath(process.env.MCP_CONFIG_PATH) : defaultConfigPath() });
const clientDirectory = projectPath('client/dist');
let stopping = false;
const app = createApp({ port, frontendPort, manager, store, fixtures: serverBuiltinFixtures,
  clientDirectory: existsSync(projectPath('client/dist/index.html')) ? clientDirectory : undefined,
  isStopping: () => stopping,
});
const server = app.listen(port, '127.0.0.1', () => console.log(`mcp-schema-runner listening on http://127.0.0.1:${port}`));
server.on('error', () => { console.error('Unable to listen on the configured loopback port'); process.exitCode = 1; });
async function shutdown(): Promise<void> {
  if (stopping) return;
  stopping = true;
  const deadline = setTimeout(() => { console.error('Shutdown deadline exceeded'); process.exit(1); }, 5000);
  const httpClosed = new Promise<void>((resolve) => server.close(() => resolve()));
  server.closeIdleConnections();
  await Promise.all([httpClosed, manager.disconnectAll()]);
  clearTimeout(deadline);
  process.exitCode = 0;
}
process.on('SIGINT', () => void shutdown());
process.on('SIGTERM', () => void shutdown());
