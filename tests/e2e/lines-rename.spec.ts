import { expect, test } from '@playwright/test';

/**
 * Groups pasó a llamarse Lines. Las URLs viejas (favoritos, links de emails y
 * avisos, apps instaladas) redirigen para siempre a las nuevas, con idioma,
 * sin idioma y en cualquier subruta. La API y el webhook de los proveedores
 * siguen en /api/groups.
 */

const OLD_TO_NEW: [string, string][] = [
  ['/es/app/groups', '/es/app/lines'],
  ['/en/app/groups/inbox', '/en/app/lines/inbox'],
  ['/pt/app/groups/inbox/abc123', '/pt/app/lines/inbox/abc123'],
  ['/es/app/groups/settings?tab=numbers', '/es/app/lines/settings?tab=numbers'],
  ['/es/app/groups/broadcasts/recurring/r1', '/es/app/lines/broadcasts/recurring/r1'],
  ['/app/groups/list', '/app/lines/list'],
  ['/es/products/groups', '/es/products/lines'],
  ['/products/groups', '/products/lines'],
];

for (const [from, to] of OLD_TO_NEW) {
  test(`${from} redirige a ${to}`, async ({ request }) => {
    const res = await request.get(from, { maxRedirects: 0 });
    expect(res.status()).toBe(308);
    const location = new URL(res.headers().location, 'http://x');
    expect(location.pathname + location.search).toBe(to);
  });
}

test('la app y la página de producto abren en la ruta nueva con el nombre Lines', async ({ page }) => {
  await page.goto('/es/app/groups/inbox');
  await expect(page).toHaveURL(/\/es\/app\/lines\/inbox/);
  await expect(page.locator('#side-branch, nav').first()).toBeVisible();
  await page.goto('/en/products/groups');
  await expect(page).toHaveURL(/\/en\/products\/lines$/);
  await expect(page.locator('h1').first()).toBeVisible();
  await expect(page).toHaveTitle(/Lines/);
});

test('el webhook de los proveedores sigue en /api/groups (sin redirección)', async ({ request }) => {
  const res = await request.post('/api/groups/webhook/no-such-number', { data: {}, maxRedirects: 0 });
  expect([301, 302, 307, 308]).not.toContain(res.status());
  expect(res.status()).toBeLessThan(500);
});
