import type { AddServerConfig, McpServerState, ToolExecutionTrace, McpToolSummary, ServersResponse } from '../../../shared/types';
const BASE = '/api';
export class ApiRequestError extends Error {
  constructor(message: string, public readonly status: number, public readonly code?: string) { super(message); this.name = 'ApiRequestError'; }
}
let sessionToken: string | undefined;
let bootstrap: Promise<string> | undefined;
async function getToken(): Promise<string> {
  if (sessionToken) return sessionToken;
  bootstrap ??= (async () => {
    const response = await fetch(`${BASE}/session`, { cache: 'no-store' });
    if (!response.ok) throw new ApiRequestError('Unable to establish a local runner session', response.status);
    const data: unknown = await response.json();
    if (!data || typeof data !== 'object' || !('token' in data) || typeof data.token !== 'string') throw new Error('Invalid session response');
    sessionToken = data.token;
    return sessionToken;
  })();
  try { return await bootstrap; } finally { bootstrap = undefined; }
}
async function errorFrom(response: Response): Promise<ApiRequestError> {
  const text = await response.text();
  try {
    const data = JSON.parse(text) as { error?: string; detail?: string; code?: string };
    return new ApiRequestError(data.detail ?? data.error ?? `Request failed (${response.status})`, response.status, data.code);
  } catch {
    const fallback = text.trim();
    return new ApiRequestError(fallback && !fallback.startsWith('<') ? `Request failed (${response.status}): ${fallback.slice(0, 512)}` : `Request failed (${response.status})`, response.status);
  }
}
async function request<T>(method: 'GET' | 'POST' | 'DELETE', path: string, body?: unknown, retryRead = true): Promise<T> {
  const headers: Record<string, string> = { Authorization: `Bearer ${await getToken()}` };
  if (body !== undefined) headers['Content-Type'] = 'application/json';
  const res = await fetch(`${BASE}${path}`, { method, headers, body: body === undefined ? undefined : JSON.stringify(body), cache: 'no-store' });
  if (res.status === 401) {
    sessionToken = undefined;
    // Only reads are safe to repeat after the backend restarts.
    if (method === 'GET' && retryRead) return request<T>(method, path, body, false);
  }
  if (!res.ok) throw await errorFrom(res);
  if (res.status === 204) return undefined as T;
  return await res.json() as T;
}
export async function getHealth(): Promise<{ status: string; service: string; timestamp: string }> {
  const response = await fetch(`${BASE}/health`, { cache: 'no-store' });
  if (!response.ok) throw await errorFrom(response);
  return await response.json() as { status: string; service: string; timestamp: string };
}
export const listServers = () => request<ServersResponse>('GET', '/servers');
export const addServer = (config: AddServerConfig) => request<{ server: McpServerState }>('POST', '/servers', { config });
export const removeServer = (id: string) => request<void>('DELETE', `/servers/${encodeURIComponent(id)}`);
export const connectServer = (id: string) => request<{ server: McpServerState }>('POST', `/servers/${encodeURIComponent(id)}/connect`);
export const disconnectServer = (id: string) => request<void>('POST', `/servers/${encodeURIComponent(id)}/disconnect`);
export const listTools = (id: string) => request<{ tools: McpToolSummary[] }>('GET', `/servers/${encodeURIComponent(id)}/tools`);
export const callTool = (id: string, toolName: string, args: unknown) => request<{ trace: ToolExecutionTrace }>('POST', `/servers/${encodeURIComponent(id)}/tools/${encodeURIComponent(toolName)}/call`, { arguments: args });
export const setServerEnvironment = (id: string, env: Record<string, string>) => request<{ server: McpServerState }>('POST', `/servers/${encodeURIComponent(id)}/environment`, { env });
export const migrateConfig = () => request<void>('POST', '/config/migrate');
