import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { ListToolsRequestSchema, CallToolRequestSchema } from '@modelcontextprotocol/sdk/types.js';

if (process.argv.includes('--hang-initialize')) {
  await new Promise((done) => { process.stdin.once('end', done); process.stdin.resume(); });
  process.exit(0);
}

const server = new Server({ name: 'runner-test-fixture', version: '1.0.0' }, { capabilities: { tools: {} } });
const tool = (name) => ({ name, description: `Fixture ${name}`, inputSchema: { type: 'object', properties: { text: { type: 'string' } } } });
server.setRequestHandler(ListToolsRequestSchema, async ({ params }) => params?.cursor === 'second'
  ? { tools: [tool('fail')] }
  : { tools: [tool('echo')], nextCursor: 'second' });
server.setRequestHandler(CallToolRequestSchema, async ({ params }) => {
  if (params.name === 'fail') return { isError: true, content: [{ type: 'text', text: 'Fixture tool failure' }] };
  if (params.name !== 'echo') throw new Error('Unknown fixture tool');
  const environmentName = params.arguments?.__fixtureEnvironment;
  const text = typeof environmentName === 'string' ? String(process.env[environmentName] ?? '') : String(params.arguments?.text ?? '');
  return { content: [{ type: 'text', text }] };
});
await server.connect(new StdioServerTransport());
process.stdin.on('end', () => { void server.close().then(() => process.exit(0)); });
