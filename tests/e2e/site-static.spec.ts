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

test('header del sitio: con la pista de sesión muestra Dashboard; sin ella, Entrar', async ({ page, context, baseURL }) => {
  await page.goto('/es/blog', { waitUntil: 'networkidle' });
  await expect(page.locator('.hd-right .hd-signin')).toBeVisible();
  await context.addCookies([{ name: 'zs_who', value: 'abc123', url: baseURL ?? 'http://localhost:3210' }]);
  await page.reload({ waitUntil: 'networkidle' });
  await expect(page.locator('.hd-right a.btn-chrome')).toHaveText('Dashboard');
  await expect(page.locator('.hd-right .hd-signin')).toHaveCount(0);
});

test('visitar la app deja la pista, y el sitio después muestra Dashboard', async ({ page }) => {
  await page.goto('/es/app/crm', { waitUntil: 'networkidle' });
  await page.goto('/es', { waitUntil: 'networkidle' });
  await expect(page.locator('.hd-right a.btn-chrome')).toHaveText('Dashboard');
});
