import { Router, type Request, type RequestHandler } from 'express';
import { McpManager, McpOperationError } from '../mcp/manager.js';
import type { ConfigStore } from '../storage/configStore.js';
import { isRecord, isStringRecord, isValidAddServerConfig, type McpServerConfig } from '../../../shared/types.js';
export type ApiDependencies = { manager: McpManager; store: ConfigStore; fixtures: McpServerConfig[] };
const asyncRoute = (fn: (req: Request, res: Parameters<RequestHandler>[1]) => Promise<void>): RequestHandler => (req, res, next) => { void fn(req, res).catch(next); };

export function createApiRouter(deps: ApiDependencies): Router {
  const router = Router();
  const deleting = new Set<string>();
  const configs = () => {
    const all = [...deps.fixtures, ...deps.store.list()];
    const ids = new Set<string>();
    for (const config of all) {
      if (ids.has(config.id)) throw new McpOperationError('Stored server id conflicts with a built-in fixture', 'STORE_INVALID');
      ids.add(config.id);
    }
    return all;
  };
  const builtin = (id: string) => deps.fixtures.some((item) => item.id === id);
  const idOf = (req: Request): string => {
    const id = req.params.id;
    if (typeof id !== 'string') throw new McpOperationError('Missing server id', 'BAD_REQUEST');
    return id;
  };
  const find = (id: string): McpServerConfig => {
    if (deleting.has(id)) throw new McpOperationError('Server is being removed', 'BUSY');
    const config = configs().find((item) => item.id === id);
    if (!config) throw new McpOperationError('Server is not configured', 'NOT_FOUND');
    return config;
  };
  const mutable = () => {
    if (deps.store.needsMigration()) throw new McpOperationError('Confirm the configuration migration before continuing', 'MIGRATION_REQUIRED');
  };
  const state = (config: McpServerConfig) => ({ ...deps.manager.getState(config), builtin: builtin(config.id) });
  router.get('/servers', (_req, res) => {
    const all = configs();
    res.json({ servers: all.map(state), migrationPending: deps.store.needsMigration() });
  });
  router.post('/servers', (req, res) => {
    mutable();
    if (!isRecord(req.body) || Object.keys(req.body).some((key) => key !== 'config') || !isValidAddServerConfig(req.body.config, process.platform === 'win32')) throw new McpOperationError('Invalid canonical stdio configuration', 'BAD_REQUEST');
    const config = req.body.config;
    if (configs().some((item) => item.id === config.id.trim())) throw new McpOperationError('Server id already exists or is reserved', 'CONFLICT');
    const added = deps.store.add({ ...config, id: config.id.trim(), name: config.name.trim(), command: config.command.trim() });
    res.status(201).json({ server: state(added) });
  });
  router.post('/config/migrate', (_req, res) => {
    deps.store.migrate();
    res.status(204).end();
  });
  router.post('/servers/:id/environment', (req, res) => {
    mutable();
    const id = idOf(req);
    find(id);
    if (builtin(id)) throw new McpOperationError('Built-in fixtures cannot be edited', 'BUILTIN_SERVER');
    if (deps.manager.isBusy(id)) throw new McpOperationError('Disconnect before replacing session environment', 'BUSY');
    if (!isRecord(req.body) || Object.keys(req.body).some((key) => key !== 'env') || !isStringRecord(req.body.env)) throw new McpOperationError('Provide an environment object', 'BAD_REQUEST');
    res.json({ server: state(deps.store.setSessionEnvironment(id, req.body.env)) });
  });
  router.delete('/servers/:id', asyncRoute(async (req, res) => {
    mutable();
    const id = idOf(req);
    find(id);
    if (builtin(id)) throw new McpOperationError('Built-in fixtures cannot be removed', 'BUILTIN_SERVER');
    deleting.add(id);
    try {
      await deps.manager.disconnect(id);
      if (!deps.store.remove(id)) throw new McpOperationError('Server is not configured', 'NOT_FOUND');
      res.status(204).end();
    } finally { deleting.delete(id); }
  }));
  router.post('/servers/:id/connect', asyncRoute(async (req, res) => {
    mutable();
    const config = find(idOf(req));
    await deps.manager.connect(config);
    res.json({ server: state(config) });
  }));
  router.post('/servers/:id/disconnect', asyncRoute(async (req, res) => {
    const id = idOf(req);
    find(id);
    await deps.manager.disconnect(id);
    res.status(204).end();
  }));
  router.get('/servers/:id/tools', asyncRoute(async (req, res) => {
    mutable();
    const id = idOf(req);
    find(id);
    res.json({ tools: await deps.manager.listTools(id) });
  }));
  router.post('/servers/:id/tools/:toolName/call', asyncRoute(async (req, res) => {
    mutable();
    const config = find(idOf(req));
    const toolName = req.params.toolName;
    if (typeof toolName !== 'string' || !toolName) throw new McpOperationError('Missing tool name', 'BAD_REQUEST');
    if (req.body !== undefined && (!isRecord(req.body) || Object.keys(req.body).some((key) => key !== 'arguments'))) throw new McpOperationError('Provide a tool call object', 'BAD_REQUEST');
    const args: unknown = req.body && Object.hasOwn(req.body, 'arguments') ? req.body.arguments : {};
    res.json({ trace: await deps.manager.callTool(config, toolName, args) });
  }));
  return router;
}
