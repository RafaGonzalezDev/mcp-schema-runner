import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReactNode } from 'react';
import type { ServersResponse, ToolExecutionTrace } from '../../../shared/types';
vi.mock('./api', () => ({ getHealth: vi.fn(), listServers: vi.fn(), disconnectServer: vi.fn(), connectServer: vi.fn() }));
import * as api from './api';
import { qk, useServerHealth, useLastTrace, useDisconnect, useServers } from './hooks';

let client: QueryClient;
beforeEach(() => { vi.resetAllMocks(); client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: Infinity }, mutations: { retry: false } } }); });
afterEach(() => { cleanup(); client.clear(); });
const wrapper = ({ children }: { children: ReactNode }) => <QueryClientProvider client={client}>{children}</QueryClientProvider>;
const trace: ToolExecutionTrace = { serverId: 'one', toolName: 'echo', request: {}, status: 'success', response: { content: [] }, durationMs: 5, timestamp: '2026-01-01T00:00:00Z' };

describe('query state', () => {
  it('reports offline after a failed refetch despite retaining cached health', async () => {
    vi.mocked(api.getHealth).mockResolvedValue({ status: 'ok', service: 'test', timestamp: '' });
    const { result } = renderHook(useServerHealth, { wrapper });
    await waitFor(() => expect(result.current.online).toBe(true));
    vi.mocked(api.getHealth).mockRejectedValue(new Error('offline'));
    await act(async () => { await result.current.refetch(); });
    await waitFor(() => expect(result.current.online).toBe(false));
    expect(result.current.data).toBe(true);
    expect(result.current.isError).toBe(true);
  });

  it('exposes migration metadata while preserving an envelope in cache', async () => {
    const response: ServersResponse = { servers: [], migrationPending: true };
    vi.mocked(api.listServers).mockResolvedValue(response);
    const { result } = renderHook(useServers, { wrapper });
    await waitFor(() => expect(result.current.migrationPending).toBe(true));
    expect(result.current.data).toEqual([]);
    expect(client.getQueryData(qk.servers)).toEqual(response);
  });

  it('subscribes reactively to cached traces without making a request', async () => {
    const { result } = renderHook(() => useLastTrace('one', 'echo'), { wrapper });
    expect(result.current.data).toBeUndefined();
    act(() => { client.setQueryData(qk.lastTrace('one', 'echo'), trace); });
    await waitFor(() => expect(result.current.data).toEqual(trace));
  });

  it('clears live tools and pid on disconnect without erasing the trace', async () => {
    client.setQueryData<ServersResponse>(qk.servers, { migrationPending: false, servers: [{ config: { id: 'one', name: 'one', command: 'node', transport: 'stdio', args: [] }, status: 'connected', pid: 10, tools: [{ name: 'echo', inputSchema: {} }] }] });
    client.setQueryData(qk.lastTrace('one', 'echo'), trace);
    vi.mocked(api.disconnectServer).mockResolvedValue(undefined);
    const { result } = renderHook(useDisconnect, { wrapper });
    act(() => result.current.mutate('one'));
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(client.getQueryData<ServersResponse>(qk.servers)?.servers[0]).toMatchObject({ status: 'disconnected', tools: [], pid: undefined });
    expect(client.getQueryData(qk.lastTrace('one', 'echo'))).toEqual(trace);
  });
});
