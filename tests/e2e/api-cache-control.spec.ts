import { expect, test } from '@playwright/test';

/**
 * Cache-Control por defecto en /api/* (lib/api-cache-default.ts, enganchado en
 * instrumentation.ts) contra la app de verdad: las lecturas con datos de la
 * sesión que no fijan su cabecera salen `private, no-store`; las públicas que
 * eligen su caché a propósito la conservan.
 */

test('API: las lecturas autenticadas sin cabecera propia salen private, no-store', async ({ request }) => {
  for (const path of ['/api/docs/notion', '/api/docs/search?q=cache']) {
    const res = await request.get(path);
    expect(res.status(), path).toBe(200);
    expect(res.headers()['cache-control'], path).toBe('private, no-store');
  }
  // Un error queda fuera de cachés compartidas, sin no-store (lib/api-cache-default.ts).
  const missing = await request.get('/api/docs/pages/does-not-exist-cache');
  expect(missing.status()).toBe(404);
  expect(missing.headers()['cache-control']).toBe('private');
});

test('API: las rutas públicas cacheables conservan su cabecera', async ({ request }) => {
  const openapi = await request.get('/api/v1/openapi.json');
  expect(openapi.status()).toBe(200);
  expect(openapi.headers()['cache-control']).toBe('public, max-age=3600');
  const changelog = await request.get('/api/board/changelog');
  expect(changelog.status()).toBe(200);
  expect(changelog.headers()['cache-control']).toBe('public, max-age=60');
  // Feed de escritorio sin latest.json en el release falso: 404 sin cabecera agregada.
  const feed = await request.get('/api/desktop/update/latest.json');
  expect(feed.status()).toBe(404);
  expect(feed.headers()['cache-control']).toBeUndefined();
});

test('API: un 404 que la página no lee no deja la red ocupada', async ({ page }) => {
  // El ajuste de la app de escritorio pide el feed y no lee el cuerpo del 404.
  await page.goto('/en/app/settings/desktop', { waitUntil: 'networkidle', timeout: 30_000 });
  await expect(page.getByTestId('desktop-app-settings')).toBeVisible();
});
