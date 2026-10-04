import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import * as api from './api';
import type { AddServerConfig, McpServerState, ServersResponse, ToolExecutionTrace } from '../../../shared/types';

export const qk = {
  servers: ['servers'] as const,
  tools: (id: string) => ['servers', id, 'tools'] as const,
  lastTrace: (id: string, toolName: string) => ['traces', id, toolName] as const,
};

export function useServers() {
  const query = useQuery({
    queryKey: qk.servers,
    queryFn: api.listServers,
    refetchInterval: 1500,
    refetchOnWindowFocus: true,
  });
  return { ...query, data: query.data?.servers, migrationPending: query.data?.migrationPending ?? false };
}

export function useServerHealth() {
  const query = useQuery({
    queryKey: ['health'],
    queryFn: () => api.getHealth().then(() => true),
    refetchInterval: 5000,
    retry: false,
  });
  return { ...query, online: query.data === true && !query.isError };
}

function replaceServer(previous: ServersResponse | undefined, server: McpServerState): ServersResponse | undefined {
  if (!previous) return undefined;
  return { ...previous, servers: previous.servers.map((item) => item.config.id === server.config.id ? server : item) };
}

export function useConnect() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => api.connectServer(id).then((r) => r.server),
    onSuccess: (server) => {
      qc.setQueryData<ServersResponse>(qk.servers, (prev) => replaceServer(prev, server));
      void qc.invalidateQueries({ queryKey: qk.servers });
    },
    onError: () => { void qc.invalidateQueries({ queryKey: qk.servers }); },
  });
}

export function useDisconnect() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => api.disconnectServer(id),
    onSuccess: (_result, id) => {
      qc.setQueryData<ServersResponse>(qk.servers, (prev) => prev ? {
        ...prev,
        servers: prev.servers.map((server) => server.config.id === id
          ? { ...server, status: 'disconnected', tools: [], pid: undefined } : server),
      } : undefined);
      void qc.invalidateQueries({ queryKey: qk.servers });
    },
  });
}

export function useAddServer() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (config: AddServerConfig) => api.addServer(config).then((r) => r.server),
    onSuccess: () => { void qc.invalidateQueries({ queryKey: qk.servers }); },
  });
}

export function useRemoveServer() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => api.removeServer(id),
    onSuccess: () => { void qc.invalidateQueries({ queryKey: qk.servers }); },
  });
}

export function useSetServerEnvironment() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, env }: { id: string; env: Record<string, string> }) => api.setServerEnvironment(id, env).then((r) => r.server),
    onSuccess: (server) => {
      qc.setQueryData<ServersResponse>(qk.servers, (prev) => replaceServer(prev, server));
      void qc.invalidateQueries({ queryKey: qk.servers });
    },
  });
}

export function useMigrateConfig() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: api.migrateConfig,
    onSuccess: () => qc.invalidateQueries({ queryKey: qk.servers }),
  });
}

export function useLastTrace(serverId: string | null, toolName: string | null) {
  return useQuery<ToolExecutionTrace | undefined>({
    queryKey: qk.lastTrace(serverId ?? '', toolName ?? ''),
    queryFn: () => undefined,
    enabled: false,
    gcTime: Infinity,
  });
}

export function useCallTool() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ serverId, toolName, args }: { serverId: string; toolName: string; args: unknown }) =>
      api.callTool(serverId, toolName, args).then((r) => r.trace),
    onSuccess: (trace) => { qc.setQueryData(qk.lastTrace(trace.serverId, trace.toolName), trace); },
  });
}
