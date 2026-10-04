import { describe, expect, it, vi } from 'vitest';
import type { Client } from '@modelcontextprotocol/sdk/client/index.js';
import type { Transport } from '@modelcontextprotocol/sdk/shared/transport.js';
import { getDefaultEnvironment } from '@modelcontextprotocol/sdk/client/stdio.js';
import { McpManager, type McpManagerOptions } from './manager.js';
import type { McpServerConfig } from '../../../shared/types.js';

type ManagedClient = ReturnType<NonNullable<McpManagerOptions['createClient']>>;
type ListResult = Awaited<ReturnType<Client['listTools']>>;
type CallResult = Awaited<ReturnType<Client['callTool']>>;
type RequestOptions = { timeout?: number; signal?: AbortSignal };
const config: McpServerConfig = { id: 'test', name: 'test', transport: 'stdio', command: 'fake-server', args: [] };
const tool = (name: string): ListResult['tools'][number] => ({ name, inputSchema: { type: 'object' } });
const success: CallResult = { content: [{ type: 'text', text: 'ok' }] };
function deferred<T>() {
  let resolve!: (value: T | PromiseLike<T>) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}
function mockClient() {
  return {
    connect: vi.fn(async (_transport: Transport, _options?: RequestOptions): Promise<void> => undefined),
    close: vi.fn(async (): Promise<void> => undefined),
    listTools: vi.fn(async (_params?: { cursor?: string }, _options?: RequestOptions): Promise<ListResult> => ({ tools: [tool('first')] })),
    callTool: vi.fn(async (_request: { name: string; arguments?: Record<string, unknown> }, _schema?: unknown, _options?: RequestOptions): Promise<CallResult> => success),
    onclose: undefined as (() => void) | undefined,
    onerror: undefined as ((error: Error) => void) | undefined,
  };
}
function mockTransport(pid = 123) {
  return {
    pid,
    start: vi.fn(async () => undefined),
    close: vi.fn(async () => undefined),
    send: vi.fn(async () => undefined),
  };
}
function harness(options: McpManagerOptions = {}) {
  const client = mockClient();
  const transport = mockTransport();
  const createClient = vi.fn(() => client as unknown as ManagedClient);
  const createTransport = vi.fn((_config: McpServerConfig) => transport);
  const manager = new McpManager({ environment: {}, createClient, createTransport, ...options });
  return { manager, client, transport, createClient, createTransport };
}

describe('McpManager connection lifecycle', () => {
  it('coalesces concurrent connects and returns the same live connection', async () => {
    const { manager, client, createClient, createTransport } = harness();
    const pending = deferred<void>();
    client.connect.mockReturnValueOnce(pending.promise);
    const first = manager.connect(config);
    const second = manager.connect(config);
    expect(manager.getState(config).status).toBe('connecting');
    expect(manager.isBusy(config.id)).toBe(true);
    expect(createClient).toHaveBeenCalledTimes(1);
    expect(createTransport).toHaveBeenCalledTimes(1);
    pending.resolve();
    const [a, b] = await Promise.all([first, second]);
    expect(a.status).toBe('connected');
    expect(b).toEqual(a);
    expect(a.pid).toBe(123);
    expect(client.listTools).toHaveBeenCalledTimes(1);
    await manager.connect(config);
    expect(createClient).toHaveBeenCalledTimes(1);
    await manager.disconnectAll();
  });

  it('cancels and cleans a pending connection when disconnect is requested', async () => {
    const { manager, client, transport } = harness();
    let signal: AbortSignal | undefined;
    client.connect.mockImplementationOnce(async (_transport, options) => {
      signal = options?.signal;
      await new Promise<void>((_resolve, reject) => {
        signal!.addEventListener('abort', () => reject(new Error('aborted')), { once: true });
      });
    });
    const connecting = manager.connect(config);
    const rejected = expect(connecting).rejects.toMatchObject({ code: 'CANCELLED' });
    await manager.disconnect(config.id);
    await rejected;
    expect(signal?.aborted).toBe(true);
    expect(client.close).toHaveBeenCalledTimes(1);
    expect(transport.close).toHaveBeenCalledTimes(1);
    expect(client.listTools).not.toHaveBeenCalled();
    expect(manager.getState(config).status).toBe('disconnected');
    expect(manager.isBusy(config.id)).toBe(false);
  });

  it('transitions to error and clears stale tools after an unexpected close', async () => {
    const { manager, client } = harness();
    await manager.connect(config);
    client.onclose!();
    const state = manager.getState(config);
    expect(state.status).toBe('error');
    expect(state.error).toBe('MCP process closed unexpectedly');
    expect(state.tools).toEqual([]);
    expect(state.pid).toBeUndefined();
    expect(manager.isBusy(config.id)).toBe(false);
    await expect(manager.callTool(config, 'first', {})).rejects.toMatchObject({ code: 'NOT_CONNECTED' });
    await manager.disconnect(config.id);
  });

  it('classifies an unexpected close during handshake as failure, not user cancellation', async () => {
    const { manager, client, transport } = harness();
    client.connect.mockImplementationOnce(async (_transport, options) => new Promise<void>((_resolve, reject) => {
      options!.signal!.addEventListener('abort', () => reject(new Error('connection lost')), { once: true });
    }));
    const connecting = manager.connect(config);
    const rejected = expect(connecting).rejects.toMatchObject({ code: 'MCP_CONNECT_FAILED' });
    client.onclose!();
    await rejected;
    expect(manager.getState(config).status).toBe('error');
    expect(client.close).toHaveBeenCalledTimes(1);
    expect(transport.close).toHaveBeenCalledTimes(1);
    await manager.disconnect(config.id);
  });

  it('aborts requests and closes resources after a transport error', async () => {
    const { manager, client, transport } = harness();
    await manager.connect(config);
    const signal = client.connect.mock.calls[0]![1]!.signal!;
    client.close.mockImplementationOnce(async () => { client.onclose!(); });
    client.onerror!(new Error('transport failed'));
    expect(signal.aborted).toBe(true);
    await vi.waitFor(() => {
      expect(transport.close).toHaveBeenCalledTimes(1);
      expect(manager.isBusy(config.id)).toBe(false);
    });
    expect(manager.getState(config).status).toBe('error');
    expect(manager.getState(config).error).toBe('MCP transport reported an error');
    expect(manager.getState(config).tools).toEqual([]);
    expect(manager.getState(config).pid).toBeUndefined();
    await manager.connect(config);
    expect(manager.getState(config).status).toBe('connected');
    await manager.disconnect(config.id);
  });

  it('closes both resources when initial tools/list fails and allows a retry', async () => {
    const { manager, client, transport, createTransport } = harness();
    client.listTools.mockRejectedValueOnce(new Error('initial list failed'));
    await expect(manager.connect(config)).rejects.toMatchObject({ code: 'MCP_CONNECT_FAILED' });
    expect(client.close).toHaveBeenCalledTimes(1);
    expect(transport.close).toHaveBeenCalledTimes(1);
    expect(manager.getState(config).status).toBe('error');
    expect(manager.getState(config).tools).toEqual([]);
    expect(manager.isBusy(config.id)).toBe(false);
    const recovered = await manager.connect(config);
    expect(recovered.status).toBe('connected');
    expect(createTransport).toHaveBeenCalledTimes(2);
    await manager.disconnect(config.id);
  });

  it('still closes the transport if client cleanup throws', async () => {
    const { manager, client, transport } = harness();
    client.connect.mockRejectedValueOnce(new Error('handshake failed'));
    client.close.mockRejectedValueOnce(new Error('client close failed'));
    await expect(manager.connect(config)).rejects.toMatchObject({ code: 'MCP_CONNECT_FAILED' });
    expect(transport.close).toHaveBeenCalledTimes(1);
    expect(manager.getState(config).status).toBe('error');
    await manager.disconnect(config.id);
  });

  it('does not let callbacks from an old generation mutate a new connection', async () => {
    const oldClient = mockClient();
    const newClient = mockClient();
    const oldTransport = mockTransport(11);
    const newTransport = mockTransport(22);
    const clients = [oldClient, newClient];
    const transports = [oldTransport, newTransport];
    const manager = new McpManager({
      environment: {},
      createClient: () => clients.shift()! as unknown as ManagedClient,
      createTransport: () => transports.shift()!,
    });
    await manager.connect(config);
    const oldClose = oldClient.onclose!;
    const oldError = oldClient.onerror!;
    await manager.disconnect(config.id);
    await manager.connect(config);
    oldClose();
    oldError(new Error('stale transport error'));
    expect(manager.getState(config).status).toBe('connected');
    expect(manager.getState(config).pid).toBe(22);
    expect(manager.getState(config).error).toBeUndefined();
    expect(manager.getState(config).tools.map((item) => item.name)).toEqual(['first']);
    await manager.disconnect(config.id);
  });

  it('blocks a new connect during close and blocks all connects after shutdown', async () => {
    const { manager, client } = harness();
    await manager.connect(config);
    const closing = deferred<void>();
    client.close.mockReturnValueOnce(closing.promise);
    const disconnecting = manager.disconnect(config.id);
    await expect(manager.connect(config)).rejects.toMatchObject({ code: 'BUSY' });
    closing.resolve();
    await disconnecting;
    await manager.disconnectAll();
    await expect(manager.connect(config)).rejects.toMatchObject({ code: 'SHUTTING_DOWN' });
  });
});

describe('McpManager tool inventory', () => {
  it('loads every page and passes timeout and cancellation to each request', async () => {
    const { manager, client } = harness({ timeoutMs: 1234 });
    client.listTools.mockResolvedValueOnce({ tools: [tool('one')], nextCursor: 'page-two' });
    client.listTools.mockResolvedValueOnce({ tools: [tool('two')] });
    const state = await manager.connect(config);
    expect(state.tools.map((item) => item.name)).toEqual(['one', 'two']);
    expect(client.listTools).toHaveBeenNthCalledWith(1, undefined, { timeout: 1234, signal: expect.any(AbortSignal) });
    expect(client.listTools).toHaveBeenNthCalledWith(2, { cursor: 'page-two' }, { timeout: 1234, signal: expect.any(AbortSignal) });
    client.listTools.mockResolvedValueOnce({ tools: [tool('updated')] });
    expect((await manager.listTools(config.id)).map((item) => item.name)).toEqual(['updated']);
    expect(manager.getState(config).tools.map((item) => item.name)).toEqual(['updated']);
    await manager.disconnect(config.id);
  });

  it('rejects repeated pagination cursors without replacing the cached inventory', async () => {
    const { manager, client } = harness();
    await manager.connect(config);
    client.listTools.mockResolvedValueOnce({ tools: [tool('partial-one')], nextCursor: 'repeat' });
    client.listTools.mockResolvedValueOnce({ tools: [tool('partial-two')], nextCursor: 'repeat' });
    await expect(manager.listTools(config.id)).rejects.toMatchObject({ code: 'MCP_LIST_FAILED' });
    expect(manager.getState(config).status).toBe('connected');
    expect(manager.getState(config).tools.map((item) => item.name)).toEqual(['first']);
    await manager.disconnect(config.id);
  });

  it('keeps the cached inventory if a later refresh page fails', async () => {
    const { manager, client } = harness();
    await manager.connect(config);
    client.listTools.mockResolvedValueOnce({ tools: [tool('partial')], nextCursor: 'second' });
    client.listTools.mockRejectedValueOnce(new Error('second page failed'));
    await expect(manager.listTools(config.id)).rejects.toThrow('second page failed');
    expect(manager.getState(config).tools.map((item) => item.name)).toEqual(['first']);
    await manager.disconnect(config.id);
  });
});

describe('McpManager tool execution traces', () => {
  it.each([null, undefined, [], 'text', 42, false])('rejects non-object arguments %j without calling the SDK', async (args) => {
    const { manager, client } = harness();
    await manager.connect(config);
    await expect(manager.callTool(config, 'first', args)).rejects.toMatchObject({ code: 'BAD_REQUEST' });
    expect(client.callTool).not.toHaveBeenCalled();
    await manager.disconnect(config.id);
  });

  it('records exactly the cloned object sent to the SDK', async () => {
    const { manager, client } = harness({ timeoutMs: 987 });
    await manager.connect(config);
    const pending = deferred<CallResult>();
    client.callTool.mockReturnValueOnce(pending.promise);
    const args = { path: 'original', nested: { enabled: true }, count: 0 };
    const execution = manager.callTool(config, 'first', args);
    args.path = 'caller changed';
    args.nested.enabled = false;
    pending.resolve(success);
    const trace = await execution;
    const expected = { path: 'original', nested: { enabled: true }, count: 0 };
    expect(trace.status).toBe('success');
    expect(trace.request).toEqual(expected);
    expect(client.callTool).toHaveBeenCalledWith({ name: 'first', arguments: expected }, undefined, { timeout: 987, signal: expect.any(AbortSignal) });
    expect(trace.response).toEqual(success);
    expect(trace.durationMs).toBeGreaterThanOrEqual(0);
    expect(Number.isNaN(Date.parse(trace.timestamp))).toBe(false);
    expect(trace.serverId).toBe(config.id);
    expect(trace.toolName).toBe('first');
    expect(trace.request).not.toHaveProperty('jsonrpc');
    await manager.disconnect(config.id);
  });

  it('serializes MCP tool-level isError without claiming a successful response', async () => {
    const { manager, client } = harness();
    await manager.connect(config);
    const result: CallResult = { isError: true, content: [{ type: 'text', text: 'tool failed' }] };
    client.callTool.mockResolvedValueOnce(result);
    const trace = await manager.callTool(config, 'first', {});
    expect(trace.status).toBe('error');
    expect(trace.error).toEqual({ message: 'tool failed', raw: result });
    expect(trace.response).toBeUndefined();
    expect(JSON.parse(JSON.stringify(trace)).error.raw.isError).toBe(true);
    await manager.disconnect(config.id);
  });

  it('serializes protocol errors as plain error details, without raw Error objects', async () => {
    const { manager, client } = harness();
    await manager.connect(config);
    const error = Object.assign(new Error('invalid tool parameters'), { code: -32602, self: undefined as unknown });
    error.self = error;
    client.callTool.mockRejectedValueOnce(error);
    const trace = await manager.callTool(config, 'first', { value: 1 });
    expect(trace.status).toBe('error');
    expect(trace.error).toEqual({ message: 'invalid tool parameters', name: 'Error', code: '-32602' });
    expect(() => JSON.stringify(trace)).not.toThrow();
    expect(trace.error).not.toHaveProperty('raw');
    expect(trace.error).not.toHaveProperty('stack');
    await manager.disconnect(config.id);
  });

  it('reports cancellation when a pending call is interrupted by disconnect', async () => {
    const { manager, client } = harness();
    await manager.connect(config);
    client.callTool.mockImplementationOnce(async (_request, _schema, options) => new Promise<CallResult>((_resolve, reject) => {
      options!.signal!.addEventListener('abort', () => reject(new Error('aborted')), { once: true });
    }));
    const execution = manager.callTool(config, 'first', {});
    await manager.disconnect(config.id);
    const trace = await execution;
    expect(trace.status).toBe('error');
    expect(trace.error?.message).toBe('Tool call cancelled or connection closed');
  });
});

describe('McpManager environment boundary', () => {
  it('does not pass unrelated inherited environment values to the transport', async () => {
    const { manager, createTransport } = harness({ environment: { SECRET_SENTINEL: 'must-not-inherit', PATH: 'parent-path' } });
    await manager.connect(config);
    const transportConfig = createTransport.mock.calls[0]![0];
    expect(transportConfig.env).toEqual({});
    expect(transportConfig.env).not.toHaveProperty('SECRET_SENTINEL');
    expect(transportConfig.env).not.toHaveProperty('PATH');
    await manager.disconnect(config.id);
  });

  it('passes only explicit reference resolutions and session values', async () => {
    const { manager, createTransport } = harness({ environment: { PARENT_TOKEN: 'resolved-secret', UNUSED: 'not-forwarded' } });
    const configured = { ...config, envRefs: { API_KEY: 'PARENT_TOKEN' }, env: { PORT: '8080' }, sessionEnvKeys: ['PORT'] };
    const state = await manager.connect(configured);
    expect(createTransport.mock.calls[0]![0].env).toEqual({ API_KEY: 'resolved-secret', PORT: '8080' });
    expect(state.config).not.toHaveProperty('env');
    expect(state.missingEnvKeys).toEqual([]);
    await manager.disconnect(config.id);
  });

  it('reports missing references and session keys without spawning or exposing values', async () => {
    const { manager, createTransport, createClient } = harness({ environment: {} });
    const configured = { ...config, envRefs: { API_KEY: 'ABSENT' }, sessionEnvKeys: ['TOKEN'] };
    expect(manager.missingEnvironment(configured)).toEqual(['TOKEN', 'API_KEY']);
    await expect(manager.connect(configured)).rejects.toMatchObject({ code: 'ENV_REQUIRED' });
    expect(createTransport).not.toHaveBeenCalled();
    expect(createClient).not.toHaveBeenCalled();
    expect(manager.getState(configured).status).toBe('disconnected');
    expect(manager.getState(configured).missingEnvKeys).toEqual(['TOKEN', 'API_KEY']);
  });

  it('accepts empty strings as explicitly supplied environment values', async () => {
    const { manager, createTransport } = harness({ environment: { PARENT_TOKEN: '' } });
    const configured = { ...config, envRefs: { API_KEY: 'PARENT_TOKEN' }, sessionEnvKeys: ['TOKEN'], env: { TOKEN: '' } };
    await manager.connect(configured);
    expect(createTransport.mock.calls[0]![0].env).toEqual({ API_KEY: '', TOKEN: '' });
    await manager.disconnect(config.id);
  });

  it('rejects case-insensitive Windows collisions before spawning', async () => {
    const { manager, createTransport } = harness({ environment: { PARENT_TOKEN: 'value' }, platform: 'win32' });
    const configured = { ...config, envRefs: { TOKEN: 'PARENT_TOKEN' }, env: { token: 'session' }, sessionEnvKeys: ['token'] };
    await expect(manager.connect(configured)).rejects.toMatchObject({ code: 'BAD_REQUEST' });
    expect(createTransport).not.toHaveBeenCalled();
  });

  it('canonicalizes a Windows session Path override to replace the SDK PATH default', async () => {
    const { manager, createTransport } = harness({ platform: 'win32' });
    const configured = { ...config, env: { Path: 'explicit-path' }, sessionEnvKeys: ['Path'] };
    const state = await manager.connect(configured);
    const explicit = createTransport.mock.calls[0]![0].env!;
    expect(explicit).toEqual({ PATH: 'explicit-path' });
    const merged = { ...getDefaultEnvironment(), ...explicit };
    expect(merged.PATH).toBe('explicit-path');
    expect(Object.keys(merged).filter((key) => key.toUpperCase() === 'PATH')).toEqual(['PATH']);
    expect(state.config.sessionEnvKeys).toEqual(['Path']);
    expect(state.missingEnvKeys).toEqual([]);
    await manager.disconnect(config.id);
  });

  it('resolves Windows parent references case-insensitively and canonicalizes target names', async () => {
    const { manager, createTransport } = harness({ platform: 'win32', environment: { Custom_Path: 'reference-path' } });
    const configured = { ...config, envRefs: { Path: 'CUSTOM_PATH' } };
    expect(manager.missingEnvironment(configured)).toEqual([]);
    await manager.connect(configured);
    expect(createTransport.mock.calls[0]![0].env).toEqual({ PATH: 'reference-path' });
    await manager.disconnect(config.id);
  });

  it('keeps parent reference lookup case-sensitive on POSIX', async () => {
    const { manager, createTransport } = harness({ platform: 'linux', environment: { Custom_Path: 'reference-path' } });
    const configured = { ...config, envRefs: { PATH: 'CUSTOM_PATH' } };
    expect(manager.missingEnvironment(configured)).toEqual(['PATH']);
    await expect(manager.connect(configured)).rejects.toMatchObject({ code: 'ENV_REQUIRED' });
    expect(createTransport).not.toHaveBeenCalled();
  });

  it('rejects NUL values in literals or resolved references before creating a transport', async () => {
    const { manager, createTransport } = harness({ environment: { SOURCE: 'prefix\0suffix' } });
    await expect(manager.connect({ ...config, envRefs: { TOKEN: 'SOURCE' } })).rejects.toMatchObject({ code: 'BAD_REQUEST' });
    await expect(manager.connect({ ...config, env: { TOKEN: 'prefix\0suffix' } })).rejects.toMatchObject({ code: 'BAD_REQUEST' });
    expect(createTransport).not.toHaveBeenCalled();
  });

  it('keeps distinct environment spellings on POSIX', async () => {
    const { manager, createTransport } = harness({ environment: { PARENT_TOKEN: 'value' }, platform: 'linux' });
    const configured = { ...config, envRefs: { TOKEN: 'PARENT_TOKEN' }, env: { token: 'session' }, sessionEnvKeys: ['token'] };
    await manager.connect(configured);
    expect(createTransport.mock.calls[0]![0].env).toEqual({ TOKEN: 'value', token: 'session' });
    await manager.disconnect(config.id);
  });
});
