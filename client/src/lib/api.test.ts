import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
let fetchMock: ReturnType<typeof vi.fn>;
beforeEach(() => { vi.resetModules(); fetchMock = vi.fn(); vi.stubGlobal('fetch', fetchMock); });
afterEach(() => vi.unstubAllGlobals());
const json = (value: unknown, status = 200) => new Response(JSON.stringify(value), { status, headers: { 'Content-Type': 'application/json' } });
describe('session API client', () => {
  it('shares bootstrap across concurrent reads and sends the token only in headers', async () => {
    fetchMock.mockResolvedValueOnce(json({ token: 'in-memory-token' })).mockImplementation(() => Promise.resolve(json({ servers: [], migrationPending: false })));
    const api = await import('./api');
    await Promise.all([api.listServers(), api.listServers()]);
    expect(fetchMock.mock.calls.filter(([url]) => url === '/api/session')).toHaveLength(1);
    expect(fetchMock.mock.calls[1]?.[1].headers.Authorization).toBe('Bearer in-memory-token');
    expect(fetchMock.mock.calls.every(([url]) => !String(url).includes('in-memory-token'))).toBe(true);
  });
  it('reboots and retries a read once after an expired token', async () => {
    fetchMock.mockResolvedValueOnce(json({ token: 'old-token' })).mockResolvedValueOnce(json({ error: 'expired' }, 401)).mockResolvedValueOnce(json({ token: 'new-token' })).mockResolvedValueOnce(json({ servers: [], migrationPending: false }));
    const api = await import('./api');
    expect(await api.listServers()).toEqual({ servers: [], migrationPending: false });
    expect(fetchMock).toHaveBeenCalledTimes(4);
    expect(fetchMock.mock.calls[3]?.[1].headers.Authorization).toBe('Bearer new-token');
  });
  it('never automatically repeats a mutation after unauthorized', async () => {
    fetchMock.mockResolvedValueOnce(json({ token: 'old-token' })).mockResolvedValueOnce(json({ error: 'expired', code: 'UNAUTHORIZED' }, 401));
    const api = await import('./api');
    await expect(api.callTool('id', 'echo', {})).rejects.toMatchObject({ status: 401, code: 'UNAUTHORIZED' });
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });
  it('retains structured error status and code', async () => {
    fetchMock.mockResolvedValueOnce(json({ token: 'token' })).mockResolvedValueOnce(json({ error: 'Provide session values', code: 'ENV_REQUIRED' }, 409));
    const api = await import('./api');
    await expect(api.connectServer('id')).rejects.toMatchObject({ message: 'Provide session values', status: 409, code: 'ENV_REQUIRED' });
  });
  it('reads a non-JSON body once and preserves a useful plain-text fallback', async () => {
    fetchMock.mockResolvedValueOnce(json({ token: 'token' })).mockResolvedValueOnce(new Response('Backend unavailable', { status: 502 }));
    const api = await import('./api');
    await expect(api.listServers()).rejects.toMatchObject({ message: 'Request failed (502): Backend unavailable', status: 502 });
  });
  it('does not expose a proxy HTML document as an error message', async () => {
    fetchMock.mockResolvedValueOnce(json({ token: 'token' })).mockResolvedValueOnce(new Response('<html>proxy error</html>', { status: 502 }));
    const api = await import('./api');
    await expect(api.listServers()).rejects.toMatchObject({ message: 'Request failed (502)' });
  });
  it('handles empty successful disconnect responses and encoded ids', async () => {
    fetchMock.mockResolvedValueOnce(json({ token: 'token' })).mockResolvedValueOnce(new Response(null, { status: 204 }));
    const api = await import('./api');
    expect(await api.disconnectServer('a/b')).toBeUndefined();
    expect(fetchMock.mock.calls[1]?.[0]).toBe('/api/servers/a%2Fb/disconnect');
  });
});
