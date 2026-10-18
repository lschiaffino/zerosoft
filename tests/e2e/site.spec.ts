import { expect, test } from '@playwright/test';

/**
 * Sitio público: el primer viewport (el cero de ceros), el índice de
 * secciones de cada producto,
 * los precios con costo y precio, y las páginas de lectura sin errores de JS.
 */

const PAGES = [
  '/es/products/link',
  '/en/products/notes',
  '/pt/products/crm',
  '/es/tools',
  '/es/changelog',
  '/es/status',
  '/es/terms',
  '/es/feedback-board',
  '/es/feedback-board/roadmap',
];

for (const path of PAGES) {
  test(`sitio sin errores: ${path}`, async ({ page }) => {
    const errors: string[] = [];
    page.on('pageerror', (err) => errors.push(err.message));
    page.on('console', (msg) => {
      if (msg.type() === 'error' && !/favicon|Failed to load resource/i.test(msg.text())) errors.push(msg.text());
    });
    const res = await page.goto(path, { waitUntil: 'networkidle' });
    expect(res?.status(), path).toBeLessThan(400);
    expect(errors, errors.join('\n')).toEqual([]);
  });
}

test('el home abre con el cero de ceros, sin plano de red', async ({ page }) => {
  await page.goto('/es', { waitUntil: 'networkidle' });
  await expect(page.locator('html')).toHaveAttribute('data-brand', 'default');
  await expect(page.locator('.lp-hero .hero-field')).toBeVisible();
  await expect(page.locator('.lp-hero .net')).toHaveCount(0);
  await expect(page.locator('.site-header .brand')).toContainText('zerosoft.ai');
});

test('la tabla de precios muestra costo y precio (× 3)', async ({ page }) => {
  await page.goto('/es', { waitUntil: 'networkidle' });
  const table = page.locator('#precios .pricing-table');
  await expect(table).toBeVisible();
  const clicks = table.locator('tbody tr').first();
  await expect(clicks.locator('td').nth(2)).toHaveText(/0,83/);
  await expect(clicks.locator('td').nth(3)).toHaveText(/2,50/);
});

test('el índice de secciones del producto sigue la lectura', async ({ page }) => {
  await page.goto('/es/products/link', { waitUntil: 'networkidle' });
  const nav = page.getByRole('navigation', { name: 'Secciones de Link' });
  await expect(nav).toBeVisible();
  const stops = nav.locator('a.pline-link');
  await expect(stops.first()).toHaveAttribute('href', '#vista');
  await nav.getByRole('link', { name: 'Preguntas' }).click();
  await expect(page).toHaveURL(/#faq$/);
  await expect(nav.getByRole('link', { name: 'Preguntas' })).toHaveAttribute('aria-current', 'location');
});

test('el menú de productos no se cierra con el clic que sigue al hover, y Esc devuelve el foco', async ({ page }) => {
  await page.goto('/es', { waitUntil: 'networkidle' });
  const trigger = page.locator('.site-header .hd-trigger');
  await trigger.hover();
  await trigger.click();
  await expect(trigger).toHaveAttribute('aria-expanded', 'true');
  await expect(page.locator('#hd-mega')).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(trigger).toHaveAttribute('aria-expanded', 'false');
  await expect(trigger).toBeFocused();
});

test('el header marca la sección actual', async ({ page }) => {
  await page.goto('/es/changelog', { waitUntil: 'networkidle' });
  await expect(page.locator('.site-header .hd-nav').getByRole('link', { name: 'Changelog' })).toHaveAttribute(
    'aria-current',
    'page',
  );
});
