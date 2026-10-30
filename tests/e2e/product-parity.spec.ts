import { expect, test } from '@playwright/test';

/**
 * Paridad en las páginas de producto: el porcentaje contra el competidor, la
 * tabla de todo lo incluido (renderizada en el servidor) y lo que falta con
 * link al board. Y el porcentaje al lado de cada app en /products.
 */

const PRODUCTS = ['crm', 'chat', 'groups', 'agents', 'flow', 'robots', 'track', 'link', 'docs', 'notes', 'cal', 'board', 'voice', 'rec', 'talk', 'design', 'shop', 'analytics', 'social', 'people'];

for (const product of PRODUCTS) {
  test(`paridad en /es/products/${product}`, async ({ page }) => {
    await page.goto(`/es/products/${product}`);
    const section = page.locator('#parity');
    await expect(section.locator('.parity-num .data')).toHaveText(/^\d{1,3}%$/);
    await expect(section.locator('.parity-method')).toContainText('Medimos');
    // Las apps en construcción no incluyen nada todavía: cuentan las filas de lo que falta (abierto).
    const building = ([] as string[]).includes(product);
    const rows = building
      ? section.locator('details.parity-missing[open] .parity-list li')
      : section.locator('.parity-table tbody tr:not(.parity-group)');
    expect(await rows.count()).toBeGreaterThan(10);
    if (building) await expect(section.locator('.parity-table')).toHaveCount(0);
    const missing = section.locator('details.parity-missing');
    if (await missing.count()) {
      if (!building) await missing.locator('summary').click();
      await expect(missing.locator('a[href*="/feedback-board"]').first()).toBeVisible();
    }
  });
}

test('la tabla viene en el HTML del servidor', async ({ request }) => {
  const html = await (await request.get('/en/products/docs')).text();
  expect(html).toContain('class="table parity-table"');
  expect(html).toMatch(/class="data">\d{1,3}%</);
  expect(html).toContain('"featureList"');
});

test('/products muestra el porcentaje de cada app', async ({ page }) => {
  await page.goto('/en/products');
  const tags = page.locator('.suite-parity');
  await expect(tags).toHaveCount(PRODUCTS.length);
  await expect(tags.first()).toHaveText(/^\d{1,3}% parity with .+/);
});

for (const path of ['/es', '/es/products']) {
  test(`tabla de paridad de todas las apps en ${path}`, async ({ page }) => {
    await page.goto(path);
    const table = page.locator('#paridad .parity-overview-table');
    await expect(table.locator('tbody tr')).toHaveCount(PRODUCTS.length);
    await expect(table.locator('.po-percent').first()).toHaveText(/^\d{1,3}%$/);
    await expect(page.locator('#paridad .parity-overview-lead')).toContainText('21 apps');
    await table.locator('a.po-app', { hasText: 'Groups' }).click();
    await expect(page).toHaveURL(/\/es\/products\/groups#parity$/);
  });
}

// Las apps en construcción lo dicen arriba del título, con la paridad en 0 % y sin mandar a una app que no existe.
for (const product of [] as string[]) {
  test(`/es/products/${product} está marcada en construcción`, async ({ page }) => {
    await page.goto(`/es/products/${product}`);
    await expect(page.locator('.pd-building')).toHaveText('En construcción');
    await expect(page.locator('#parity .parity-num .data')).toHaveText('0%');
    await expect(page.locator('.pd-actions .btn-primary')).toHaveAttribute('href', new RegExp(`/es/feedback-board/new\\?product=${product}$`));
    await expect(page.locator('.pd-shot-note')).toContainText('boceto');
  });
}

// Voice ya salió (web): app real con paridad mayor a 0 y la app de escritorio "en camino".
test('/es/products/voice es una app real', async ({ page }) => {
  await page.goto('/es/products/voice');
  await expect(page.locator('.pd-building')).toHaveCount(0);
  await expect(page.locator('#parity .parity-num .data')).not.toHaveText('0%');
  await expect(page.locator('.pd-actions .btn-primary')).toHaveAttribute('href', /\/app\/voice/);
  await expect(page.locator('main')).toContainText('Está en camino');
});

// Design (como Canva) sale como app real: la landing lleva a la app.
test('/es/products/design es un producto real', async ({ page }) => {
  await page.goto('/es/products/design');
  await expect(page.locator('.pd-building')).toHaveCount(0);
  await expect(page.locator('#parity .parity-num .data')).not.toHaveText('0%');
  await expect(page.locator('.pd-actions .btn-primary')).toHaveAttribute('href', '/es/app/design');
});

// Rec ya salió (tanda 4c): la landing lleva a la app y la paridad deja de ser 0 %.
test('/es/products/rec es un producto real', async ({ page }) => {
  await page.goto('/es/products/rec');
  await expect(page.locator('.pd-building')).toHaveCount(0);
  await expect(page.locator('#parity .parity-num .data')).not.toHaveText('0%');
  await expect(page.locator('.pd-actions .btn-primary')).toHaveAttribute('href', '/es/app/rec');
});
