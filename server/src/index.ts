/**
 * Punto de entrada del servidor HTTP.
 *
 * Estructura:
 *   - express + cors
 *   - router de la API (`/api/*`)
 *   - cierre limpio en SIGINT/SIGTERM
 *
 * No hay base de datos ni autenticación en el MVP.
 */

import express from 'express';
import cors from 'cors';
import { McpManager } from './mcp/manager.js';
import { ConfigStore } from './storage/configStore.js';
import { createApiRouter } from './api/routes.js';
import { serverBuiltinFixtures as builtinFixtures } from './config/fixtures.js';

const PORT = Number(process.env.PORT ?? 3001);

const app = express();

// Middleware
app.use(cors({ origin: true, credentials: true }));
app.use(express.json({ limit: '256kb' }));

// Log compacto de peticiones.
app.use((req, _res, next) => {
  const t = new Date().toISOString().slice(11, 19);
  console.log(`[${t}] ${req.method} ${req.path}`);
  next();
});

// Dependencias
const store = new ConfigStore({
  filePath: process.env.MCP_CONFIG_PATH ?? './.data/servers.json',
});
const manager = new McpManager();

app.use('/api', createApiRouter({ manager, store, fixtures: builtinFixtures }));

// 404 para rutas /api/* desconocidas
app.use('/api', (_req, res) => {
  res.status(404).json({ error: 'route not found', code: 'NOT_FOUND' });
});

// Manejador de errores central.
app.use((err: unknown, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
  if (err && typeof err === 'object' && 'type' in err && (err as { type?: string }).type === 'entity.parse.failed') {
    res.status(400).json({ error: 'invalid JSON body', code: 'BAD_REQUEST' });
    return;
  }
  console.error('[error]', err);
  const message = err instanceof Error ? err.message : String(err);
  res.status(500).json({ error: 'internal server error', detail: message });
});

const server = app.listen(PORT, () => {
  console.log(`mcp-schema-runner server listening on http://localhost:${PORT}`);
  console.log(`   GET    /api/health`);
  console.log(`   GET    /api/servers`);
  console.log(`   POST   /api/servers`);
  console.log(`   DELETE /api/servers/:id`);
  console.log(`   POST   /api/servers/:id/connect`);
  console.log(`   POST   /api/servers/:id/disconnect`);
  console.log(`   GET    /api/servers/:id/tools`);
  console.log(`   POST   /api/servers/:id/tools/:toolName/call`);
});

async function shutdown(signal: string): Promise<void> {
  console.log(`[${signal}] shutting down...`);
  await manager.disconnectAll();
  server.close(() => process.exit(0));
  setTimeout(() => process.exit(1), 5000).unref();
}

process.on('SIGINT', () => void shutdown('SIGINT'));
process.on('SIGTERM', () => void shutdown('SIGTERM'));
