import { afterEach, describe, expect, it, vi } from 'vitest';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { McpManager } from './manager.js';
import { projectPath } from '../config/projectPaths.js';
import type { McpServerConfig } from '../../../shared/types.js';
const fixture: McpServerConfig = { id: 'local', name: 'Local fixture', transport: 'stdio', command: process.execPath, args: [projectPath('server/test/fixtures/mcp-server.mjs')] };
let manager: McpManager;
let transport: StdioClientTransport;
function setup(timeoutMs: number) {
  manager = new McpManager({ timeoutMs, createTransport: (config) => {
    transport = new StdioClientTransport({ command: config.command, args: config.args, cwd: config.cwd, env: config.env });
    return transport;
  } });
}
afterEach(async () => { await manager?.disconnectAll(); });
async function expectExited(pid: number | null | undefined) {
  expect(pid).toBeGreaterThan(0);
  await vi.waitFor(() => expect(() => process.kill(pid!, 0)).toThrow(), { timeout: 3000 });
}
describe('real SDK transport lifecycle', () => {
  it('bounds initialization of an unresponsive child and closes its process', async () => {
    setup(250);
    const config = { ...fixture, args: [...fixture.args, '--hang-initialize'] };
    const connection = manager.connect(config);
    const rejected = expect(connection).rejects.toMatchObject({ code: 'MCP_CONNECT_FAILED' });
    await vi.waitFor(() => expect(transport?.pid).toBeGreaterThan(0));
    const pid = transport.pid;
    await rejected;
    expect(manager.getState(config).status).toBe('error');
    expect(manager.isBusy(config.id)).toBe(false);
    await expectExited(pid);
  });
  it('disconnects during initialization without retaining a child or stale tools', async () => {
    setup(10000);
    const config = { ...fixture, args: [...fixture.args, '--hang-initialize'] };
    const connection = manager.connect(config);
    const rejected = expect(connection).rejects.toMatchObject({ code: 'CANCELLED' });
    await vi.waitFor(() => expect(transport?.pid).toBeGreaterThan(0));
    const pid = transport.pid;
    await manager.disconnect(config.id);
    await rejected;
    expect(manager.getState(config)).toMatchObject({ status: 'disconnected', tools: [], pid: undefined });
    await expectExited(pid);
  });
  it.runIf(process.platform === 'win32')('overrides default PATH despite mixed-case target spelling', async () => {
    setup(10000);
    const config = { ...fixture, env: { Path: 'runner-explicit-path' } };
    await manager.connect(config);
    const trace = await manager.callTool(config, 'echo', { __fixtureEnvironment: 'Path' });
    expect(trace.response).toMatchObject({ content: [{ type: 'text', text: 'runner-explicit-path' }] });
  });
});
