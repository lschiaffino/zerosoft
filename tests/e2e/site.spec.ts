import { expect, test } from '@playwright/test';

/**
 * Sitio público con la marca "Red de subte": el plano vivo en el home, la
 * línea del producto como índice de su página, los precios con costo y
 * precio, y las páginas de lectura sin errores de JS.
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

test('el home abre con el plano de la red y cada línea lleva a su producto', async ({ page }) => {
  await page.goto('/es', { waitUntil: 'networkidle' });
  const map = page.locator('.lp-hero .net');
  await expect(map).toBeVisible();
  // Once terminales, una por app, cada una con el link a su página.
  await expect(map.locator('a.net-terminal')).toHaveCount(11);
  await expect(map.locator('a.net-terminal', { hasText: 'Cal' })).toHaveAttribute('href', '/es/products/cal');
  // Pasar por una terminal cuenta con qué combina en el pie del plano.
  await map.locator('a.net-terminal', { hasText: 'Cal' }).hover();
  await expect(map.locator('.net-caption-text')).toContainText('Cal: cada reserva');
});

test('todas las estaciones del plano quedan visibles al terminar la animación', async ({ page }) => {
  await page.goto('/es', { waitUntil: 'load' });
  await page.waitForTimeout(2000);
  const hidden = await page.evaluate(() =>
    Array.from(document.querySelectorAll('.lp-hero .net-stop'))
      .filter((el) => getComputedStyle(el).visibility !== 'visible')
      .map((el) => el.textContent?.trim() || el.getAttribute('aria-label') || '?'),
  );
  expect(hidden, `estaciones ocultas: ${hidden.join(', ')}`).toEqual([]);
  const terminals = page.locator('.lp-hero a.net-terminal');
  await expect(terminals).toHaveCount(11);
  for (let i = 0; i < 11; i++) await expect(terminals.nth(i)).toBeVisible();
});

test('la tabla de precios muestra costo y precio (× 3)', async ({ page }) => {
  await page.goto('/es', { waitUntil: 'networkidle' });
  const table = page.locator('#precios .pricing-table');
  await expect(table).toBeVisible();
  const clicks = table.locator('tbody tr').first();
  await expect(clicks.locator('td').nth(2)).toHaveText(/0,83/);
  await expect(clicks.locator('td').nth(3)).toHaveText(/2,50/);
});

test('la línea del producto es el índice de la página', async ({ page }) => {
  await page.goto('/es/products/link', { waitUntil: 'networkidle' });
  const nav = page.getByRole('navigation', { name: 'Secciones de Link' });
  await expect(nav).toBeVisible();
  const stops = nav.locator('a.pline-stop');
  await expect(stops.first()).toHaveAttribute('href', '#vista');
  await nav.getByRole('link', { name: 'Preguntas' }).click();
  await expect(page).toHaveURL(/#faq$/);
  await expect(nav.getByRole('link', { name: 'Preguntas' })).toHaveAttribute('aria-current', 'location');
  // El plano del primer viewport enciende la línea del producto.
  await expect(page.locator('.pd-hero .net-caption-text')).toContainText('Link');
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
