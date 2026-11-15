import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import http, { type Server, type ServerResponse } from 'http';
import type { AddressInfo } from 'net';
import {
  API_CACHE_PUBLIC,
  apiDefaultCacheControl,
  applyApiCacheDefault,
  installApiCacheDefault,
  isApiPath,
  isPublicApiPath,
} from '@/lib/api-cache-default';

/**
 * El Cache-Control por defecto de /api/* contra un servidor de Node de verdad
 * (el mismo ServerResponse que usa `next start`): completa lo que falta y
 * respeta lo que cada ruta fija y las rutas públicas.
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
    } else if (url.startsWith('/api/missing') || url.startsWith('/api/desktop/update/')) {
      // Un 404 sin cabecera propia (como el feed de escritorio sin release).
      res.statusCode = 404;
      res.end('Not found');
    } else if (url.startsWith('/api/redirect')) {
      res.writeHead(302, { location: '/somewhere' });
      res.end();
    } else {
      // /api/private, /api/private/..., rutas públicas sin cabecera y páginas.
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

const cc = async (path: string, method = 'GET') => (await fetch(`${base}${path}`, { method, redirect: 'manual' })).headers.get('cache-control');

describe('Cache-Control por defecto en /api/*', () => {
  it('una lectura de la API sin cabecera propia sale private, no-store', async () => {
    expect(await cc('/api/private')).toBe('private, no-store');
    expect(await cc('/api/private/items?x=1')).toBe('private, no-store');
    expect(await cc('/api/created')).toBe('private, no-store');
    expect(await cc('/api/stream')).toBe('private, no-store');
    expect(await cc('/api/redirect')).toBe('private, no-store');
    expect(await cc('/api/private', 'HEAD')).toBe('private, no-store');
  });

  it('un error sale private, sin no-store (Chromium deja abierto un no-store sin leer)', async () => {
    expect(await cc('/api/missing')).toBe('private');
  });

  it('POST, PATCH, PUT y DELETE no llevan cabecera por defecto', async () => {
    for (const m of ['POST', 'PATCH', 'PUT', 'DELETE']) expect(await cc('/api/private', m), m).toBeNull();
  });

  it('una ruta que fija su propia cabecera la conserva', async () => {
    expect(await cc('/api/public/og.png')).toBe('public, max-age=3600');
    expect(await cc('/api/write-head')).toBe('public, max-age=60');
    expect(await cc('/api/write-head-raw')).toBe('private, max-age=300');
  });

  it('las rutas públicas de la lista no se tocan nunca, ni en un error', async () => {
    expect(await cc('/api/desktop/update/latest.json')).toBeNull();
    for (const p of ['/api/og/blog/x', '/api/pwa-icon/192', '/api/uploads/a/b.png', '/api/fleet/install', '/api/status/summary', '/api/v1/openapi.json', '/api/chat/widget.js?id=1']) {
      expect(await cc(p), p).toBeNull();
    }
  });

  it('fuera de /api no se toca nada', async () => {
    expect(await cc('/en/blog')).toBeNull();
    expect(await cc('/apiary')).toBeNull();
  });

  it('la lista de rutas públicas', () => {
    expect(API_CACHE_PUBLIC).toEqual(
      expect.arrayContaining([
        '/api/og/',
        '/api/pwa-icon/',
        '/api/uploads/',
        '/api/desktop/update/',
        '/api/fleet/install',
        '/api/status/',
        '/api/board/changelog',
        '/api/v1/openapi.json',
        '/api/chat/widget.js',
        '/api/inbox/avatar/',
      ]),
    );
    for (const p of API_CACHE_PUBLIC) expect(p.startsWith('/api/'), p).toBe(true);
    expect(isPublicApiPath('/api/fleet/install?token=x')).toBe(true);
    expect(isPublicApiPath('/api/fleet/installer')).toBe(false);
    expect(isPublicApiPath('/api/fleet/board')).toBe(false);
    expect(isPublicApiPath('/api/og')).toBe(false);
    expect(isPublicApiPath('/api/docs/pages/x')).toBe(false);
  });

  it('isApiPath, apiDefaultCacheControl y applyApiCacheDefault', () => {
    expect(isApiPath('/api')).toBe(true);
    expect(isApiPath('/api?x')).toBe(true);
    expect(isApiPath('/api/v1/x')).toBe(true);
    expect(isApiPath('/apis')).toBe(false);
    expect(isApiPath('/en/api/x')).toBe(false);
    expect(isApiPath(undefined)).toBe(false);
    expect(apiDefaultCacheControl('GET', '/api/x', 200)).toBe('private, no-store');
    expect(apiDefaultCacheControl(undefined, '/api/x', 304)).toBe('private, no-store');
    expect(apiDefaultCacheControl('get', '/api/x', 403)).toBe('private');
    expect(apiDefaultCacheControl('POST', '/api/x', 200)).toBeNull();
    expect(apiDefaultCacheControl('GET', '/api/og/x', 404)).toBeNull();
    expect(apiDefaultCacheControl('GET', '/en', 200)).toBeNull();
    const set: Record<string, string> = {};
    const fake = { req: { url: '/api/x', method: 'GET' }, statusCode: 200, hasHeader: (n: string) => n in set, setHeader: (n: string, v: string) => ((set[n.toLowerCase()] = v), fake) };
    applyApiCacheDefault(fake as never, [200, { 'CACHE-CONTROL': 'public' }]);
    expect(set['cache-control']).toBeUndefined();
    applyApiCacheDefault(fake as never, [200, 'OK', [['Cache-Control', 'public']]]);
    expect(set['cache-control']).toBeUndefined();
    applyApiCacheDefault(fake as never, [404]);
    expect(set['cache-control']).toBe('private');
    delete set['cache-control'];
    applyApiCacheDefault(fake as never);
    expect(set['cache-control']).toBe('private, no-store');
  });
});
