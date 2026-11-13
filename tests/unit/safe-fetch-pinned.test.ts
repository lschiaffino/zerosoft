import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import http from 'http';
import zlib from 'zlib';
import type { AddressInfo } from 'net';

// DNS rebinding: el chequeo (dns/promises) ve una IP pública y la conexión (dns.lookup) una interna.
vi.mock('dns/promises', async (orig) => {
  const real = await orig<typeof import('dns/promises')>();
  const lookup = async (host: string, opts?: unknown) => (host === 'rebind.test' ? [{ address: '93.184.216.34', family: 4 }] : real.lookup(host, opts as never));
  return { ...real, lookup, default: { ...real, lookup } };
});
vi.mock('dns', async (orig) => {
  const real = await orig<typeof import('dns')>();
  const lookup = (host: string, opts: Record<string, unknown>, cb: (...a: unknown[]) => void) => {
    if (host === 'rebind.test') return opts.all ? cb(null, [{ address: '127.0.0.1', family: 4 }]) : cb(null, '127.0.0.1', 4);
    return (real.lookup as unknown as (...a: unknown[]) => void)(host, opts, cb);
  };
  return { ...real, lookup, default: { ...real, lookup } };
});

const { publicLookup, safeFetch } = await import('@/lib/safe-fetch');

let server: http.Server;
let port = 0;

beforeAll(async () => {
  server = http.createServer((req, res) => {
    if (req.url === '/gz') {
      res.writeHead(200, { 'content-type': 'text/html', 'content-encoding': 'gzip' });
      res.end(zlib.gzipSync('<title>hola</title>'));
    } else if (req.url === '/go') {
      res.writeHead(302, { location: '/gz' });
      res.end();
    } else {
      res.writeHead(200, { 'content-type': 'text/plain' });
      res.end('ok');
    }
  });
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
  port = (server.address() as AddressInfo).port;
});
afterAll(() => new Promise<void>((r) => server.close(() => r())));
afterEach(() => vi.unstubAllEnvs());

describe('safeFetch con pinDns (vistas previas de links)', () => {
  it('publicLookup rechaza un host que resuelve a una IP interna', async () => {
    const err = await new Promise<Error | null>((resolve) => publicLookup('localhost', {}, (e) => resolve(e)));
    expect(err?.message).toBe('private_host');
  });

  it('DNS rebinding: el chequeo ve una IP pública pero al conectar es interna, y no se conecta', async () => {
    await expect(safeFetch(`http://rebind.test:${port}/`, {}, 3000, { pinDns: true })).rejects.toThrow(/private_host/);
  });

  it('lee y descomprime, y sigue redirecciones validadas (red privada permitida solo en este test)', async () => {
    vi.stubEnv('ALLOW_PRIVATE_WEBHOOKS', 'true');
    const res = await safeFetch(`http://localhost:${port}/go`, { headers: { accept: 'text/html' } }, 3000, { maxRedirects: 2, pinDns: true });
    expect(res.status).toBe(200);
    expect(res.headers.get('content-encoding')).toBeNull();
    expect(await res.text()).toBe('<title>hola</title>');
  });

  it('solo GET o HEAD, sin cuerpo', async () => {
    vi.stubEnv('ALLOW_PRIVATE_WEBHOOKS', 'true');
    await expect(safeFetch(`http://localhost:${port}/`, { method: 'POST', body: 'x' }, 3000, { pinDns: true })).rejects.toThrow('pinned_get_only');
  });
});
