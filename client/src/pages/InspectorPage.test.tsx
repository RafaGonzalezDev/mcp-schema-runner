import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReactNode } from 'react';
import type { McpServerState, ServersResponse, ToolExecutionTrace } from '../../../shared/types';
vi.mock('../lib/api', () => ({ listServers: vi.fn(), connectServer: vi.fn(), disconnectServer: vi.fn(), callTool: vi.fn(), setServerEnvironment: vi.fn(), migrateConfig: vi.fn() }));
import * as api from '../lib/api';
import { qk } from '../lib/hooks';
import { InspectorPage } from './InspectorPage';

let client: QueryClient;
const makeServer = (id = 'one'): McpServerState => ({
  config: { id, name: id, transport: 'stdio', command: 'node', args: [] }, status: 'connected',
  tools: [{ name: 'echo', inputSchema: { type: 'object', properties: { message: { type: 'string' } } } }, { name: 'other', inputSchema: { type: 'object' } }],
});
const wrapper = ({ children }: { children: ReactNode }) => <QueryClientProvider client={client}>{children}</QueryClientProvider>;
function cache(servers: McpServerState[], migrationPending = false) {
  const response: ServersResponse = { servers, migrationPending };
  vi.mocked(api.listServers).mockResolvedValue(response);
  act(() => { client.setQueryData(qk.servers, response); });
}
async function settleInitialFetch() {
  await waitFor(() => expect(client.getQueryState(qk.servers)?.fetchStatus).toBe('idle'));
  expect(api.listServers).toHaveBeenCalled();
}

/** Exercise the real refetch path instead of racing an in-flight mount request with setQueryData. */
async function poll(servers: McpServerState[], migrationPending = false) {
  const response: ServersResponse = { servers, migrationPending };
  vi.mocked(api.listServers).mockResolvedValue(response);
  await act(async () => { await client.refetchQueries({ queryKey: qk.servers }); });
  expect(client.getQueryData(qk.servers)).toEqual(response);
}

const editor = () => screen.getByLabelText('Tool arguments (JSON)') as HTMLTextAreaElement;
const choose = (name = 'echo') => fireEvent.click(screen.getByRole('button', { name: new RegExp(`^${name}.*optional args`) }));
const page = (selectedServerId = 'one') => <InspectorPage selectedServerId={selectedServerId} onSelectServer={vi.fn()} />;

beforeEach(() => {
  vi.resetAllMocks();
  client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 }, mutations: { retry: false } } });
  cache([makeServer(), makeServer('two')]);
});
afterEach(() => { cleanup(); client.clear(); });

describe('InspectorPage', () => {
  it('keeps separate drafts when changing tools and servers', () => {
    const { rerender } = render(page(), { wrapper });
    choose();
    fireEvent.change(editor(), { target: { value: '{"manual":"one"}' } });
    choose('other');
    fireEvent.change(editor(), { target: { value: '{"manual":"other"}' } });
    choose();
    expect(editor().value).toBe('{"manual":"one"}');
    rerender(page('two'));
    choose();
    fireEvent.change(editor(), { target: { value: '{"manual":"two"}' } });
    rerender(page());
    expect(editor().value).toBe('{"manual":"one"}');
  });

  it('does not overwrite drafts on polling, schema changes or reconnection', async () => {
    render(page(), { wrapper });
    await settleInitialFetch();
    choose();
    fireEvent.change(editor(), { target: { value: '{"manual":true}' } });
    const changed = makeServer();
    changed.tools[0]!.inputSchema = { type: 'object', properties: { changed: { type: 'number' } } };
    await poll([changed]);
    await waitFor(() => expect(screen.getByText(/"changed"/)).toBeTruthy());
    expect(editor().value).toBe('{"manual":true}');
    await poll([{ ...changed, status: 'disconnected', tools: [] }]);
    await waitFor(() => expect(editor().disabled).toBe(true));
    expect(editor().value).toBe('{"manual":true}');
    await poll([changed]);
    await waitFor(() => expect(editor().disabled).toBe(false));
    expect(editor().value).toBe('{"manual":true}');
    fireEvent.click(screen.getByRole('button', { name: 'from schema' }));
    expect(editor().value).toBe('{\n  "changed": 0\n}');
  });

  it('reacts to a trace written into cache by another subscriber', async () => {
    render(page(), { wrapper });
    choose();
    const trace: ToolExecutionTrace = { serverId: 'one', toolName: 'echo', request: {}, response: { content: 'reactive-result' }, status: 'success', durationMs: 42, timestamp: '2026-01-01T00:00:00Z' };
    act(() => { client.setQueryData(qk.lastTrace('one', 'echo'), trace); });
    await waitFor(() => expect(screen.getByText(/reactive-result/)).toBeTruthy());
    expect(screen.getByRole('status', { name: 'Tool execution status' }).textContent).toContain('succeeded in 42 ms');
  });

  it('reports disconnect failures and disables repeated requests while pending', async () => {
    let reject!: (error: Error) => void;
    vi.mocked(api.disconnectServer).mockReturnValue(new Promise((_resolve, rejectPromise) => { reject = rejectPromise; }));
    render(page(), { wrapper });
    fireEvent.click(screen.getByRole('button', { name: 'disconnect' }));
    await waitFor(() => expect((screen.getByRole('button', { name: 'disconnecting...' }) as HTMLButtonElement).disabled).toBe(true));
    act(() => reject(new Error('Disconnect failed; retry.')));
    await waitFor(() => expect(screen.getByRole('alert').textContent).toContain('Disconnect failed'));
    expect(api.disconnectServer).toHaveBeenCalledTimes(1);
    expect((screen.getByRole('button', { name: 'disconnect' }) as HTMLButtonElement).disabled).toBe(false);
  });

  it('offers cancel connection using the disconnect endpoint', async () => {
    cache([{ ...makeServer(), status: 'connecting', tools: [] }]);
    vi.mocked(api.disconnectServer).mockResolvedValue(undefined);
    render(page(), { wrapper });
    fireEvent.click(screen.getByRole('button', { name: 'cancel connection' }));
    await waitFor(() => expect(api.disconnectServer).toHaveBeenCalledWith('one'));
  });

  it('shows only environment names and references and replaces all session keys', async () => {
    const server = { ...makeServer(), status: 'disconnected' as const, tools: [], missingEnvKeys: ['TOKEN'] };
    server.config = { ...server.config, sessionEnvKeys: ['TOKEN', 'EMPTY'], envRefs: { API_KEY: 'BACKEND_API_KEY' }, ...{ env: { TOKEN: 'must-not-render' } } };
    cache([server]);
    const updated = { ...server, missingEnvKeys: [] };
    vi.mocked(api.setServerEnvironment).mockResolvedValue({ server: updated });
    render(page(), { wrapper });
    expect(screen.queryByText(/must-not-render/)).toBeNull();
    expect(screen.getByText('API_KEY → BACKEND_API_KEY')).toBeTruthy();
    expect((screen.getByRole('button', { name: 'connect' }) as HTMLButtonElement).disabled).toBe(true);
    const token = screen.getByLabelText('Session value: TOKEN') as HTMLInputElement;
    expect(token.type).toBe('password');
    fireEvent.change(token, { target: { value: 'session-token' } });
    fireEvent.click(screen.getByRole('button', { name: 'set session environment' }));
    await waitFor(() => expect(api.setServerEnvironment).toHaveBeenCalledWith('one', { TOKEN: 'session-token', EMPTY: '' }));
    await waitFor(() => expect(token.value).toBe(''));
    expect(screen.queryByText('session-token')).toBeNull();
  });

  it('blocks non-object tool arguments and blocks calls while migration is pending', async () => {
    render(page(), { wrapper });
    await settleInitialFetch();
    choose();
    fireEvent.change(editor(), { target: { value: '[]' } });
    expect((screen.getByRole('button', { name: 'call tool' }) as HTMLButtonElement).disabled).toBe(true);
    fireEvent.change(editor(), { target: { value: '{}' } });
    expect((screen.getByRole('button', { name: 'call tool' }) as HTMLButtonElement).disabled).toBe(false);
    await poll([makeServer()], true);
    await waitFor(() => expect((screen.getByRole('button', { name: 'call tool' }) as HTMLButtonElement).disabled).toBe(true));
    expect(api.callTool).not.toHaveBeenCalled();
  });
});
