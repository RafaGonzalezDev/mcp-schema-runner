/** Canonical stdio configuration. Literal env values are session-only. */
export type McpServerConfig = {
  id: string;
  name: string;
  transport: 'stdio';
  command: string;
  args: string[];
  env?: Record<string, string>;
  envRefs?: Record<string, string>;
  /** Names only; persisted so a restart can request missing session values. */
  sessionEnvKeys?: string[];
  cwd?: string;
  source?: 'inline' | 'file';
  notes?: string;
};

export type AddServerConfig = Omit<McpServerConfig, 'sessionEnvKeys'>;
export type PublicServerConfig = Omit<McpServerConfig, 'env'>;
export type McpConnectionStatus = 'disconnected' | 'connecting' | 'connected' | 'error';
export type McpServerState = {
  config: PublicServerConfig;
  status: McpConnectionStatus;
  error?: string;
  tools: McpToolSummary[];
  pid?: number;
  builtin?: boolean;
  missingEnvKeys?: string[];
};
export type ServersResponse = { servers: McpServerState[]; migrationPending: boolean };
export type McpToolSummary = { name: string; description?: string; inputSchema: unknown };
export type ToolExecutionStatus = 'success' | 'error';
export type ToolExecutionTrace = {
  serverId: string;
  toolName: string;
  /** Exactly the argument object passed to the SDK, not a JSON-RPC envelope. */
  request: Record<string, unknown>;
  response?: unknown;
  error?: { message: string; name?: string; stack?: string; code?: string | number; raw?: unknown };
  durationMs: number;
  status: ToolExecutionStatus;
  timestamp: string;
};
export type ApiError = { error: string; detail?: string; code?: string };

export function isRecord(value: unknown): value is Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false;
  const proto: unknown = Object.getPrototypeOf(value);
  return proto === Object.prototype || proto === null;
}
export function isStringRecord(value: unknown): value is Record<string, string> {
  return isRecord(value) && Object.entries(value).every(([key, val]) =>
    /^[A-Za-z_][A-Za-z0-9_]*$/.test(key) && typeof val === 'string' && !val.includes('\0'));
}
const fields = new Set(['id', 'name', 'transport', 'command', 'args', 'env', 'envRefs', 'sessionEnvKeys', 'cwd', 'source', 'notes']);
export function isValidMcpServerConfig(value: unknown, caseInsensitiveEnvironment = false): value is McpServerConfig {
  if (!isRecord(value) || Object.keys(value).some((key) => !fields.has(key))) return false;
  for (const key of ['id', 'name', 'command']) {
    const text = value[key];
    if (typeof text !== 'string' || !text.trim() || /[\u0000-\u001f]/.test(text)) return false;
  }
  if (value.transport !== 'stdio' || !Array.isArray(value.args) || !value.args.every((arg) => typeof arg === 'string' && !arg.includes('\0'))) return false;
  if (value.env !== undefined && !isStringRecord(value.env)) return false;
  if (value.envRefs !== undefined && (!isStringRecord(value.envRefs) || !Object.values(value.envRefs).every((ref) => /^[A-Za-z_][A-Za-z0-9_]*$/.test(ref)))) return false;
  if (value.sessionEnvKeys !== undefined && (!Array.isArray(value.sessionEnvKeys) || !value.sessionEnvKeys.every((key) => typeof key === 'string' && /^[A-Za-z_][A-Za-z0-9_]*$/.test(key)) || new Set(value.sessionEnvKeys).size !== value.sessionEnvKeys.length)) return false;
  if (value.cwd !== undefined && (typeof value.cwd !== 'string' || !value.cwd.trim() || value.cwd.includes('\0'))) return false;
  if (value.notes !== undefined && typeof value.notes !== 'string') return false;
  if (value.source !== undefined && value.source !== 'inline' && value.source !== 'file') return false;
  const canonical = (key: string) => caseInsensitiveEnvironment ? key.toUpperCase() : key;
  const refNames = Object.keys((value.envRefs ?? {}) as Record<string, string>);
  const envNames = Object.keys((value.env ?? {}) as Record<string, string>);
  const requiredNames = (value.sessionEnvKeys as string[] | undefined) ?? [];
  for (const keys of [refNames, envNames, requiredNames]) if (new Set(keys.map(canonical)).size !== keys.length) return false;
  const refs = new Set(refNames.map(canonical));
  const session = new Set([...requiredNames, ...envNames]);
  return ![...session].some((key) => refs.has(canonical(key))) && !envNames.some((key) => requiredNames.some((other) => key !== other && canonical(key) === canonical(other)));
}
export function isValidAddServerConfig(value: unknown, caseInsensitiveEnvironment = false): value is AddServerConfig {
  return isValidMcpServerConfig(value, caseInsensitiveEnvironment) && !Object.hasOwn(value, 'sessionEnvKeys');
}
export function publicConfig(config: McpServerConfig): PublicServerConfig {
  const { env: _env, ...rest } = config;
  return { ...rest, sessionEnvKeys: config.sessionEnvKeys ?? Object.keys(config.env ?? {}) };
}
