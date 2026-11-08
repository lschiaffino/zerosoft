import { expect, test } from '@playwright/test';

/**
 * Las páginas del sitio son HTML estático (salen del CDN): el layout raíz no
 * lee la request. Lo que depende de quién mira se resuelve en el navegador:
 * el modo de color (script antes del primer paint) y el botón del header
 * (cookie zs_who). La app sigue siendo dinámica.
 */

const STATIC_PAGES = ['/es', '/en/blog', '/pt/products/crm', '/es/terms', '/en/docs'];

for (const path of STATIC_PAGES) {
  test(`estática y cacheable: ${path}`, async ({ request }) => {
    const res = await request.get(path, { maxRedirects: 0 });
    expect(res.status(), path).toBe(200);
    const cache = res.headers()['cache-control'] ?? '';
    expect(cache, `${path}: ${cache}`).toMatch(/s-maxage=\d+/);
    expect(cache).not.toMatch(/private|no-store/);
    // Nada de la persona en el HTML compartido.
    const html = await res.text();
    expect(html).not.toContain('demo@zerosoft.ai');
  });
}

test('la app sigue siendo dinámica y privada', async ({ request }) => {
  const res = await request.get('/es/app/crm', { maxRedirects: 0 });
  expect(res.status()).toBe(200);
  expect(res.headers()['cache-control'] ?? '').toMatch(/private|no-store/);
});

test('el modo oscuro de la cookie se aplica antes del primer paint en una página estática', async ({ page, context, baseURL }) => {
  await context.addCookies([{ name: 'zs_theme', value: 'dark', url: baseURL ?? 'http://localhost:3210' }]);
  // Sin JavaScript de React: solo el script en línea puede haber puesto el atributo.
  await page.route('**/_next/static/chunks/**', (route) => route.abort());
  await page.goto('/es/blog', { waitUntil: 'domcontentloaded' });
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
  expect(await page.evaluate(() => getComputedStyle(document.body).backgroundColor)).toBe('rgb(15, 14, 13)');
});

test('header del sitio: con la pista de sesión muestra Dashboard desde el primer paint; sin ella, Entrar', async ({ page, context, baseURL }) => {
  await page.goto('/es/blog', { waitUntil: 'networkidle' });
  await expect(page.locator('.hd-right .hd-signin')).toBeVisible();
  await expect(page.locator('.hd-right a.btn-chrome')).toHaveText('Empezá gratis', { useInnerText: true });
  await context.addCookies([{ name: 'zs_who', value: 'abc123', url: baseURL ?? 'http://localhost:3210' }]);
  // Sin el JavaScript de React: solo el script en línea y el CSS deciden qué se ve.
  await page.route('**/_next/static/chunks/**', (route) => route.abort());
  await page.reload({ waitUntil: 'domcontentloaded' });
  await expect(page.locator('html')).toHaveAttribute('data-session', 'in');
  await expect(page.locator('.hd-right a.btn-chrome')).toHaveText('Dashboard', { useInnerText: true });
  await expect(page.locator('.hd-right .hd-signin')).toBeHidden();
});

test('visitar la app deja la pista, y el sitio después muestra Dashboard', async ({ page }) => {
  await page.goto('/es/app/crm', { waitUntil: 'networkidle' });
  await page.goto('/es', { waitUntil: 'networkidle' });
  await expect(page.locator('.hd-right a.btn-chrome')).toHaveText('Dashboard', { useInnerText: true });
});

test('una página estática no manda Set-Cookie (cacheable en el CDN) y el idioma igual queda en la cookie', async ({ page, request, context }) => {
  const res = await request.get('/es/blog', { headers: { 'accept-language': 'en-US,en;q=0.9' } });
  expect(res.status()).toBe(200);
  expect(res.headersArray().filter((h) => h.name.toLowerCase() === 'set-cookie')).toEqual([]);
  await page.goto('/es/blog', { waitUntil: 'domcontentloaded' });
  expect((await context.cookies()).find((c) => c.name === 'NEXT_LOCALE')?.value).toBe('es');
});

test('el 404 de una ruta estática lleva su título y no queda cacheado un año', async ({ request }) => {
  for (const path of ['/es/blog/tag/no-existe-en-ninguno', '/es/products/nada', '/es/no-existe/para-nada']) {
    const res = await request.get(path);
    expect(res.status(), path).toBe(404);
    expect(await res.text(), path).toContain('<title>Página no encontrada · zerosoft</title>');
    expect(res.headers()['cache-control'] ?? '', path).not.toContain('s-maxage=31536000');
  }
});

test('las APIs con datos de la persona no se cachean', async ({ request }) => {
  for (const path of ['/api/notifications?limit=5', '/api/teams', '/api/voice/settings', '/api/search?q=a&locale=es']) {
    const res = await request.get(path);
    expect(res.status(), path).toBe(200);
    expect(res.headers()['cache-control'], path).toBe('private, no-store');
  }
});
