import { expect, test } from '@playwright/test';

/**
 * Modo de color: el selector (sistema / claro / oscuro) del header del sitio
 * y del sidebar de la app escribe la cookie zs_theme y <html data-theme>, y
 * el servidor lo vuelve a renderizar igual después de recargar.
 */

const bg = (page: import('@playwright/test').Page) =>
  page.evaluate(() => getComputedStyle(document.body).backgroundColor);

test('sitio: oscuro y claro se guardan y sobreviven a la recarga', async ({ page, context }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto('/es', { waitUntil: 'networkidle' });
  const html = page.locator('html');
  await expect(html).not.toHaveAttribute('data-theme', /.+/);

  const sw = page.locator('.site-header [data-testid="theme-switcher"]');
  await expect(sw.getByRole('radio', { name: 'Sistema' })).toHaveAttribute('aria-checked', 'true');

  await sw.getByRole('radio', { name: 'Oscuro' }).click();
  await expect(html).toHaveAttribute('data-theme', 'dark');
  expect((await context.cookies()).find((c) => c.name === 'zs_theme')?.value).toBe('dark');
  expect(await bg(page)).toBe('rgb(15, 14, 13)');

  await page.reload({ waitUntil: 'networkidle' });
  await expect(html).toHaveAttribute('data-theme', 'dark');
  await expect(sw.getByRole('radio', { name: 'Oscuro' })).toHaveAttribute('aria-checked', 'true');
  expect(await bg(page)).toBe('rgb(15, 14, 13)');

  await sw.getByRole('radio', { name: 'Claro' }).click();
  await expect(html).toHaveAttribute('data-theme', 'light');
  await page.reload({ waitUntil: 'networkidle' });
  await expect(html).toHaveAttribute('data-theme', 'light');
  expect(await bg(page)).toBe('rgb(255, 255, 255)');

  // Sistema borra la cookie y el atributo.
  await sw.getByRole('radio', { name: 'Sistema' }).click();
  await expect(html).not.toHaveAttribute('data-theme', /.+/);
  expect((await context.cookies()).find((c) => c.name === 'zs_theme')).toBeUndefined();
});

test('sistema sigue a prefers-color-scheme; light explícito le gana', async ({ page }) => {
  await page.emulateMedia({ colorScheme: 'dark' });
  await page.goto('/es', { waitUntil: 'networkidle' });
  expect(await bg(page)).toBe('rgb(15, 14, 13)');

  await page.locator('.site-header [data-testid="theme-switcher"]').getByRole('radio', { name: 'Claro' }).click();
  expect(await bg(page)).toBe('rgb(255, 255, 255)');
});

test('app: el selector del sidebar cambia y persiste el modo', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto('/es/app/crm', { waitUntil: 'networkidle' });
  const sw = page.locator('.side [data-testid="theme-switcher"]');
  await sw.getByRole('radio', { name: 'Oscuro' }).click();
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');

  await page.goto('/es/app/docs', { waitUntil: 'networkidle' });
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
  await expect(sw.getByRole('radio', { name: 'Oscuro' })).toHaveAttribute('aria-checked', 'true');
});
