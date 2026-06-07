/**
 * Fixtures de configuraciones MCP normalizadas.
 *
 * Compartidas entre cliente y servidor:
 *   - El servidor las inyecta como built-ins al construir el router y
 *     expande paths relativos a absolutos si es necesario.
 *   - El cliente las usa para mostrar snippets en la HomePage.
 *
 * IMPORTANTE: ninguna se conecta automáticamente al iniciar la app
 * (mitigación de riesgo de ejecución de comandos locales).
 *
 * NOTA sobre rutas: los paths de los fixtures se mantienen como
 * strings simples. El servidor los convierte en absolutos al
 * cargarlos (ver `server/src/config/expandPaths.ts`).
 */

import type { McpServerConfig } from './types.js';

/** Path relativo al repo, usado por el server para resolver el absoluto. */
export const FIXTURES_WORKSPACE = './fixtures-workspace';

export const builtinFixtures: McpServerConfig[] = [
  {
    id: 'filesystem',
    name: 'filesystem',
    transport: 'stdio',
    command: 'npx',
    args: ['-y', '@modelcontextprotocol/server-filesystem', FIXTURES_WORKSPACE],
    env: {},
    source: 'inline',
    notes: 'Fixture reproducible: lee y lista el subdirectorio fixtures-workspace/.',
  },
  {
    id: 'context7',
    name: 'context7',
    transport: 'stdio',
    command: 'npx',
    args: ['-y', '@upstash/context7-mcp'],
    env: {},
    source: 'inline',
    notes: 'Fixture real de documentación MCP (presente en OpenCode y Hermes).',
  },
  {
    id: 'playwright',
    name: 'playwright',
    transport: 'stdio',
    command: 'npx',
    args: [
      '@playwright/mcp@latest',
      '--browser',
      'chrome',
      '--viewport-size',
      '1920x1080',
    ],
    env: {},
    source: 'inline',
    notes: 'Fixture pesado para validar tools con schemas amplios.',
  },
];
