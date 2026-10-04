/**
 * Built-in example configurations, shared by the client and the server.
 *
 * The server injects them as built-ins when building the router and expands
 * relative working directories (see `server/src/config/expandPaths.ts`).
 * The client uses them for the Home page starter values.
 *
 * None of them connect automatically: every connection stays an explicit user
 * action. `demo` runs a bundled offline script; the rest download third-party
 * packages and need network access.
 */

import type { McpServerConfig } from './types.js';

/** Workspace path relative to the checkout, resolved by the server. */
export const FIXTURES_WORKSPACE = './fixtures-workspace';

export const builtinFixtures: McpServerConfig[] = [
  {
    id: 'demo',
    name: 'demo',
    transport: 'stdio',
    command: 'node',
    args: ['server/examples/demo-server.mjs'],
    env: {},
    source: 'inline',
    notes: 'Bundled offline demo with echo, add and now tools. No download or network access.',
  },
  {
    id: 'filesystem',
    name: 'filesystem',
    transport: 'stdio',
    command: 'npx',
    args: ['-y', '@modelcontextprotocol/server-filesystem@2026.8.31', FIXTURES_WORKSPACE],
    env: {},
    source: 'inline',
    notes: 'Optional filesystem demo; downloads a pinned package and accesses fixtures-workspace/.',
  },
  {
    id: 'context7',
    name: 'context7',
    transport: 'stdio',
    command: 'npx',
    args: ['-y', '@upstash/context7-mcp@4.1.1'],
    env: {},
    source: 'inline',
    notes: 'Optional documentation demo; requires network access and may require an API key.',
  },
  {
    id: 'playwright',
    name: 'playwright',
    transport: 'stdio',
    command: 'npx',
    args: [
      '-y',
      '@playwright/mcp@0.0.83',
      '--browser',
      'chrome',
      '--viewport-size',
      '1920x1080',
    ],
    env: {},
    source: 'inline',
    notes: 'Optional browser demo; requires Chrome, network access and a package download.',
  },
];
