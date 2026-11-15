import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import http, { type Server, type ServerResponse } from 'http';
import type { AddressInfo } from 'net';
import { applyApiCacheDefault, installApiCacheDefault, isApiPath } from '@/lib/api-cache-default';

/**
 * El Cache-Control por defecto de /api/* contra un servidor de Node de verdad
 * (el mismo ServerResponse que usa `next start`): completa lo que falta y
 * respeta lo que cada ruta fija.
 */

// Una subclase propia: el enganche no toca el prototipo global del proceso de tests.
class TestResponse extends http.ServerResponse {}
installApiCacheDefault(TestResponse.prototype);
installApiCacheDefault(TestResponse.prototype); // dos veces: no se encadena

let server: Server;
let base = '';

beforeAll(async () => {
  server = http.createServer({ ServerResponse: TestResponse as unknown as typeof ServerResponse }, (req, res) => {
    const url = req.url ?? '';
    if (url.startsWith('/api/public')) {
      res.setHeader('Cache-Control', 'public, max-age=3600');
      res.end('ok');
    } else if (url.startsWith('/api/write-head-raw')) {
      res.writeHead(200, 'OK', ['cache-control', 'private, max-age=300']);
      res.end('ok');
    } else if (url.startsWith('/api/write-head')) {
      res.writeHead(200, { 'Cache-Control': 'public, max-age=60', 'content-type': 'text/plain' });
      res.end('ok');
    } else if (url.startsWith('/api/stream')) {
      res.write('chunk');
      res.end();
    } else {
      // /api/private, /api/private/... y páginas: sin cabecera propia.
      res.writeHead(url.startsWith('/api/created') ? 201 : 200, { 'content-type': 'application/json' });
      res.end('{}');
    }
  });
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

afterAll(async () => {
  await new Promise<void>((r) => server.close(() => r()));
});

const cc = async (path: string) => (await fetch(`${base}${path}`)).headers.get('cache-control');

describe('Cache-Control por defecto en /api/*', () => {
  it('una ruta de la API sin cabecera propia sale private, no-store', async () => {
    expect(await cc('/api/private')).toBe('private, no-store');
    expect(await cc('/api/private/items?x=1')).toBe('private, no-store');
    expect(await cc('/api/created')).toBe('private, no-store');
    expect(await cc('/api/stream')).toBe('private, no-store');
  });

  it('una ruta que fija su propia cabecera la conserva', async () => {
    expect(await cc('/api/public/og.png')).toBe('public, max-age=3600');
    expect(await cc('/api/write-head')).toBe('public, max-age=60');
    expect(await cc('/api/write-head-raw')).toBe('private, max-age=300');
  });

  it('fuera de /api no se toca nada', async () => {
    expect(await cc('/en/blog')).toBeNull();
    expect(await cc('/apiary')).toBeNull();
  });

  it('isApiPath y applyApiCacheDefault', () => {
    expect(isApiPath('/api')).toBe(true);
    expect(isApiPath('/api?x')).toBe(true);
    expect(isApiPath('/api/v1/x')).toBe(true);
    expect(isApiPath('/apis')).toBe(false);
    expect(isApiPath('/en/api/x')).toBe(false);
    expect(isApiPath(undefined)).toBe(false);
    const set: Record<string, string> = {};
    const fake = { req: { url: '/api/x' }, hasHeader: (n: string) => n in set, setHeader: (n: string, v: string) => ((set[n.toLowerCase()] = v), fake) };
    applyApiCacheDefault(fake as never, [{ 'CACHE-CONTROL': 'public' }]);
    expect(set['cache-control']).toBeUndefined();
    applyApiCacheDefault(fake as never, [[['Cache-Control', 'public']]]);
    expect(set['cache-control']).toBeUndefined();
    applyApiCacheDefault(fake as never);
    expect(set['cache-control']).toBe('private, no-store');
  });
});
