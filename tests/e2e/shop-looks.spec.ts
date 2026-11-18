import { expect, test, type APIRequestContext } from '@playwright/test';
import { PHONE, check, setTheme, settle } from './responsive-audit';

/**
 * Shop, las páginas de operaciones (borradores, devoluciones, carritos
 * abandonados, reportes, contenido, órdenes de compra) y las de la tienda que
 * cambiaron (checkout, "Mis pedidos"): en los cinco aspectos a 390 (claro y
 * oscuro alternados) y en el aspecto por defecto a 1280, claro y oscuro, sin
 * scroll lateral, sin nada fuera de pantalla y sin errores del servidor.
 * SHOP_LOOKS_SHOTS=<carpeta> guarda una captura de cada página.
 */

const LOOKS = ['current', 'lines', 'classic', 'liquid', 'retro'] as const;
const uid = () => Math.random().toString(36).slice(2, 8);
const SHOTS = process.env.SHOP_LOOKS_SHOTS || '';

async function ok<T = Record<string, unknown>>(res: Promise<import('@playwright/test').APIResponse>): Promise<T> {
  const r = await res;
  expect(r.ok(), `${r.url()} → ${r.status()} ${await r.text().catch(() => '')}`).toBe(true);
  return (await r.json()) as T;
}

async function seed(request: APIRequestContext) {
  await ok(request.put('/api/shop/payments', { data: { manual: { enabled: true, label: 'Transfer', instructions: 'Bank 123' } } }));
  const { store } = await ok<{ store: { handle: string } }>(request.get('/api/shop/store'));
  await ok(request.patch('/api/shop/store', { data: { published: true } }));
  const { product } = await ok<{ product: { id: string; variants: Array<{ id: string }> } }>(
    request.post('/api/shop/products', { data: { title: `Ceramic mug with a long descriptive name ${uid()}`, status: 'active', requiresShipping: false, variants: [{ options: [], priceCents: 1850, initialStock: 20 }] } }),
  );
  const variantId = product.variants[0].id;
  const { order } = await ok<{ order: { id: string } }>(request.post('/api/shop/drafts', { data: { email: `looks-${uid()}@example.com`, name: 'Looks customer', lines: [{ variantId, quantity: 2 }] } }));
  const { page } = await ok<{ page: { id: string } }>(request.post('/api/shop/pages', { data: { title: `Shipping and returns ${uid()}`, body: 'We ship in two business days.' } }));
  await ok(request.post('/api/shop/purchase-orders', { data: { supplier: `Supplier ${uid()}`, items: [{ variantId, quantity: 12, unitCostCents: 700 }] } }));
  return { handle: store.handle, draft: order.id, page: page.id };
}

test('Shop: páginas de operaciones en los cinco aspectos, claro y oscuro, 1280 y 390', async ({ browser, request, baseURL }) => {
  test.setTimeout(600_000);
  const s = await seed(request);
  const pages = [
    '/en/app/shop/orders?status=draft',
    '/en/app/shop/orders/new',
    `/en/app/shop/orders/${s.draft}`,
    '/en/app/shop/returns',
    '/en/app/shop/abandoned',
    '/en/app/shop/reports',
    '/en/app/shop/pages',
    '/en/app/shop/pages/new',
    `/en/app/shop/pages/${s.page}`,
    '/en/app/shop/purchase-orders',
    '/en/app/shop/inventory',
    '/en/app/shop/discounts/new',
    '/en/app/shop/settings',
    `/store/${s.handle}/checkout`,
    `/store/${s.handle}/account`,
  ];
  const combos: Array<{ look: (typeof LOOKS)[number]; theme: 'light' | 'dark'; phone: boolean }> = [
    { look: 'current', theme: 'light', phone: false },
    { look: 'current', theme: 'dark', phone: false },
    ...LOOKS.map((look, i) => ({ look, theme: i % 2 ? ('dark' as const) : ('light' as const), phone: true })),
  ];
  const errors: string[] = [];
  try {
    for (const { look, theme, phone } of combos) {
      await ok(request.put('/api/profile/look', { data: { look } }));
      const ctx = await browser.newContext({ baseURL, viewport: phone ? PHONE : { width: 1280, height: 860 }, ...(phone ? { hasTouch: true, isMobile: true } : {}) });
      await setTheme(ctx, baseURL!, theme);
      const page = await ctx.newPage();
      page.on('pageerror', (e) => errors.push(`${page.url()} pageerror ${e.message}`));
      page.on('response', (r) => {
        if (r.status() >= 500) errors.push(`${r.status()} ${r.url()}`);
      });
      for (const url of pages) {
        await page.goto(url, { waitUntil: 'domcontentloaded' });
        await settle(page);
        if (url.startsWith('/en/app/')) await expect(page.locator('html')).toHaveAttribute('data-look', look);
        if (SHOTS) await page.screenshot({ path: `${SHOTS}/${look}-${theme}-${phone ? 390 : 1280}-${url.replace(/[^a-z0-9]+/gi, '_')}.png`, fullPage: true });
        await check(page, `shop ${look} ${theme} ${phone ? 390 : 1280} ${url}`, { tap: phone });
      }
      await ctx.close();
    }
  } finally {
    await request.put('/api/profile/look', { data: { look: 'current' } });
  }
  expect(errors, errors.join('\n')).toEqual([]);
});
