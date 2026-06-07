/**
 * Helpers de selección y formato compartidos por la UI.
 *
 * Mantenerlos puros permite reutilizarlos desde múltiples
 * componentes y testarlos sin un servidor.
 */

import type { McpServerState, McpToolSummary, ToolExecutionTrace } from '../../../shared/types';

export function findServer(
  servers: McpServerState[] | undefined,
  id: string | null,
): McpServerState | undefined {
  if (!servers || !id) return undefined;
  return servers.find((s) => s.config.id === id);
}

export function findTool(
  tools: McpToolSummary[] | undefined,
  name: string | null,
): McpToolSummary | undefined {
  if (!tools || !name) return undefined;
  return tools.find((t) => t.name === name);
}

/**
 * Pretty-print JSON con 2 espacios. Devuelve `fallback` si el valor
 * no se puede serializar (por ejemplo, referencias circulares).
 */
export function formatJson(value: unknown, fallback = ''): string {
  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return fallback;
  }
}

export function parseJson(text: string): { ok: true; value: unknown } | { ok: false; error: string } {
  if (text.trim().length === 0) {
    return { ok: true, value: {} };
  }
  try {
    return { ok: true, value: JSON.parse(text) };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return { ok: false, error: message };
  }
}

/** Intenta derivar un objeto inicial razonable desde un JSON Schema. */
export function exampleFromSchema(schema: unknown): string {
  if (!schema || typeof schema !== 'object') return '{}';
  const s = schema as Record<string, unknown>;
  const type = s['type'];
  if (type === 'object') {
    const props = s['properties'];
    if (props && typeof props === 'object') {
      const obj: Record<string, unknown> = {};
      for (const [key, sub] of Object.entries(props as Record<string, unknown>)) {
        obj[key] = exampleForType(sub);
      }
      return JSON.stringify(obj, null, 2);
    }
    return '{}';
  }
  return JSON.stringify(exampleForType(schema), null, 2);
}

function exampleForType(schema: unknown): unknown {
  if (!schema || typeof schema !== 'object') return null;
  const s = schema as Record<string, unknown>;
  if (s['example'] !== undefined) return s['example'];
  if (s['default'] !== undefined) return s['default'];
  if (Array.isArray(s['enum']) && s['enum'].length > 0) return s['enum'][0];
  switch (s['type']) {
    case 'string': return '';
    case 'number':
    case 'integer': return 0;
    case 'boolean': return false;
    case 'array': return [];
    case 'object': return {};
    case 'null': return null;
    default: return null;
  }
}

/** Convierte duración en ms a string legible: `123 ms` o `1.45 s`. */
export function formatDuration(ms: number): string {
  if (ms < 1000) return `${ms} ms`;
  return `${(ms / 1000).toFixed(2)} s`;
}

export function summarizeTrace(trace: ToolExecutionTrace): string {
  return trace.status === 'success' ? 'success' : 'error';
}
