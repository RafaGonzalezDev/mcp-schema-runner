import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import type { Transport } from '@modelcontextprotocol/sdk/shared/transport.js';
import { isRecord, publicConfig, type McpServerConfig, type McpServerState, type McpToolSummary, type ToolExecutionTrace } from '../../../shared/types.js';
import { withAbsolutePaths } from '../config/expandPaths.js';

export class McpOperationError extends Error {
  constructor(message: string, public readonly code: string) { super(message); this.name = 'McpOperationError'; }
}
type ManagedClient = Pick<Client, 'connect' | 'close' | 'listTools' | 'callTool'> & {
  onclose?: () => void;
  onerror?: (error: Error) => void;
};
type ManagedTransport = Transport & { readonly pid?: number | null };
export type McpManagerOptions = {
  timeoutMs?: number;
  environment?: NodeJS.ProcessEnv;
  platform?: NodeJS.Platform;
  createClient?: () => ManagedClient;
  createTransport?: (config: McpServerConfig) => ManagedTransport;
};
type Connection = {
  status: McpServerState['status'];
  tools: McpToolSummary[];
  abort: AbortController;
  client?: ManagedClient;
  transport?: ManagedTransport;
  operation?: Promise<void>;
  closing?: Promise<void>;
  error?: string;
  pid?: number;
  intentionalClose?: boolean;
};

/** Owns pending and established connections, including cancellation and cleanup. */
export class McpManager {
  private readonly connections = new Map<string, Connection>();
  private stopping = false;
  private readonly timeoutMs: number;
  private readonly environment: NodeJS.ProcessEnv;
  constructor(private readonly options: McpManagerOptions = {}) {
    this.timeoutMs = options.timeoutMs ?? 30_000;
    if (!Number.isInteger(this.timeoutMs) || this.timeoutMs < 1 || this.timeoutMs > 600_000) throw new Error('Invalid MCP request timeout');
    this.environment = options.environment ?? process.env;
  }

  private environmentValue(ref: string): string | undefined {
    if ((this.options.platform ?? process.platform) !== 'win32') return this.environment[ref];
    // Model Windows lookup for injected plain objects as well as process.env.
    const key = Object.keys(this.environment).sort().find((name) =>
      name.toUpperCase() === ref.toUpperCase() && this.environment[name] !== undefined);
    return key === undefined ? undefined : this.environment[key];
  }

  missingEnvironment(config: McpServerConfig): string[] {
    const missing = (config.sessionEnvKeys ?? Object.keys(config.env ?? {})).filter((key) => !Object.hasOwn(config.env ?? {}, key));
    for (const [key, ref] of Object.entries(config.envRefs ?? {})) {
      if (this.environmentValue(ref) === undefined) missing.push(key);
    }
    return [...new Set(missing)];
  }
  private explicitEnvironment(config: McpServerConfig): Record<string, string> {
    const missing = this.missingEnvironment(config);
    if (missing.length) throw new McpOperationError(`Provide environment values for: ${missing.join(', ')}`, 'ENV_REQUIRED');
    const sessionKeys = config.sessionEnvKeys ?? Object.keys(config.env ?? {});
    const names = [...new Set(sessionKeys), ...Object.keys(config.envRefs ?? {})];
    const normalized = names.map((key) => (this.options.platform ?? process.platform) === 'win32' ? key.toUpperCase() : key);
    if (new Set(normalized).size !== names.length) throw new McpOperationError('Environment variable names overlap', 'BAD_REQUEST');
    const refs = Object.fromEntries(Object.entries(config.envRefs ?? {}).map(([key, ref]) => [key, this.environmentValue(ref)!]));
    const explicit = { ...refs, ...config.env };
    if (Object.values(explicit).some((value) => value.includes('\0'))) {
      throw new McpOperationError('Environment values cannot contain NUL characters', 'BAD_REQUEST');
    }
    // Match the SDK's uppercase default keys so explicit Windows overrides win.
    return (this.options.platform ?? process.platform) === 'win32'
      ? Object.fromEntries(Object.entries(explicit).map(([key, value]) => [key.toUpperCase(), value]))
      : explicit;
  }
  listStates(configs: McpServerConfig[]): McpServerState[] { return configs.map((config) => this.getState(config)); }
  getState(config: McpServerConfig): McpServerState {
    const conn = this.connections.get(config.id);
    return {
      config: publicConfig(config), status: conn?.status ?? 'disconnected',
      tools: conn?.tools ?? [], error: conn?.error, pid: conn?.pid,
      missingEnvKeys: this.missingEnvironment(config),
    };
  }
  isBusy(id: string): boolean {
    const conn = this.connections.get(id);
    return !!conn && (!!conn.closing || conn.status === 'connected' || conn.status === 'connecting');
  }

  async connect(config: McpServerConfig): Promise<McpServerState> {
    if (this.stopping) throw new McpOperationError('Runner is shutting down', 'SHUTTING_DOWN');
    if (config.transport !== 'stdio') throw new McpOperationError('Only stdio is supported', 'BAD_REQUEST');
    const previous = this.connections.get(config.id);
    if (previous?.closing) throw new McpOperationError('Server is disconnecting; retry when complete', 'BUSY');
    if (previous?.status === 'connected') return this.getState(config);
    if (previous?.status === 'connecting') {
      await previous.operation;
      return this.getState(config);
    }
    const normalized = withAbsolutePaths({ ...config, env: this.explicitEnvironment(config) });
    const conn: Connection = { status: 'connecting', tools: [], abort: new AbortController() };
    this.connections.set(config.id, conn);
    conn.operation = this.open(normalized, conn);
    await conn.operation;
    return this.getState(config);
  }
  private async open(config: McpServerConfig, conn: Connection): Promise<void> {
    try {
      conn.transport = this.options.createTransport?.(config) ?? new StdioClientTransport({ command: config.command, args: config.args, env: config.env, cwd: config.cwd });
      conn.client = this.options.createClient?.() ?? new Client({ name: 'mcp-schema-runner', version: '0.1.0' }, { capabilities: {} });
      conn.client.onclose = () => {
        if (this.connections.get(config.id) !== conn) return;
        conn.status = conn.intentionalClose ? 'disconnected' : 'error';
        conn.error = conn.intentionalClose ? undefined : 'MCP process closed unexpectedly';
        conn.tools = [];
        conn.pid = undefined;
        conn.abort.abort();
      };
      conn.client.onerror = () => {
        if (this.connections.get(config.id) !== conn || conn.abort.signal.aborted) return;
        conn.error = 'MCP transport reported an error';
        conn.status = 'error';
        conn.abort.abort();
        void this.close(conn).then(() => {
          conn.closing = undefined;
          if (this.connections.get(config.id) === conn && !conn.intentionalClose) {
            conn.status = 'error';
            conn.error = 'MCP transport reported an error';
          }
        });
      };
      await conn.client.connect(conn.transport, { timeout: this.timeoutMs, signal: conn.abort.signal });
      if (conn.abort.signal.aborted) throw new McpOperationError('Connection cancelled', 'CANCELLED');
      conn.tools = await this.fetchTools(conn);
      if (conn.abort.signal.aborted) throw new McpOperationError('Connection cancelled', 'CANCELLED');
      conn.pid = conn.transport.pid ?? undefined;
      conn.status = 'connected';
      conn.error = undefined;
    } catch (error) {
      const cancelled = !!conn.intentionalClose;
      conn.abort.abort();
      await this.close(conn);
      conn.closing = undefined;
      conn.status = cancelled ? 'disconnected' : 'error';
      conn.tools = [];
      conn.pid = undefined;
      conn.error = cancelled ? undefined : 'Failed to initialize MCP server; check its command and stderr';
      throw new McpOperationError(cancelled ? 'Connection cancelled' : conn.error!, cancelled ? 'CANCELLED' : 'MCP_CONNECT_FAILED');
    }
  }
  private close(conn: Connection): Promise<void> {
    conn.closing ??= (async () => {
      try { await conn.client?.close(); } catch { /* Always close transport too. */ }
      try { await conn.transport?.close(); } catch { /* Idempotent after process exit. */ }
    })();
    return conn.closing;
  }
  async disconnect(id: string): Promise<void> {
    const conn = this.connections.get(id);
    if (!conn) return;
    conn.intentionalClose = true;
    conn.abort.abort();
    await this.close(conn);
    await conn.operation?.catch(() => undefined);
    if (this.connections.get(id) === conn) this.connections.delete(id);
  }
  async disconnectAll(): Promise<void> {
    this.stopping = true;
    await Promise.allSettled([...this.connections.keys()].map((id) => this.disconnect(id)));
  }
  private requireConnection(id: string): Connection & { client: ManagedClient } {
    const conn = this.connections.get(id);
    if (!conn?.client || conn.status !== 'connected' || conn.abort.signal.aborted || conn.closing) throw new McpOperationError('Server is not connected', 'NOT_CONNECTED');
    return conn as Connection & { client: ManagedClient };
  }
  private async fetchTools(conn: Connection): Promise<McpToolSummary[]> {
    if (!conn.client) throw new McpOperationError('Server is not connected', 'NOT_CONNECTED');
    const tools: McpToolSummary[] = [];
    const seen = new Set<string>();
    let cursor: string | undefined;
    do {
      const result = await conn.client.listTools(cursor ? { cursor } : undefined, { timeout: this.timeoutMs, signal: conn.abort.signal });
      tools.push(...result.tools.map((tool) => ({ name: tool.name, description: tool.description, inputSchema: tool.inputSchema })));
      cursor = result.nextCursor;
      if (cursor && seen.has(cursor)) throw new McpOperationError('Repeated tools/list cursor', 'MCP_LIST_FAILED');
      if (cursor) seen.add(cursor);
      if (seen.size > 1000) throw new McpOperationError('Too many tool inventory pages', 'MCP_LIST_FAILED');
    } while (cursor);
    return tools;
  }
  async listTools(id: string): Promise<McpToolSummary[]> {
    const conn = this.requireConnection(id);
    const tools = await this.fetchTools(conn);
    if (!conn.abort.signal.aborted && this.connections.get(id) === conn) conn.tools = tools;
    return tools;
  }
  async callTool(config: McpServerConfig, toolName: string, args: unknown): Promise<ToolExecutionTrace> {
    if (!isRecord(args)) throw new McpOperationError('Tool arguments must be a JSON object', 'BAD_REQUEST');
    const conn = this.requireConnection(config.id);
    const request = structuredClone(args);
    const timestamp = new Date().toISOString();
    const start = performance.now();
    const base = { serverId: config.id, toolName, request, timestamp };
    try {
      const result = await conn.client.callTool({ name: toolName, arguments: request }, undefined, { timeout: this.timeoutMs, signal: conn.abort.signal });
      const durationMs = Math.round(performance.now() - start);
      if (result.isError) return { ...base, durationMs, status: 'error', error: { message: this.toolError(result.content), raw: result } };
      return { ...base, durationMs, status: 'success', response: result };
    } catch (error) {
      return { ...base, durationMs: Math.round(performance.now() - start), status: 'error', error: {
        message: conn.abort.signal.aborted ? 'Tool call cancelled or connection closed' : error instanceof Error ? error.message : 'Tool execution failed',
        name: error instanceof Error ? error.name : undefined,
        code: error && typeof error === 'object' && 'code' in error ? String(error.code) : undefined,
      } };
    }
  }
  private toolError(content: unknown): string {
    if (Array.isArray(content)) {
      const text = content.find((item: unknown) => isRecord(item) && typeof item.text === 'string') as { text: string } | undefined;
      if (text) return text.text;
    }
    return 'Tool reported an error';
  }
}
