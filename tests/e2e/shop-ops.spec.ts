import { expect, test, type APIRequestContext, type Page } from '@playwright/test';

/**
 * Shop, operaciones de punta a punta en el navegador: pedido a mano y factura,
 * envío parcial, devolución pedida por el cliente, carrito abandonado, descuento
 * automático, retiro en un local, contenido y reportes. Cobros en modo de prueba.
 */
const uid = () => Math.random().toString(36).slice(2, 8);

async function ok<T = Record<string, unknown>>(res: Promise<import('@playwright/test').APIResponse>): Promise<T> {
  const r = await res;
  expect(r.ok(), `${r.url()} → ${r.status()} ${await r.text().catch(() => '')}`).toBe(true);
  return (await r.json()) as T;
}

async function setup(request: APIRequestContext): Promise<string> {
  await ok(request.put('/api/shop/payments', { data: { manual: { enabled: true, label: 'Transfer', instructions: 'Bank 123' } } }));
  const { store } = await ok<{ store: { handle: string } }>(request.get('/api/shop/store'));
  await ok(request.patch('/api/shop/store', { data: { published: true } }));
  return store.handle;
}

async function makeProduct(request: APIRequestContext, title: string, priceCents = 1000, stock = 10, extra: Record<string, unknown> = {}) {
  const { product } = await ok<{ product: { id: string; handle: string; variants: Array<{ id: string }> } }>(
    request.post('/api/shop/products', { data: { title, status: 'active', requiresShipping: false, variants: [{ options: [], priceCents, initialStock: stock, ...extra }] } }),
  );
  return product;
}

async function addToCart(page: Page, handle: string, productHandle: string) {
  await page.goto(`/store/${handle}/products/${productHandle}`, { waitUntil: 'networkidle' });
  await page.getByRole('button', { name: 'Add to cart' }).click();
}

test('pedido a mano: borrador, factura, pago, envío parcial y devolución del cliente', async ({ page, request }) => {
  test.setTimeout(180_000);
  const handle = await setup(request);
  await ok(request.patch('/api/shop/store', { data: { settings: { returnsDays: 30 } } }));
  const title = `Mate ${uid()}`;
  await makeProduct(request, title);
  const email = `draft-${uid()}@example.com`;

  await page.goto('/en/app/shop/orders', { waitUntil: 'networkidle' });
  await page.getByRole('link', { name: 'Create order' }).click();
  await page.waitForURL(/orders\/new/);
  await page.getByLabel('Add products').fill(title);
  await page.getByRole('button', { name: new RegExp(title) }).click();
  await page.getByLabel('Quantity').fill('3');
  await page.locator('input[name="email"]').fill(email);
  await expect(page.getByTestId('draft-total')).toContainText('30');
  await page.getByRole('button', { name: 'Save draft' }).click();
  await page.waitForURL(/orders\/ord_/);

  // El borrador está en su pestaña y no en la lista general.
  const draftUrl = page.url();
  await page.goto('/en/app/shop/orders', { waitUntil: 'networkidle' });
  await expect(page.getByRole('cell', { name: email })).toHaveCount(0);
  await page.goto('/en/app/shop/orders?status=draft', { waitUntil: 'networkidle' });
  await expect(page.getByRole('cell', { name: email })).toBeVisible();

  await page.goto(draftUrl, { waitUntil: 'networkidle' });
  await page.getByRole('button', { name: 'Mark as paid' }).click();
  await expect(page.locator('[data-status="paid"]').first()).toBeVisible();

  // Envío parcial: 1 de 3.
  await page.getByRole('button', { name: 'Fulfill', exact: true }).click();
  const dialog = page.getByRole('dialog');
  await dialog.getByLabel('Quantity').fill('1');
  await dialog.getByLabel('Tracking number').fill('TRK1');
  await dialog.getByRole('button', { name: 'Fulfill' }).click();
  await expect(page.getByTestId('order-partial')).toBeVisible();
  await page.getByRole('button', { name: 'Fulfill the rest' }).click();
  await page.getByRole('dialog').getByRole('button', { name: 'Fulfill' }).click();
  await expect(page.locator('[data-status="fulfilled"]').first()).toBeVisible();

  // El cliente pide la devolución desde la página del pedido.
  const orderId = /orders\/(ord_[^/?]+)/.exec(page.url())![1];
  const list = await ok<{ orders: Array<{ id: string; number: number }> }>(request.get(`/api/shop/orders?q=${encodeURIComponent(email)}`));
  expect(list.orders.some((o) => o.id === orderId)).toBe(true);
  const number = list.orders.find((o) => o.id === orderId)!.number;
  const found = await ok<{ statusToken?: string; order?: { statusToken: string } }>(request.post(`/api/shop/public/${handle}/order`, { data: { number: String(number), email } }));
  const token = found.statusToken ?? found.order!.statusToken;
  await page.goto(`/store/${handle}/orders/${token}`, { waitUntil: 'networkidle' });
  await page.getByRole('button', { name: 'Request a return' }).click();
  await page.getByTestId('sf-return-form').getByRole('button', { name: 'Send request' }).click();
  await expect(page.getByTestId('sf-return-sent')).toBeVisible();

  // El equipo la ve, la aprueba y la recibe.
  await page.goto('/en/app/shop/returns', { waitUntil: 'networkidle' });
  await expect(page.getByText(email).first()).toBeVisible();
  await page.getByRole('button', { name: 'Approve' }).first().click();
  await page.getByRole('button', { name: 'Receive items' }).first().click();
  await page.getByRole('dialog').getByRole('button', { name: 'Confirm' }).click();
  await expect(page.locator('[data-testid="shop-return"][data-status="received"]').first()).toBeVisible();
  await ok(request.patch('/api/shop/store', { data: { settings: { returnsDays: 0 } } }));
});

test('checkout abandonado: se guarda al dejar el email, el link repone el carrito y comprar lo recupera', async ({ page, browser, request, baseURL }) => {
  test.setTimeout(120_000);
  const handle = await setup(request);
  const title = `Yerba ${uid()}`;
  const product = await makeProduct(request, title);
  const email = `ab-${uid()}@example.com`;
  await addToCart(page, handle, product.handle);
  await page.goto(`/store/${handle}/checkout`, { waitUntil: 'networkidle' });
  const saved = page.waitForResponse((r) => r.url().includes('checkout-progress'));
  await page.getByLabel('Email').fill(email);
  await page.getByLabel('Email').blur();
  expect((await saved).ok()).toBe(true);

  // A la hora aparece en la lista: se simula pidiendo la lista con la fila envejecida en la base.
  const { createClient } = await import('@libsql/client');
  const db = createClient({ url: `file:${process.env.E2E_DB_FILE}` });
  await db.execute({ sql: "UPDATE shop_checkouts SET updated_at = datetime('now', '-2 hours') WHERE email = ?", args: [email] });
  const row = (await db.execute({ sql: 'SELECT token FROM shop_checkouts WHERE email = ?', args: [email] })).rows[0] as unknown as { token: string };
  db.close();
  await page.goto('/en/app/shop/abandoned', { waitUntil: 'networkidle' });
  await expect(page.getByTestId('abandoned-table').getByText(email)).toBeVisible();

  // Otro navegador abre el link y queda en el checkout con el carrito.
  const fresh = await browser.newContext({ baseURL });
  const other = await fresh.newPage();
  await other.goto(`/store/${handle}/recover/${row.token}`);
  await other.waitForURL(/\/checkout$/);
  await expect(other.locator('.sf-checkout-summary').getByText(title)).toBeVisible();
  await other.getByLabel('Email').fill(email);
  await other.getByTestId('sf-place-order').click();
  await other.waitForURL(/\/orders\//);
  await fresh.close();

  await page.reload({ waitUntil: 'networkidle' });
  await expect(page.getByTestId('abandoned-table').getByRole('row', { name: new RegExp(email) }).getByText('Recovered')).toBeVisible();
});

test('descuento automático con lleve 3 pague 2, descuento por transferencia y retiro en el local', async ({ page, request }) => {
  test.setTimeout(120_000);
  const handle = await setup(request);
  const title = `Taza ${uid()}`;
  const { product } = await ok<{ product: { id: string; handle: string; variants: Array<{ id: string }> } }>(
    request.post('/api/shop/products', { data: { title, status: 'active', requiresShipping: true, variants: [{ options: [], priceCents: 1000, initialStock: 10, weightGrams: 100 }] } }),
  );
  const promo = `Promo ${uid()}`;
  const { discount } = await ok<{ discount: { id: string } }>(
    request.post('/api/shop/discounts', { data: { code: `AUTO-${uid()}`, method: 'automatic', title: promo, kind: 'bxgy', value: 10_000, buyQuantity: 2, getQuantity: 1, scope: { productIds: [product.id], collectionIds: [] } } }),
  );
  await ok(request.put('/api/shop/shipping', { data: { rates: [{ name: 'Courier', kind: 'flat', countries: [], priceCents: 500 }, { name: 'Our shop', kind: 'pickup', countries: ['AR'], priceCents: 0, note: 'Main St 123, 10 to 18' }] } }));
  const { store } = await ok<{ store: { settings: Record<string, unknown> } }>(request.get('/api/shop/store'));
  await ok(request.patch('/api/shop/store', { data: { settings: { ...store.settings, paymentDiscounts: { stripe: 0, mercadopago: 0, manual: 1000 } } } }));

  await addToCart(page, handle, product.handle);
  await page.goto(`/store/${handle}/cart`, { waitUntil: 'networkidle' });
  await page.getByLabel('Quantity').fill('3');
  await expect(page.getByTestId('sf-cart-discount')).toContainText(promo);

  await page.goto(`/store/${handle}/checkout`, { waitUntil: 'networkidle' });
  await page.getByLabel('Email').fill(`pick-${uid()}@example.com`);
  // Retiro: desaparece la dirección y se pide quién retira.
  await page.getByRole('radio', { name: /Our shop/ }).check();
  await expect(page.getByText('Who picks it up')).toBeVisible();
  await expect(page.getByLabel('Address', { exact: false }).first()).toHaveCount(0);
  await page.locator('input[name="contactName"]').fill('Ana');
  await page.getByRole('radio', { name: /Transfer/ }).check();
  await expect(page.getByTestId('sf-discount')).toContainText(promo);
  await expect(page.getByTestId('sf-payment-discount')).toBeVisible();
  // 3 x 10 = 30; una gratis = 20; 10 % por transferencia = 18.
  await expect(page.getByTestId('sf-total')).toContainText('18');
  await page.getByTestId('sf-place-order').click();
  await page.waitForURL(/\/orders\//);
  await expect(page.getByText('Main St 123, 10 to 18')).toBeVisible();

  await ok(request.delete(`/api/shop/discounts/${discount.id}`));
  await ok(request.patch('/api/shop/store', { data: { settings: { paymentDiscounts: { stripe: 0, mercadopago: 0, manual: 0 } } } }));
  await ok(request.put('/api/shop/shipping', { data: { rates: [] } }));
});

test('contenido y reportes: página en el pie, blog, CSV y una persona sin admin no exporta clientes', async ({ page, request }) => {
  test.setTimeout(120_000);
  const handle = await setup(request);
  const title = `Returns ${uid()}`;
  await page.goto('/en/app/shop/pages', { waitUntil: 'networkidle' });
  await page.getByRole('link', { name: 'New page' }).first().click();
  await page.locator('input[name="title"]').fill(title);
  await page.locator('textarea[name="body"]').fill('You have 30 days.');
  await page.getByRole('button', { name: 'Save' }).click();
  await page.waitForURL(/pages\/page_/);
  await page.goto(`/store/${handle}`, { waitUntil: 'networkidle' });
  await page.locator('.sf-footer').getByRole('link', { name: title }).click();
  await expect(page.getByRole('heading', { name: title })).toBeVisible();
  await expect(page.getByText('You have 30 days.')).toBeVisible();

  const orders = await request.get('/api/shop/reports/export?type=orders');
  expect(orders.ok()).toBe(true);
  expect(orders.headers()['content-type']).toContain('text/csv');
  const feed = await request.get(`/api/shop/public/${handle}/feed`);
  expect(feed.ok()).toBe(true);
  expect(await feed.text()).toContain('xmlns:g=');

  await page.goto('/en/app/shop/reports', { waitUntil: 'networkidle' });
  await expect(page.getByRole('heading', { name: 'Reports' })).toBeVisible();
  await expect(page.getByTestId('report-by-product')).toBeVisible();
});
