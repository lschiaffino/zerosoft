import { expect, test, type Page } from '@playwright/test';

/**
 * Directorio de software (/software y /software/<categoría>): el índice lista
 * cada categoría, de ahí se abre la página de la categoría con zerosoft, open
 * source y pago separados, y el JSON-LD trae el ItemList. Sin scroll lateral
 * en el teléfono.
 */

async function ldTypes(page: Page): Promise<string[]> {
  const blocks = await page.locator('script[type="application/ld+json"]').allTextContents();
  const types: string[] = [];
  for (const raw of blocks) {
    const data = JSON.parse(raw) as { '@graph'?: { '@type': string }[]; '@type'?: string };
    for (const node of data['@graph'] ?? [data]) if (node['@type']) types.push(node['@type']);
  }
  return types;
}

async function noSideScroll(page: Page) {
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  expect(overflow).toBeLessThanOrEqual(0);
}

for (const width of [1280, 390]) {
  test(`índice y categoría a ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 900 });
    await page.goto('/en/software');
    const index = page.getByTestId('software-directory');
    await expect(index).toBeVisible();
    const rows = index.getByTestId('software-category-row');
    expect(await rows.count()).toBeGreaterThan(10);
    expect(await ldTypes(page)).toContain('CollectionPage');
    await noSideScroll(page);

    // De la primera fila a su página.
    await rows.first().getByTestId('software-category-link').click();
    await expect(page).toHaveURL(/\/en\/software\/[a-z-]+$/);
    await expect(page.getByTestId('software-zerosoft')).toBeVisible();
    await expect(page.getByTestId('software-zerosoft-app').first().getByRole('link').first()).toHaveAttribute('href', /\/en\/products\//);
    await expect(page.getByTestId('software-open-source').getByTestId('software-entry').first()).toBeVisible();
    await expect(page.getByTestId('software-paid').getByTestId('software-entry').first()).toBeVisible();
    const types = await ldTypes(page);
    expect(types).toContain('CollectionPage');
    expect(types).toContain('SoftwareApplication');
    expect(types).toContain('BreadcrumbList');
    await noSideScroll(page);
  });
}

test('una categoría en cada idioma y una que no existe da 404', async ({ page }) => {
  for (const locale of ['en', 'es', 'pt']) {
    const res = await page.goto(`/${locale}/software/crm`);
    expect(res?.status()).toBe(200);
    await expect(page.locator('html')).toHaveAttribute('lang', locale);
  }
  const missing = await page.goto('/en/software/not-a-category');
  expect(missing?.status()).toBe(404);
});

test('la tarjeta para compartir de una categoría es un PNG', async ({ request }) => {
  const res = await request.get('/api/og/software/en/crm');
  expect(res.status()).toBe(200);
  expect(res.headers()['content-type']).toContain('image/png');
});
