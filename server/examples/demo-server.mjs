#!/usr/bin/env node
/**
 * Bundled demo MCP server (stdio).
 *
 * Deterministic and fully offline: it only uses the SDK already installed in
 * the server package. It backs the built-in `demo` fixture so the runner can be
 * exercised end to end without downloading third-party packages.
 */
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { CallToolRequestSchema, ListToolsRequestSchema } from '@modelcontextprotocol/sdk/types.js';

const tools = [
  {
    name: 'echo',
    description: 'Return the provided text unchanged.',
    inputSchema: {
      type: 'object',
      properties: { text: { type: 'string', description: 'Text to echo back.' } },
      required: ['text'],
      additionalProperties: false,
    },
  },
  {
    name: 'add',
    description: 'Add two numbers and return the sum.',
    inputSchema: {
      type: 'object',
      properties: { a: { type: 'number' }, b: { type: 'number' } },
      required: ['a', 'b'],
      additionalProperties: false,
    },
  },
  {
    name: 'now',
    description: 'Return the current time as an ISO-8601 string.',
    inputSchema: { type: 'object', properties: {}, additionalProperties: false },
  },
];

function text(value) {
  return { content: [{ type: 'text', text: value }] };
}

function failure(message) {
  return { isError: true, content: [{ type: 'text', text: message }] };
}

const server = new Server({ name: 'mcp-schema-runner-demo', version: '1.0.0' }, { capabilities: { tools: {} } });

server.setRequestHandler(ListToolsRequestSchema, async () => ({ tools }));

server.setRequestHandler(CallToolRequestSchema, async ({ params }) => {
  const args = params.arguments ?? {};
  if (params.name === 'echo') {
    if (typeof args.text !== 'string') return failure('"text" must be a string.');
    return text(args.text);
  }
  if (params.name === 'add') {
    if (typeof args.a !== 'number' || typeof args.b !== 'number') return failure('"a" and "b" must be numbers.');
    return text(String(args.a + args.b));
  }
  if (params.name === 'now') return text(new Date().toISOString());
  return failure(`Unknown tool: ${params.name}`);
});

// The manager closes stdin when disconnecting, so exit instead of lingering.
process.stdin.on('end', () => { void server.close().then(() => process.exit(0)); });

await server.connect(new StdioServerTransport());
