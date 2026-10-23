import { expect, test } from '@playwright/test';

/**
 * Paridad en las páginas de producto: el porcentaje contra el competidor, la
 * tabla de todo lo incluido (renderizada en el servidor) y lo que falta con
 * link al board. Y el porcentaje al lado de cada app en /products.
 */

const PRODUCTS = ['crm', 'chat', 'agents', 'flow', 'robots', 'track', 'link', 'docs', 'notes', 'cal', 'board'];

for (const product of PRODUCTS) {
  test(`paridad en /es/products/${product}`, async ({ page }) => {
    await page.goto(`/es/products/${product}`);
    const section = page.locator('#parity');
    await expect(section.locator('.parity-num .data')).toHaveText(/^\d{1,2}%$/);
    await expect(section.locator('.parity-method')).toContainText('Medimos');
    const rows = section.locator('.parity-table tbody tr:not(.parity-group)');
    expect(await rows.count()).toBeGreaterThan(10);
    const missing = section.locator('details.parity-missing');
    if (await missing.count()) {
      await missing.locator('summary').click();
      await expect(missing.locator('a[href*="/feedback-board"]').first()).toBeVisible();
    }
  });
}

test('la tabla viene en el HTML del servidor', async ({ request }) => {
  const html = await (await request.get('/en/products/docs')).text();
  expect(html).toContain('class="table parity-table"');
  expect(html).toMatch(/class="data">\d{1,2}%</);
  expect(html).toContain('"featureList"');
});

test('/products muestra el porcentaje de cada app', async ({ page }) => {
  await page.goto('/en/products');
  const tags = page.locator('.suite-parity');
  await expect(tags).toHaveCount(PRODUCTS.length);
  await expect(tags.first()).toHaveText(/^\d{1,2}% parity with .+/);
});
