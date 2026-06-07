/**
 * Rutas HTTP de la API local.
 *
 * Endpoints del MVP (ver `plan.md`):
 *   GET    /api/health
 *   GET    /api/servers
 *   POST   /api/servers
 *   DELETE /api/servers/:id
 *   POST   /api/servers/:id/connect
 *   POST   /api/servers/:id/disconnect
 *   GET    /api/servers/:id/tools
 *   POST   /api/servers/:id/tools/:toolName/call
 *
 * Las respuestas de error usan `ApiError` para que la UI pueda
 * mostrarlas de forma consistente.
 */

import { Router, type Request, type Response, type NextFunction } from 'express';
import { McpManager } from '../mcp/manager.js';
import type { ConfigStore } from '../storage/configStore.js';
import { isValidMcpServerConfig, type ApiError, type McpServerConfig } from '../../../shared/types.js';

type Deps = {
  manager: McpManager;
  store: ConfigStore;
  /** Fuentes de fixtures que se incluyen al iniciar (built-in). */
  fixtures: McpServerConfig[];
};

function notFound(message: string): ApiError {
  return { error: message, code: 'NOT_FOUND' };
}

function badRequest(message: string, detail?: string): ApiError {
  return { error: message, detail, code: 'BAD_REQUEST' };
}

function internal(message: string, detail?: string): ApiError {
  return { error: message, detail, code: 'INTERNAL' };
}

/** Fusiona fixtures y servidores guardados, deduplicando por `id`. */
function mergedServers(deps: Deps): McpServerConfig[] {
  const stored = deps.store.list();
  const map = new Map<string, McpServerConfig>();
  for (const f of deps.fixtures) map.set(f.id, f);
  for (const s of stored) map.set(s.id, s); // stored pisa fixtures
  return [...map.values()];
}

export function createApiRouter(deps: Deps): Router {
  const router = Router();

  router.get('/health', (_req, res) => {
    res.json({ status: 'ok', service: 'mcp-schema-runner', timestamp: new Date().toISOString() });
  });

  router.get('/servers', (_req, res) => {
    const configs = mergedServers(deps);
    res.json({ servers: deps.manager.listStates(configs) });
  });

  router.post('/servers', (req, res) => {
    const body = req.body as { config?: unknown };
    if (!isValidMcpServerConfig(body?.config)) {
      res.status(400).json(badRequest('invalid McpServerConfig'));
      return;
    }
    const added = deps.store.add(body.config);
    res.status(201).json({ server: deps.manager.getState(added) });
  });

  router.delete('/servers/:id', (req, res) => {
    const id = req.params.id;
    if (typeof id !== 'string') {
      res.status(400).json(badRequest('missing id'));
      return;
    }
    const removed = deps.store.remove(id);
    if (!removed) {
      res.status(404).json(notFound(`server '${id}' not found in store`));
      return;
    }
    void deps.manager.disconnect(id);
    res.status(204).end();
  });

  router.post('/servers/:id/connect', async (req, res, next) => {
    try {
      const id = req.params.id;
      if (typeof id !== 'string') {
        res.status(400).json(badRequest('missing id'));
        return;
      }
      const config = mergedServers(deps).find((s) => s.id === id);
      if (!config) {
        res.status(404).json(notFound(`server '${id}' not configured`));
        return;
      }
      const state = await deps.manager.connect(config);
      res.json({ server: state });
    } catch (err) {
      next(err);
    }
  });

  router.post('/servers/:id/disconnect', async (req, res, next) => {
    try {
      const id = req.params.id;
      if (typeof id !== 'string') {
        res.status(400).json(badRequest('missing id'));
        return;
      }
      await deps.manager.disconnect(id);
      res.status(204).end();
    } catch (err) {
      next(err);
    }
  });

  router.get('/servers/:id/tools', async (req, res, next) => {
    try {
      const id = req.params.id;
      if (typeof id !== 'string') {
        res.status(400).json(badRequest('missing id'));
        return;
      }
      // Refrescamos el listado para mantener paridad con el servidor.
      const tools = await deps.manager.listTools(id);
      res.json({ tools });
    } catch (err) {
      next(err);
    }
  });

  router.post('/servers/:id/tools/:toolName/call', async (req, res, next) => {
    try {
      const { id, toolName } = req.params;
      if (typeof id !== 'string' || typeof toolName !== 'string') {
        res.status(400).json(badRequest('missing id or toolName'));
        return;
      }
      const config = mergedServers(deps).find((s) => s.id === id);
      if (!config) {
        res.status(404).json(notFound(`server '${id}' not configured`));
        return;
      }
      const args = (req.body as { arguments?: unknown })?.arguments;
      const trace = await deps.manager.callTool(config, toolName, args);
      res.json({ trace });
    } catch (err) {
      next(err);
    }
  });

  // Manejador de errores específico del router.
  router.use((err: unknown, _req: Request, res: Response, _next: NextFunction) => {
    const message = err instanceof Error ? err.message : String(err);
    const code =
      err && typeof err === 'object' && 'code' in err
        ? String((err as { code: unknown }).code)
        : undefined;
    if (code === 'NOT_CONNECTED') {
      res.status(409).json({ error: message, code });
      return;
    }
    res.status(500).json(internal('api error', message));
  });

  return router;
}
