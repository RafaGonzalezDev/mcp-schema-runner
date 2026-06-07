/**
 * MCP client core.
 *
 * Encapsula el ciclo de vida de un cliente MCP:
 *   - spawn del proceso stdio
 *   - handshake `initialize`
 *   - `tools/list`
 *   - `tools/call`
 *   - cierre limpio
 *
 * Es responsabilidad del `McpManager` mantener el estado en memoria y
 * exponer operaciones de alto nivel. La capa HTTP en `api/` consume
 * este manager; no hay acceso directo desde la UI.
 *
 * Decisiones:
 *   - Una conexión activa por `serverId`. Reconectar cierra la anterior.
 *   - Errores de transporte se traducen a mensajes estables para la UI.
 *   - Duración medida en `tools/call` para el `ExecutionTrace`.
 */

import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import type {
  McpServerConfig,
  McpServerState,
  McpToolSummary,
  ToolExecutionTrace,
} from '../../../shared/types.js';

type Connection = {
  client: Client;
  transport: StdioClientTransport;
  tools: McpToolSummary[];
  pid?: number;
};

export class McpManager {
  private readonly connections = new Map<string, Connection>();

  /** Lista todos los servidores conocidos y su estado actual. */
  listStates(configs: McpServerConfig[]): McpServerState[] {
    return configs.map((config) => this.toState(config));
  }

  /** Estado de un servidor concreto, o `null` si no está configurado. */
  getState(config: McpServerConfig): McpServerState {
    return this.toState(config);
  }

  /**
   * Inicia conexión con un servidor: spawn, initialize y tools/list.
   * Si ya estaba conectado, lo desconecta primero.
   */
  async connect(config: McpServerConfig): Promise<McpServerState> {
    if (config.transport !== 'stdio') {
      throw new Error(`unsupported transport: ${String(config.transport)}`);
    }
    await this.disconnect(config.id);

    const transport = new StdioClientTransport({
      command: config.command,
      args: config.args,
      env: this.buildEnv(config.env),
      cwd: config.cwd,
    });

    const client = new Client(
      { name: 'mcp-schema-runner', version: '0.1.0' },
      { capabilities: {} },
    );

    try {
      await client.connect(transport);
    } catch (err) {
      // Si el handshake falla, intentamos cerrar el transporte.
      try {
        await transport.close();
      } catch {
        // Ignorar errores secundarios al cerrar.
      }
      throw new Error(this.describeError(err, 'failed to connect'));
    }

    const pid = transport.pid ?? undefined;
    this.connections.set(config.id, { client, transport, tools: [], pid });

    try {
      const tools = await this.listTools(config.id);
      this.updateTools(config.id, tools);
    } catch (err) {
      // Si el listado falla, mantenemos la conexión pero marcamos
      // estado de error operacional. La UI puede reintentar.
      this.updateTools(config.id, []);
      throw new Error(this.describeError(err, 'connected but tools/list failed'));
    }

    return this.toState(config);
  }

  /** Cierra la conexión de un servidor, si existe. */
  async disconnect(serverId: string): Promise<void> {
    const conn = this.connections.get(serverId);
    if (!conn) return;
    this.connections.delete(serverId);
    try {
      await conn.client.close();
    } catch {
      // El cliente puede haber sido cerrado por un crash de proceso;
      // cerramos el transporte en cualquier caso.
    }
    try {
      await conn.transport.close();
    } catch {
      // Idem.
    }
  }

  /** Cierra todas las conexiones activas. Llamado en `shutdown`. */
  async disconnectAll(): Promise<void> {
    const ids = [...this.connections.keys()];
    await Promise.allSettled(ids.map((id) => this.disconnect(id)));
  }

  /** Lista tools via `tools/list` y devuelve el resultado sin persistir. */
  async listTools(serverId: string): Promise<McpToolSummary[]> {
    const conn = this.requireConnection(serverId);
    const result = await conn.client.listTools();
    return result.tools.map((t) => ({
      name: t.name,
      description: t.description,
      inputSchema: t.inputSchema,
    }));
  }

  /** Ejecuta una tool via `tools/call` y devuelve una traza normalizada. */
  async callTool(
    config: McpServerConfig,
    toolName: string,
    args: unknown,
  ): Promise<ToolExecutionTrace> {
    const conn = this.requireConnection(config.id);
    const timestamp = new Date().toISOString();
    const start = performance.now();

    try {
      const result = await conn.client.callTool({
        name: toolName,
        arguments: this.coerceArgs(args),
      });
      const durationMs = Math.round(performance.now() - start);

      // `isError` es la señal oficial de error a nivel de tool.
      if (result.isError) {
        return {
          serverId: config.id,
          toolName,
          request: args,
          error: {
            message: this.extractErrorMessage(result.content),
            raw: result,
          },
          durationMs,
          status: 'error',
          timestamp,
        };
      }

      return {
        serverId: config.id,
        toolName,
        request: args,
        response: result,
        durationMs,
        status: 'success',
        timestamp,
      };
    } catch (err) {
      const durationMs = Math.round(performance.now() - start);
      return {
        serverId: config.id,
        toolName,
        request: args,
        error: {
          message: this.describeError(err, 'tool execution failed'),
          name: err instanceof Error ? err.name : undefined,
          stack: err instanceof Error ? err.stack : undefined,
          code:
            err && typeof err === 'object' && 'code' in err
              ? String((err as { code: unknown }).code)
              : undefined,
          raw: err,
        },
        durationMs,
        status: 'error',
        timestamp,
      };
    }
  }

  // -----------------------------------------------------------------------
  // Internals
  // -----------------------------------------------------------------------

  private toState(config: McpServerConfig): McpServerState {
    const conn = this.connections.get(config.id);
    if (!conn) {
      return { config, status: 'disconnected', tools: [] };
    }
    return {
      config,
      status: 'connected',
      tools: conn.tools,
      pid: conn.pid,
    };
  }

  private requireConnection(serverId: string): Connection {
    const conn = this.connections.get(serverId);
    if (!conn) {
      const err = new Error(`server '${serverId}' is not connected`);
      (err as Error & { code?: string }).code = 'NOT_CONNECTED';
      throw err;
    }
    return conn;
  }

  private updateTools(serverId: string, tools: McpToolSummary[]): void {
    const conn = this.connections.get(serverId);
    if (conn) conn.tools = tools;
  }

  private buildEnv(extra: Record<string, string> | undefined): Record<string, string> {
    // Mezcla el entorno del proceso (filtrado por el SDK) con las
    // variables explícitas de la config. Las variables explícitas
    // tienen prioridad.
    const base = process.env as Record<string, string>;
    if (!extra) return base;
    return { ...base, ...extra };
  }

  private coerceArgs(value: unknown): Record<string, unknown> {
    if (value === undefined || value === null) return {};
    if (typeof value === 'object' && !Array.isArray(value)) {
      return value as Record<string, unknown>;
    }
    // Si llega algo inesperado, lo envolvemos. El SDK espera un objeto.
    return { value };
  }

  private describeError(err: unknown, fallback: string): string {
    if (err instanceof Error) {
      const code =
        err && typeof err === 'object' && 'code' in err
          ? ` [${String((err as { code: unknown }).code)}]`
          : '';
      return `${err.message}${code}`;
    }
    return `${fallback}: ${String(err)}`;
  }

  private extractErrorMessage(content: unknown): string {
    if (!Array.isArray(content) || content.length === 0) return 'tool reported error';
    const first = content[0] as { type?: string; text?: string };
    if (first && typeof first === 'object' && 'text' in first && typeof first.text === 'string') {
      return first.text;
    }
    return 'tool reported error';
  }
}
