import { randomBytes, timingSafeEqual } from 'node:crypto';
import type { RequestHandler } from 'express';

export type SecurityOptions = { port: number; frontendPort?: number; token?: string };
export function createLocalSecurity(options: SecurityOptions): { boundary: RequestHandler; authenticate: RequestHandler; token: string } {
  const token = options.token ?? randomBytes(32).toString('hex');
  const localOrigins = (port: number) => ['127.0.0.1', 'localhost'].map((host) => `http://${host}:${port}`);
  // Enumerate exact permitted spellings; never normalize arbitrary inbound URLs.
  const validHosts = new Set(localOrigins(options.port).flatMap((origin) => [new URL(origin).host, origin.slice('http://'.length)]));
  const origins = new Set([options.port, options.frontendPort ?? 5173].flatMap((port) =>
    localOrigins(port).flatMap((origin) => [new URL(origin).origin, origin])));
  const boundary: RequestHandler = (req, res, next) => {
    res.setHeader('Cache-Control', 'no-store');
    const origin = req.get('origin');
    if (!validHosts.has(req.get('host') ?? '') || (origin !== undefined && !origins.has(origin)) || req.get('sec-fetch-site') === 'cross-site') {
      res.status(403).json({ error: 'This API is available only to the local runner', code: 'FORBIDDEN' });
      return;
    }
    next();
  };
  const authenticate: RequestHandler = (req, res, next) => {
    const supplied = /^Bearer (\S+)$/i.exec(req.get('authorization') ?? '')?.[1] ?? '';
    const left = Buffer.from(supplied);
    const right = Buffer.from(token);
    if (left.length !== right.length || !timingSafeEqual(left, right)) {
      res.status(401).json({ error: 'Runner session expired or token is missing', code: 'UNAUTHORIZED' });
      return;
    }
    next();
  };
  return { boundary, authenticate, token };
}
