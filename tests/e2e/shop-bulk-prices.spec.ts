import { expect, test, type APIRequestContext, type Page } from '@playwright/test';
import { PHONE, check, setTheme, settle } from './responsive-audit';

/**
 * Shop: cambiar precios de varios productos desde la lista: poner en oferta,
 * terminar la oferta y subir un porcentaje, con el error si el número no sirve.
 */

const uid = () => Math.random().toString(36).slice(2, 8);

async function ok<T = Record<string, unknown>>(res: Promise<import('@playwright/test').APIResponse>): Promise<T> {
  const r = await res;
  expect(r.ok(), `${r.url()} → ${r.status()} ${await r.text().catch(() => '')}`).toBe(true);
  return (await r.json()) as T;
}

type Product = { id: string; variants: Array<{ priceCents: number; compareAtCents: number | null }> };

async function seed(request: APIRequestContext) {
  const tag = `bulkprice${uid()}`;
  const make = (title: string, prices: number[]) =>
    ok<{ product: Product }>(
      request.post('/api/shop/products', {
        data: {
          title: `${title} ${tag}`,
          status: 'active',
          options: [{ name: 'Size', values: prices.map((_, i) => `S${i}`) }],
          variants: prices.map((priceCents, i) => ({ options: [`S${i}`], priceCents, initialStock: 3 })),
        },
      }),
    );
  const a = (await make('Mug', [1000, 2000])).product;
  const b = (await make('Plate', [500])).product;
  return { tag, ids: [a.id, b.id] };
}

const prices = async (request: APIRequestContext, ids: string[]) =>
  Promise.all(ids.map(async (id) => (await ok<{ product: Product }>(request.get(`/api/shop/products/${id}`))).product.variants.map((v) => [v.priceCents, v.compareAtCents])));

async function openPrices(page: Page, tag: string, action: 'sale' | 'end-sale' | 'adjust') {
  await page.goto(`/en/app/shop/products?q=${tag}`, { waitUntil: 'networkidle' });
  await page.getByRole('columnheader').getByRole('checkbox').check();
  const bar = page.getByTestId('shop-bulkbar');
  await bar.getByRole('combobox').selectOption(action);
  await page.getByTestId('shop-bulk-apply').click();
  const dialog = page.getByRole('dialog');
  await expect(dialog).toBeVisible();
  return dialog;
}

test('Shop: poner en oferta, terminar la oferta y subir precios de varios productos', async ({ page, request }) => {
  test.setTimeout(120_000);
  const s = await seed(request);

  // Un número fuera de rango muestra el error y no cambia nada.
  let dialog = await openPrices(page, s.tag, 'sale');
  await dialog.getByRole('textbox').fill('95');
  await dialog.getByRole('textbox').press('Enter');
  await expect(dialog.getByRole('alert')).toBeVisible();
  await expect(dialog.getByRole('textbox')).toHaveAttribute('aria-invalid', 'true');
  expect(await prices(request, s.ids)).toEqual([[[1000, null], [2000, null]], [[500, null]]]);

  // 20% off: el precio de lista queda tachado.
  await dialog.getByRole('textbox').fill('20');
  await dialog.getByTestId('shop-prices-form').locator('button[type="submit"]').click();
  await expect(dialog).toBeHidden();
  await expect(page.locator('.ui-toasts')).not.toBeEmpty();
  await expect(page.getByTestId('shop-bulkbar')).toHaveCount(0);
  await expect.poll(() => prices(request, s.ids)).toEqual([[[800, 1000], [1600, 2000]], [[400, 500]]]);

  // Terminar la oferta vuelve al precio de lista.
  dialog = await openPrices(page, s.tag, 'end-sale');
  await dialog.getByTestId('shop-prices-form').locator('button[type="submit"]').click();
  await expect(dialog).toBeHidden();
  await expect.poll(() => prices(request, s.ids)).toEqual([[[1000, null], [2000, null]], [[500, null]]]);

  // Subir 10%. Esc cierra sin cambiar; Enter confirma.
  dialog = await openPrices(page, s.tag, 'adjust');
  await page.keyboard.press('Escape');
  await expect(dialog).toBeHidden();
  await page.getByTestId('shop-bulk-apply').click();
  await expect(dialog).toBeVisible();
  await expect(dialog.getByRole('textbox')).toBeFocused();
  await dialog.getByRole('textbox').fill('10');
  await page.keyboard.press('Enter');
  await expect(dialog).toBeHidden();
  await expect.poll(() => prices(request, s.ids)).toEqual([[[1100, null], [2200, null]], [[550, null]]]);
});

// Tamaños de toque: solo en el celular (a 1280 hay mouse, como en las otras specs). Los de la barra
// lateral y las pestañas de estado son de la app entera, no de este cambio.
const SHARED_CHROME = /^tap a\.(side-stop|ui-tab)/;

test('Shop: el diálogo de precios a 1280 y 390, claro y oscuro', async ({ browser, request, baseURL }) => {
  test.setTimeout(120_000);
  const s = await seed(request);
  for (const theme of ['light', 'dark'] as const) {
    for (const viewport of [{ width: 1280, height: 800 }, PHONE]) {
      const context = await browser.newContext({ viewport, baseURL, colorScheme: theme });
      await setTheme(context, baseURL!, theme);
      const page = await context.newPage();
      await page.goto(`/en/app/shop/products?q=${s.tag}`, { waitUntil: 'networkidle' });
      await page.getByRole('columnheader').getByRole('checkbox').check();
      await settle(page);
      await check(page, `lista con selección ${theme} ${viewport.width}`, { ignore: SHARED_CHROME, tap: viewport.width < 1000 });
      await page.getByTestId('shop-bulkbar').getByRole('combobox').selectOption('sale');
      await page.getByTestId('shop-bulk-apply').click();
      await expect(page.getByRole('dialog')).toBeVisible();
      await settle(page);
      await check(page, `diálogo de oferta ${theme} ${viewport.width}`, { ignore: SHARED_CHROME, tap: viewport.width < 1000 });
      await context.close();
    }
  }
});
