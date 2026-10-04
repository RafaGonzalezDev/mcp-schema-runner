import { describe, expect, it, vi } from 'vitest';
import type { Request, Response } from 'express';
import { createLocalSecurity, type SecurityOptions } from './security.js';

function checkBoundary(options: SecurityOptions, headers: Record<string, string>) {
  const security = createLocalSecurity(options);
  const request = { get: (name: string) => headers[name.toLowerCase()] } as unknown as Request;
  const response = {
    setHeader: vi.fn(),
    status: vi.fn().mockReturnThis(),
    json: vi.fn().mockReturnThis(),
  };
  const next = vi.fn();
  security.boundary(request, response as unknown as Response, next);
  return { response, next };
}

describe('local security default HTTP port normalization', () => {
  it.each(['localhost', '127.0.0.1', 'localhost:80', '127.0.0.1:80'])(
    'accepts the exact local port-80 host spelling %s', (host) => {
      const { response, next } = checkBoundary({ port: 80 }, { host });
      expect(next).toHaveBeenCalledOnce();
      expect(response.status).not.toHaveBeenCalled();
      expect(response.setHeader).toHaveBeenCalledWith('Cache-Control', 'no-store');
    },
  );

  it.each(['http://localhost', 'http://127.0.0.1', 'http://localhost:80', 'http://127.0.0.1:80'])(
    'accepts the exact local origin spelling %s on port 80', (origin) => {
      const { next } = checkBoundary({ port: 80 }, { host: 'localhost', origin });
      expect(next).toHaveBeenCalledOnce();
    },
  );

  it('allows a port-80 development origin without accepting port-80 backend hosts', () => {
    const options = { port: 3001, frontendPort: 80 };
    expect(checkBoundary(options, { host: 'localhost:3001', origin: 'http://localhost' }).next).toHaveBeenCalledOnce();
    const denied = checkBoundary(options, { host: 'localhost', origin: 'http://localhost' });
    expect(denied.response.status).toHaveBeenCalledWith(403);
    expect(denied.next).not.toHaveBeenCalled();
  });

  it.each([
    'http://user@localhost', 'http://evil.test@localhost', 'http://localhost/',
    'http://localhost?query', 'http://localhost#fragment', 'http://localhost.evil.test',
    'http://localhost.', 'http://www.localhost', 'http://127.1', 'http://2130706433',
    'http://%6cocalhost', 'https://localhost', 'http://localhost:81', 'null',
  ])('does not normalize a hostile or malformed origin into an allowed one: %s', (origin) => {
    const { response, next } = checkBoundary({ port: 80 }, { host: 'localhost', origin });
    expect(response.status).toHaveBeenCalledWith(403);
    expect(next).not.toHaveBeenCalled();
  });

  it.each([
    'user@localhost', 'localhost.evil.test', 'localhost.', 'www.localhost',
    '127.1', '2130706433', 'localhost:81', 'localhost:080', 'localhost/', '[::1]',
  ])('rejects an unlisted host spelling: %s', (host) => {
    const { response, next } = checkBoundary({ port: 80 }, { host });
    expect(response.status).toHaveBeenCalledWith(403);
    expect(next).not.toHaveBeenCalled();
  });

  it('still denies cross-site metadata for a permitted port-80 host and origin', () => {
    const { response, next } = checkBoundary({ port: 80 }, { host: 'localhost', origin: 'http://localhost', 'sec-fetch-site': 'cross-site' });
    expect(response.status).toHaveBeenCalledWith(403);
    expect(next).not.toHaveBeenCalled();
  });
});
