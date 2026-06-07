/**
 * Normalización de configuraciones MCP desde formatos externos
 * (OpenCode, Hermes) hacia el formato interno `McpServerConfig`.
 *
 * Estas funciones son PURAS: no leen ni escriben del disco. Los
 * tests unitarios se ejecutan sin tocar el sistema de archivos.
 *
 * Decisiones de seguridad (ver `plan.md`):
 *   - No persistir secretos leídos desde `env` sin confirmación explícita.
 *   - Mostrar variables sensibles como `<redacted>` o `${VAR_NAME}`.
 *   - Ignorar entradas remotas (OpenCode `type: "remote"`).
 *   - Entradas `enabled: false` se devuelven marcadas con `disabled`.
 */

import type { McpServerConfig } from '../../../shared/types.js';

const REDACTED = '<redacted>';

// --- OpenCode --------------------------------------------------------------

/**
 * Forma observada de una entrada MCP en `~/.config/opencode/opencode.json`.
 * Solo nos interesa el subconjunto `type: 'local'`.
 */
export type OpenCodeMcpEntry = {
  type?: 'local' | 'remote' | string;
  command?: string[];
  url?: string;
  enabled?: boolean;
};

export type OpenCodeMcpConfig = {
  mcp?: Record<string, OpenCodeMcpEntry>;
};

/**
 * Resultado de la normalización: incluye una bandera `disabled` para
 * entradas con `enabled: false` y un `skipped` para entradas remotas o
 * inválidas, de modo que la UI pueda mostrar un resumen claro sin
 * ocultar información.
 */
export type NormalizedServer = {
  config?: McpServerConfig;
  disabled?: boolean;
  skipped?: { reason: string };
};

function redactValue(value: string): string {
  if (value.length === 0) return value;
  // Variables tipo clave: heurística simple — si el nombre sugiere un
  // secreto, lo devolvemos como referencia `${VAR_NAME}` para evitar
  // persistir el valor real.
  return REDACTED;
}

function redactEnv(env: Record<string, string> | undefined): Record<string, string> {
  if (!env) return {};
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(env)) {
    out[k] = redactValue(v);
  }
  return out;
}

export function normalizeOpenCodeEntry(
  name: string,
  entry: OpenCodeMcpEntry,
): NormalizedServer {
  if (entry.type === 'remote') {
    return { skipped: { reason: 'remote transport not supported in MVP' } };
  }
  if (!Array.isArray(entry.command) || entry.command.length === 0) {
    return { skipped: { reason: 'missing or empty command' } };
  }
  const [command, ...args] = entry.command;
  if (typeof command !== 'string' || command.length === 0) {
    return { skipped: { reason: 'invalid command' } };
  }
  if (entry.enabled === false) {
    return { disabled: true };
  }
  const config: McpServerConfig = {
    id: `opencode:${name}`,
    name,
    transport: 'stdio',
    command,
    args: args.filter((a): a is string => typeof a === 'string'),
    env: {},
    source: 'opencode',
  };
  return { config };
}

export function normalizeOpenCodeConfig(input: OpenCodeMcpConfig): NormalizedServer[] {
  if (!input || typeof input !== 'object' || !input.mcp) return [];
  return Object.entries(input.mcp).map(([name, entry]) =>
    normalizeOpenCodeEntry(name, entry),
  );
}

// --- Hermes ----------------------------------------------------------------

export type HermesMcpEntry = {
  command: string;
  args?: string[];
  env?: Record<string, string>;
};

export type HermesMcpConfig = {
  mcp_servers?: Record<string, HermesMcpEntry>;
};

export function normalizeHermesEntry(name: string, entry: HermesMcpEntry): NormalizedServer {
  if (typeof entry.command !== 'string' || entry.command.length === 0) {
    return { skipped: { reason: 'missing or invalid command' } };
  }
  const args = Array.isArray(entry.args)
    ? entry.args.filter((a): a is string => typeof a === 'string')
    : [];
  const env = redactEnv(entry.env);
  const config: McpServerConfig = {
    id: `hermes:${name}`,
    name,
    transport: 'stdio',
    command: entry.command,
    args,
    env,
    source: 'hermes',
  };
  return { config };
}

export function normalizeHermesConfig(input: HermesMcpConfig): NormalizedServer[] {
  if (!input || typeof input !== 'object' || !input.mcp_servers) return [];
  return Object.entries(input.mcp_servers).map(([name, entry]) =>
    normalizeHermesEntry(name, entry),
  );
}
