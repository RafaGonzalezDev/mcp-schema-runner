import {
  useMutation,
  useQuery,
  useQueryClient,
  type UseMutationResult,
} from '@tanstack/react-query';
import * as api from './api';
import type { McpServerState, ToolExecutionTrace } from '../../../shared/types';

// ---- Keys ------------------------------------------------------------------

export const qk = {
  servers: ['servers'] as const,
  tools: (id: string) => ['servers', id, 'tools'] as const,
  lastTrace: (id: string, toolName: string) =>
    ['servers', id, 'tools', toolName, 'lastTrace'] as const,
};

// ---- Queries ---------------------------------------------------------------

export function useServers() {
  return useQuery({
    queryKey: qk.servers,
    queryFn: () => api.listServers().then((r) => r.servers),
    refetchInterval: 1500, // refresca estado de conexión
    refetchOnWindowFocus: true,
  });
}

export function useServerHealth() {
  return useQuery({
    queryKey: ['health'],
    queryFn: () => api.getHealth().then(() => true),
    refetchInterval: 5000,
    retry: false,
  });
}

// ---- Mutations -------------------------------------------------------------

export function useConnect(): UseMutationResult<McpServerState, Error, string> {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => api.connectServer(id).then((r) => r.server),
    onSuccess: (server) => {
      qc.setQueryData<McpServerState[]>(qk.servers, (prev) =>
        prev ? prev.map((s) => (s.config.id === server.config.id ? server : s)) : [server],
      );
      qc.invalidateQueries({ queryKey: qk.tools(server.config.id) });
    },
  });
}

export function useDisconnect(): UseMutationResult<void, Error, string> {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => api.disconnectServer(id),
    onSuccess: (_void, id) => {
      qc.setQueryData<McpServerState[]>(qk.servers, (prev) =>
        prev
          ? prev.map((s) =>
              s.config.id === id ? { ...s, status: 'disconnected', tools: [] } : s,
            )
          : prev,
      );
      qc.removeQueries({ queryKey: qk.tools(id) });
    },
  });
}

export function useAddServer(): UseMutationResult<McpServerState, Error, unknown> {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (config: unknown) => api.addServer(config as never).then((r) => r.server),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: qk.servers });
    },
  });
}

export function useRemoveServer(): UseMutationResult<void, Error, string> {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => api.removeServer(id),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: qk.servers });
    },
  });
}

export function useCallTool(): UseMutationResult<
  ToolExecutionTrace,
  Error,
  { serverId: string; toolName: string; args: unknown }
> {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ serverId, toolName, args }) =>
      api.callTool(serverId, toolName, args).then((r) => r.trace),
    onSuccess: (trace) => {
      qc.setQueryData(qk.lastTrace(trace.serverId, trace.toolName), trace);
    },
  });
}
