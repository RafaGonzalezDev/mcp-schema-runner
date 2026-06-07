/**
 * Tipos compartidos entre cliente y servidor.
 *
 * El cliente solo debe consumir este módulo a través de la API HTTP; los
 * tipos aquí son el contrato. Mantenerlos sincronizados con la
 * implementación del servidor en `server/src/api/`.
 */

// --- Server configuration ---------------------------------------------------

/**
 * Configuración normalizada de un servidor MCP.
 *
 * El MVP solo soporta transporte `stdio`. Futuras iteraciones podrán
 * extender la unión para incluir `sse`, `http`, etc.
 */
export type McpServerConfig = {
  /** Identificador único, estable, usado por la UI y la API. */
  id: string;
  /** Nombre legible mostrado en la UI. */
  name: string;
  /** Transporte. En el MVP solo se soporta `stdio`. */
  transport: 'stdio';
  /** Comando ejecutable (ej. `npx`, `node`, `python`). */
  command: string;
  /** Argumentos del comando. */
  args: string[];
  /** Variables de entorno adicionales (opcional). */
  env?: Record<string, string>;
  /** Directorio de trabajo (opcional). */
  cwd?: string;
  /** Origen de la configuración, para mostrarla en la UI. */
  source?: 'inline' | 'file' | 'opencode' | 'hermes';
  /** Notas opcionales. */
  notes?: string;
};

// --- Server state (runtime) -------------------------------------------------

export type McpConnectionStatus =
  | 'disconnected'
  | 'connecting'
  | 'connected'
  | 'error';

export type McpServerState = {
  config: McpServerConfig;
  status: McpConnectionStatus;
  /** Mensaje de error si `status === 'error'`. */
  error?: string;
  /** Tools conocidas tras un `tools/list` exitoso. */
  tools: McpToolSummary[];
  /** PID del proceso si está conectado. */
  pid?: number;
};

export type McpToolSummary = {
  name: string;
  description?: string;
  /** `inputSchema` tal como lo devuelve el servidor. */
  inputSchema: unknown;
};

// --- Execution trace --------------------------------------------------------

export type ToolExecutionStatus = 'success' | 'error';

export type ToolExecutionTrace = {
  serverId: string;
  toolName: string;
  /** Argumentos enviados al servidor. */
  request: unknown;
  /** Resultado si la tool devolvió contenido. */
  response?: unknown;
  /** Detalle de error si la ejecución falló. */
  error?: {
    message: string;
    name?: string;
    stack?: string;
    code?: string | number;
    raw?: unknown;
  };
  durationMs: number;
  status: ToolExecutionStatus;
  timestamp: string;
};

// --- API error shape --------------------------------------------------------

export type ApiError = {
  error: string;
  detail?: string;
  code?: string;
};

// --- Validation helpers -----------------------------------------------------

export function isValidMcpServerConfig(value: unknown): value is McpServerConfig {
  if (typeof value !== 'object' || value === null) return false;
  const v = value as Record<string, unknown>;
  if (typeof v.id !== 'string' || v.id.length === 0) return false;
  if (typeof v.name !== 'string' || v.name.length === 0) return false;
  if (v.transport !== 'stdio') return false;
  if (typeof v.command !== 'string' || v.command.length === 0) return false;
  if (!Array.isArray(v.args)) return false;
  if (!v.args.every((a) => typeof a === 'string')) return false;
  if (v.env !== undefined) {
    if (typeof v.env !== 'object' || v.env === null) return false;
    if (!Object.values(v.env as Record<string, unknown>).every((x) => typeof x === 'string')) {
      return false;
    }
  }
  if (v.cwd !== undefined && typeof v.cwd !== 'string') return false;
  return true;
}
