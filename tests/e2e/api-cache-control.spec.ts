import { expect, test } from '@playwright/test';

/**
 * Cache-Control por defecto en /api/* (lib/api-cache-default.ts, enganchado en
 * instrumentation.ts) contra la app de verdad: las rutas con datos de la
 * sesión que no fijan su cabecera salen `private, no-store`; las públicas que
 * eligen su caché a propósito la conservan.
 */

test('API: las rutas autenticadas sin cabecera propia salen private, no-store', async ({ request }) => {
  for (const path of ['/api/docs/notion', '/api/docs/search?q=cache']) {
    const res = await request.get(path);
    expect(res.status(), path).toBe(200);
    expect(res.headers()['cache-control'], path).toBe('private, no-store');
  }
  // Un error también (nada de un 401/404 queda en un caché compartido).
  const missing = await request.get('/api/docs/pages/does-not-exist-cache');
  expect(missing.headers()['cache-control']).toContain('no-store');
});

test('API: las rutas públicas cacheables conservan su cabecera', async ({ request }) => {
  const openapi = await request.get('/api/v1/openapi.json');
  expect(openapi.status()).toBe(200);
  expect(openapi.headers()['cache-control']).toBe('public, max-age=3600');
  const changelog = await request.get('/api/board/changelog');
  expect(changelog.status()).toBe(200);
  expect(changelog.headers()['cache-control']).toBe('public, max-age=60');
});
