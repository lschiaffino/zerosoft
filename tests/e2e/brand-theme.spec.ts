import { expect, test } from '@playwright/test';

/**
 * Temas de marca: la marca default (el cero y "zerosoft.ai") y el tema
 * opcional subte, que se activa con ?brand=subte (cookie zs_brand) y se
 * apaga con ?brand=default. /brand es siempre default y
 * /nuevo-branding/subte siempre subte.
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

test('?brand=subte guarda el tema y ?brand=default lo borra', async ({ page, context }) => {
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.goto('/es/app/crm?brand=subte', { waitUntil: 'networkidle' });
  // Redirige a la misma URL sin el parámetro.
  await expect(page).toHaveURL(/\/es\/app\/crm$/);
  await expect(page.locator('html')).toHaveAttribute('data-brand', 'subte');
  expect((await context.cookies()).find((c) => c.name === 'zs_brand')?.value).toBe('subte');
  await expect(page.locator('.side-line .side-station').first()).toBeVisible();

  await page.goto('/es/app', { waitUntil: 'networkidle' });
  await expect(page.locator('.app-home-network')).toBeVisible();

  await page.goto('/es/app?brand=default', { waitUntil: 'networkidle' });
  await expect(page).toHaveURL(/\/es\/app$/);
  await expect(page.locator('html')).toHaveAttribute('data-brand', 'default');
  expect((await context.cookies()).find((c) => c.name === 'zs_brand')).toBeUndefined();
  await expect(page.locator('.app-home-apps')).toBeVisible();
});

test('un tema desconocido se ignora', async ({ page }) => {
  await page.goto('/es?brand=nada', { waitUntil: 'networkidle' });
  await expect(page).toHaveURL(/\/es$/);
  await expect(page.locator('html')).toHaveAttribute('data-brand', 'default');
});

test('/brand es la marca default aunque la cookie diga subte', async ({ page }) => {
  await page.goto('/es?brand=subte');
  const res = await page.goto('/es/brand', { waitUntil: 'networkidle' });
  expect(res?.status()).toBeLessThan(400);
  await expect(page.locator('html')).toHaveAttribute('data-brand', 'default');
  await expect(page.getByRole('heading', { level: 1, name: 'La marca' })).toBeVisible();
  await expect(page.locator('.bd-swatch')).toHaveCount(6 + 11);
  await expect(page.locator('a.bd-link')).toHaveAttribute('href', '/es/nuevo-branding/subte');
});

test('/nuevo-branding/subte muestra el tema subte sin cookie', async ({ page }) => {
  const res = await page.goto('/es/nuevo-branding/subte', { waitUntil: 'networkidle' });
  expect(res?.status()).toBeLessThan(400);
  await expect(page.locator('html')).toHaveAttribute('data-brand', 'subte');
  await expect(page.locator('.net').first()).toBeVisible();
  // El header de marketing no se monta: la guía tiene su propio chrome.
  await expect(page.locator('.site-header')).toHaveCount(0);
});
