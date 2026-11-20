import { expect, test, type APIRequestContext, type Page } from '@playwright/test';
import { PHONE, check, setTheme, settle } from './responsive-audit';

/**
 * Shop: filtros por opción (talle, color) en una colección de la tienda.
 * Un producto entra si una misma variante cumple lo marcado; los filtros
 * quedan en la URL y "Borrar filtros" vuelve a mostrar todo.
 */

const uid = () => Math.random().toString(36).slice(2, 8);

async function ok<T = Record<string, unknown>>(res: Promise<import('@playwright/test').APIResponse>): Promise<T> {
  const r = await res;
  expect(r.ok(), `${r.url()} → ${r.status()} ${await r.text().catch(() => '')}`).toBe(true);
  return (await r.json()) as T;
}

async function seed(request: APIRequestContext) {
  const id = uid();
  await ok(request.put('/api/shop/payments', { data: { manual: { enabled: true, label: 'Transfer', instructions: 'Bank 123' } } }));
  const { store } = await ok<{ store: { handle: string } }>(request.get('/api/shop/store'));
  await ok(request.patch('/api/shop/store', { data: { published: true } }));
  const product = (title: string, vendor: string, options: Array<{ name: string; values: string[] }>, variants: Array<{ options: string[]; priceCents: number; initialStock: number }>) =>
    ok<{ product: { id: string; handle: string } }>(request.post('/api/shop/products', { data: { title: `${title} ${id}`, vendor, status: 'active', options, variants } }));
  // Remera: M solo en rojo. Buzo: el talle escrito en minúscula, M sin stock. Gorra: sin opciones.
  const remera = await product('Tee', 'Acme', [{ name: 'Size', values: ['S', 'M'] }, { name: 'Color', values: ['Blue', 'Red'] }], [
    { options: ['S', 'Blue'], priceCents: 1000, initialStock: 5 },
    { options: ['S', 'Red'], priceCents: 1000, initialStock: 5 },
    { options: ['M', 'Red'], priceCents: 1000, initialStock: 5 },
  ]);
  const buzo = await product('Hoodie', 'Northwind', [{ name: 'size', values: ['M', 'L'] }], [
    { options: ['M'], priceCents: 3000, initialStock: 0 },
    { options: ['L'], priceCents: 3000, initialStock: 3 },
  ]);
  const gorra = await product('Cap', 'Acme', [], [{ options: [], priceCents: 500, initialStock: 9 }]);
  const { collection } = await ok<{ collection: { handle: string } }>(
    request.post('/api/shop/collections', {
      data: { title: `Filters ${id}`, kind: 'manual', published: true, productIds: [remera.product.id, buzo.product.id, gorra.product.id] },
    }),
  );
  return { url: `/store/${store.handle}/collections/${collection.handle}`, remera: remera.product.handle, buzo: buzo.product.handle, gorra: gorra.product.handle };
}

const facet = (page: Page, key: string) => page.locator(`[data-testid="sf-facet"][data-facet="${key}"]`);
const value = (page: Page, key: string, v: string) => facet(page, key).locator(`button[data-value="${v}"]`);
const cards = (page: Page) => page.getByTestId('sf-card');

async function shownHandles(page: Page): Promise<string[]> {
  const hrefs = await cards(page).evaluateAll((els) => els.map((e) => (e as HTMLAnchorElement).pathname.split('/products/')[1]));
  return [...new Set(hrefs)].sort();
}

test('Shop: filtrar una colección por talle y color, compartir la URL y borrar filtros', async ({ page, request }) => {
  test.setTimeout(120_000);
  const s = await seed(request);
  await page.goto(s.url, { waitUntil: 'networkidle' });

  // "Size" y "size" son el mismo filtro; la gorra no tiene opciones. Más la marca.
  await expect(page.getByTestId('sf-facet')).toHaveCount(3);
  await expect(facet(page, 'size').getByRole('button')).toHaveCount(3);
  expect(await shownHandles(page)).toEqual([s.buzo, s.gorra, s.remera].sort());

  // Talle M: remera y buzo. Con "solo con stock", el buzo M queda afuera.
  await value(page, 'size', 'm').click();
  await expect(value(page, 'size', 'm')).toHaveAttribute('aria-pressed', 'true');
  await expect.poll(() => shownHandles(page)).toEqual([s.buzo, s.remera].sort());
  await expect(page).toHaveURL(/o\.size=m/);
  await page.locator('input[name="inStock"]').check();
  await expect.poll(() => shownHandles(page)).toEqual([s.remera]);

  // M en azul no existe: el valor queda deshabilitado con cero resultados.
  await expect(value(page, 'color', 'blue')).toBeDisabled();
  await value(page, 'color', 'red').click();
  await expect.poll(() => shownHandles(page)).toEqual([s.remera]);

  // La URL filtrada se comparte: otra pestaña abre con los mismos filtros.
  const shared = page.url();
  const other = await page.context().newPage();
  await other.goto(shared, { waitUntil: 'networkidle' });
  await expect(value(other, 'size', 'm')).toHaveAttribute('aria-pressed', 'true');
  await expect(other.locator('input[name="inStock"]')).toBeChecked();
  await expect.poll(() => shownHandles(other)).toEqual([s.remera]);
  await other.close();

  // Borrar filtros vuelve a todo y limpia la URL.
  await page.getByTestId('sf-clear-filters').click();
  await expect.poll(() => shownHandles(page)).toEqual([s.buzo, s.gorra, s.remera].sort());
  await expect(page.getByTestId('sf-clear-filters')).toHaveCount(0);
  expect(new URL(page.url()).search).toBe('');

  // Marca: filtra el producto, sin mirar variantes.
  await value(page, 'p.vendor', 'acme').click();
  await expect.poll(() => shownHandles(page)).toEqual([s.gorra, s.remera].sort());
  await value(page, 'p.vendor', 'acme').click();

  // Teclado: Tab llega al valor y Enter lo marca.
  await value(page, 'size', 'l').focus();
  await page.keyboard.press('Enter');
  await expect(value(page, 'size', 'l')).toHaveAttribute('aria-pressed', 'true');
  await expect.poll(() => shownHandles(page)).toEqual([s.buzo]);
});

test('Shop: filtros de colección a 1280 y 390, claro y oscuro, sin scroll lateral', async ({ browser, request, baseURL }) => {
  test.setTimeout(120_000);
  const s = await seed(request);
  for (const theme of ['light', 'dark'] as const) {
    for (const viewport of [{ width: 1280, height: 800 }, PHONE]) {
      const context = await browser.newContext({ viewport, baseURL, colorScheme: theme });
      await setTheme(context, baseURL!, theme);
      const page = await context.newPage();
      await page.goto(`${s.url}?o.size=m`, { waitUntil: 'networkidle' });
      await expect(value(page, 'size', 'm')).toHaveAttribute('aria-pressed', 'true');
      await settle(page);
      await check(page, `colección filtrada ${theme} ${viewport.width}`);
      await context.close();
    }
  }
});
