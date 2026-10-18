import { expect, test } from '@playwright/test';

/**
 * Marca: solo queda la default (el cero y "zerosoft.ai"). El tema subte se
 * retiró: ?brand=subte se ignora y su guía ya no existe.
 */

test('default: shell neutro, sin estaciones, y /app como grilla de apps', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.goto('/es/app', { waitUntil: 'networkidle' });
  await expect(page.locator('html')).toHaveAttribute('data-brand', 'default');
  await expect(page.locator('.app-home-apps a.app-home-app')).toHaveCount(11);
  await expect(page.locator('.app-home-network')).toHaveCount(0);
  await expect(page.locator('.side-station')).toHaveCount(0);
  await expect(page.locator('.side-line .side-icon').first()).toBeVisible();
  await expect(page.locator('.app-band .brand-logo-default')).toBeVisible();
});

test('?brand=subte ya no cambia la marca', async ({ page, context }) => {
  await page.goto('/es/app/crm?brand=subte', { waitUntil: 'networkidle' });
  await expect(page).toHaveURL(/\/es\/app\/crm$/);
  await expect(page.locator('html')).toHaveAttribute('data-brand', 'default');
  expect((await context.cookies()).find((c) => c.name === 'zs_brand')).toBeUndefined();
});

test('una cookie vieja de subte cae en default', async ({ page, context, baseURL }) => {
  await context.addCookies([{ name: 'zs_brand', value: 'subte', url: baseURL ?? 'http://localhost:3000' }]);
  await page.goto('/es', { waitUntil: 'networkidle' });
  await expect(page.locator('html')).toHaveAttribute('data-brand', 'default');
  await expect(page.locator('.lp-hero .hero-field')).toBeVisible();
});

test('/brand es la marca default y no enlaza a temas', async ({ page }) => {
  const res = await page.goto('/es/brand', { waitUntil: 'networkidle' });
  expect(res?.status()).toBeLessThan(400);
  await expect(page.locator('html')).toHaveAttribute('data-brand', 'default');
  await expect(page.getByRole('heading', { level: 1, name: 'La marca' })).toBeVisible();
  await expect(page.locator('.bd-swatch')).toHaveCount(6 + 11);
  await expect(page.locator('a[href*="nuevo-branding/subte"]')).toHaveCount(0);
});

test('/nuevo-branding/subte ya no existe', async ({ page }) => {
  const res = await page.goto('/es/nuevo-branding/subte');
  expect(res?.status()).toBe(404);
});
