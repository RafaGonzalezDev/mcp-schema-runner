import express, { type ErrorRequestHandler } from 'express';
import { join } from 'node:path';
import { createApiRouter, type ApiDependencies } from './api/routes.js';
import { createLocalSecurity, type SecurityOptions } from './api/security.js';

export type AppOptions = ApiDependencies & SecurityOptions & { clientDirectory?: string; isStopping?: () => boolean };
const statuses: Record<string, number> = {
  BAD_REQUEST: 400, SESSION_ENV_INVALID: 400, NOT_FOUND: 404, CONFLICT: 409,
  MIGRATION_REQUIRED: 409, NOT_CONNECTED: 409, ENV_REQUIRED: 409, BUSY: 409,
  CANCELLED: 409, BUILTIN_SERVER: 403, SHUTTING_DOWN: 503, MCP_CONNECT_FAILED: 502,
};
/** Creates middleware only: importing this module has no startup side effects. */
export function createApp(options: AppOptions) {
  const app = express();
  app.disable('x-powered-by');
  app.disable('etag');
  const security = createLocalSecurity(options);
  app.use(security.boundary);
  app.use((_req, res, next) => {
    if (options.isStopping?.()) { res.status(503).json({ error: 'Runner is shutting down', code: 'SHUTTING_DOWN' }); return; }
    next();
  });
  app.get('/api/health', (_req, res) => res.json({ status: 'ok', service: 'mcp-schema-runner', timestamp: new Date().toISOString() }));
  app.get('/api/session', (_req, res) => res.json({ token: security.token }));
  app.use('/api', security.authenticate, express.json({ limit: '256kb' }), createApiRouter(options));
  app.use('/api', (_req, res) => res.status(404).json({ error: 'Route not found', code: 'NOT_FOUND' }));
  if (options.clientDirectory) {
    app.use(express.static(options.clientDirectory));
    app.get(['/', '/inspector'], (_req, res) => res.sendFile(join(options.clientDirectory!, 'index.html')));
  }
  const errors: ErrorRequestHandler = (error: unknown, _req, res, _next) => {
    const err = error && typeof error === 'object' ? error as { code?: string; type?: string; status?: number; message?: string } : {};
    if (err.type === 'entity.parse.failed' || err.status === 400) { res.status(400).json({ error: 'Invalid JSON or request encoding', code: 'BAD_REQUEST' }); return; }
    if (err.type === 'entity.too.large') { res.status(413).json({ error: 'Request body exceeds 256 KiB', code: 'BODY_TOO_LARGE' }); return; }
    const code = err.code ?? 'INTERNAL';
    const status = statuses[code] ?? 500;
    // Storage and transport errors can embed sensitive implementation details.
    const safe = status < 500 || code === 'MCP_CONNECT_FAILED';
    res.status(status).json({ error: safe ? err.message ?? 'Request failed' : 'Unable to complete the request; check configuration and storage access', code });
  };
  app.use(errors);
  return app;
}
