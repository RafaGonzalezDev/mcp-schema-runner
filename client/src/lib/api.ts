/**
 * Cliente HTTP para la API local.
 *
 * Mantenemos las URLs y la forma de las respuestas centralizadas. Los
 * hooks de React Query consumen estas funciones y se encargan de
 * caching, reintentos e invalidación.
 */

import type {
  McpServerState,
  McpServerConfig,
  ToolExecutionTrace,
  McpToolSummary,
} from '../../../shared/types';

const BASE = '/api';

async function request<T>(
  method: 'GET' | 'POST' | 'DELETE',
  path: string,
  body?: unknown,
  init?: RequestInit,
): Promise<T> {
  const res = await fetch(`${BASE}${path}`, {
    method,
    headers: body ? { 'Content-Type': 'application/json' } : undefined,
    body: body ? JSON.stringify(body) : undefined,
    ...init,
  });
  if (!res.ok) {
    let detail: string | undefined;
    try {
      const data = (await res.json()) as { error?: string; detail?: string };
      detail = data.detail ?? data.error;
    } catch {
      detail = await res.text().catch(() => undefined);
    }
    throw new Error(detail ?? `${method} ${path} failed (${res.status})`);
  }
  if (res.status === 204) return undefined as T;
  return (await res.json()) as T;
}

// ---- Health ----------------------------------------------------------------

export const getHealth = () =>
  request<{ status: string; service: string; timestamp: string }>('GET', '/health');

// ---- Servers ---------------------------------------------------------------

export const listServers = () =>
  request<{ servers: McpServerState[] }>('GET', '/servers');

export const addServer = (config: McpServerConfig) =>
  request<{ server: McpServerState }>('POST', '/servers', { config });

export const removeServer = (id: string) =>
  request<void>('DELETE', `/servers/${encodeURIComponent(id)}`);

export const connectServer = (id: string) =>
  request<{ server: McpServerState }>('POST', `/servers/${encodeURIComponent(id)}/connect`);

export const disconnectServer = (id: string) =>
  request<void>('POST', `/servers/${encodeURIComponent(id)}/disconnect`);

// ---- Tools -----------------------------------------------------------------

export const listTools = (id: string) =>
  request<{ tools: McpToolSummary[] }>('GET', `/servers/${encodeURIComponent(id)}/tools`);

export const callTool = (id: string, toolName: string, args: unknown) =>
  request<{ trace: ToolExecutionTrace }>(
    'POST',
    `/servers/${encodeURIComponent(id)}/tools/${encodeURIComponent(toolName)}/call`,
    { arguments: args },
  );
