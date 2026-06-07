/**
 * Expansión de paths relativos en fixtures a paths absolutos.
 *
 * Sólo se ejecuta en el server. Se aplica a las configs leídas desde
 * `shared/fixtures.ts` para que `npx @modelcontextprotocol/server-filesystem
 * ./fixtures-workspace` funcione independientemente del CWD.
 */

import { fileURLToPath } from 'node:url';
import { dirname, isAbsolute, resolve } from 'node:path';
import type { McpServerConfig } from '../../../shared/types.js';

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../../..');

/** Devuelve una copia del fixture con paths absolutos cuando aplique. */
export function withAbsolutePaths(config: McpServerConfig): McpServerConfig {
  const expandedArgs = config.args.map((a) => (isPathPlaceholder(a) ? resolveAbsolute(a) : a));
  return { ...config, args: expandedArgs };
}

/** Heurística: tratamos como path cualquier arg que no empiece por `-` ni sea una URL. */
function isPathPlaceholder(arg: string): boolean {
  if (arg.startsWith('-')) return false;
  if (arg.includes('://')) return false;
  if (isAbsolute(arg)) return false;
  return arg.startsWith('./') || arg.startsWith('../') || arg.startsWith('fixtures-');
}

function resolveAbsolute(p: string): string {
  return isAbsolute(p) ? p : resolve(repoRoot, p);
}
