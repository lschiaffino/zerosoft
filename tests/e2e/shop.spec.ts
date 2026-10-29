import { createHmac } from 'crypto';
import { createClient } from '@libsql/client';
import { expect, test, type APIRequestContext } from '@playwright/test';

/**
 * Shop de punta a punta con los cobros en modo de prueba (SHOP_PAYMENTS_FAKE=1):
 * producto con variantes y stock desde el editor, publicar la tienda, comprar
 * como invitado con un código, el webhook firmado de Stripe marca el pedido
 * pagado, el stock baja, el pedido aparece en la app, se envía con
 * seguimiento, el cliente queda en el CRM y una persona sin Shop no entra.
 */

const uid = () => Math.random().toString(36).slice(2, 8);
// Claves falsas armadas por partes: nada con forma de clave real en el repo.
const FAKE_STRIPE_KEY = ['sk', 'test', `e2e${uid()}abcdefgh`].join('_');
const FAKE_WHSEC = ['whsec', 'e2eabcdefgh12345678'].join('_');

async function ok<T = Record<string, unknown>>(res: Promise<import('@playwright/test').APIResponse>): Promise<T> {
  const r = await res;
  expect(r.ok(), `${r.url()} → ${r.status()} ${await r.text().catch(() => '')}`).toBe(true);
  return (await r.json()) as T;
}

async function sql(statement: string, args: Array<string | number | null> = []) {
  const db = createClient({ url: `file:${process.env.E2E_DB_FILE}` });
  try {
    return (await db.execute({ sql: statement, args })).rows as unknown as Array<Record<string, unknown>>;
  } finally {
    db.close();
  }
}

/** Firma como Stripe: t=<ts>,v1=HMAC-SHA256("<ts>.<cuerpo>"). */
function stripeSignature(body: string, secret: string): string {
  const t = Math.floor(Date.now() / 1000);
  return `t=${t},v1=${createHmac('sha256', secret).update(`${t}.${body}`).digest('hex')}`;
}

async function setupPayments(request: APIRequestContext): Promise<{ handle: string; webhookUrl: string }> {
  const { payments } = await ok<{ payments: { stripe: { webhookUrl: string } } }>(
    request.put('/api/shop/payments', { data: { stripe: { secretKey: FAKE_STRIPE_KEY, webhookSecret: FAKE_WHSEC }, manual: { enabled: true, instructions: 'Bank 123' } } }),
  );
  await ok(request.put('/api/shop/shipping', { data: { rates: [{ name: 'Standard', kind: 'flat', countries: [], priceCents: 500, freeOverCents: null }] } }));
  const { store } = await ok<{ store: { handle: string } }>(request.get('/api/shop/store'));
  return { handle: store.handle, webhookUrl: payments.stripe.webhookUrl };
}

test('compra completa: variantes, tienda publicada, código, webhook, stock, envío y CRM', async ({ page, request }) => {
  test.setTimeout(180_000);
  const title = `Remera ${uid()}`;
  const code = `E2E${uid().toUpperCase()}`;
  const email = `guest-${uid()}@example.com`;
  const { webhookUrl } = await setupPayments(request);
  await ok(request.post('/api/shop/discounts', { data: { code, kind: 'percent', value: 1000 } }));

  // 1. Producto con variantes y stock desde el editor.
  await page.goto('/en/app/shop/products/new', { waitUntil: 'networkidle' });
  await page.locator('input[name="title"]').fill(title);
  await page.getByRole('button', { name: 'Add option' }).click();
  await page.getByLabel('Option name').fill('Size');
  await page.getByLabel('Values').fill('S, M');
  const rows = page.locator('.shop-variants tbody tr');
  await expect(rows).toHaveCount(2);
  for (const i of [0, 1]) {
    await rows.nth(i).getByLabel('Price', { exact: true }).fill('25.00');
    await rows.nth(i).getByLabel('Initial stock').fill(i === 0 ? '2' : '5');
  }
  await page.getByRole('button', { name: 'Create product' }).click();
  await expect(page).toHaveURL(/\/en\/app\/shop\/products\/prod_/);
  const productId = /products\/(prod_[^/?#]+)/.exec(page.url())![1];
  await expect(page.getByRole('button', { name: '5 in stock' })).toBeVisible();
  const { product } = await ok<{ product: { handle: string; variants: Array<{ id: string; title: string; stock: number }> } }>(request.get(`/api/shop/products/${productId}`));
  const m = product.variants.find((v) => v.title === 'M')!;
  expect(m.stock).toBe(5);

  // 2. Publicar la tienda desde Ajustes.
  await page.goto('/en/app/shop/settings?tab=store', { waitUntil: 'networkidle' });
  await page.getByRole('switch', { name: 'Store published' }).check();
  await page.getByRole('button', { name: 'Save' }).click();
  await expect(page.getByText('Saved').first()).toBeVisible();
  const { store } = await ok<{ store: { handle: string; published: boolean } }>(request.get('/api/shop/store'));
  expect(store.published).toBe(true);

  // 3. Comprar como invitado: talle M × 2 con el código.
  await page.goto(`/store/${store.handle}/products/${product.handle}`, { waitUntil: 'networkidle' });
  await expect(page.getByRole('heading', { name: title })).toBeVisible();
  const ld = await page.locator('script[type="application/ld+json"]').textContent();
  expect(JSON.parse(ld!)).toMatchObject({ '@type': 'Product', name: title });
  await page.getByRole('button', { name: 'M', exact: true }).click();
  await page.getByLabel('Quantity').fill('2');
  await page.getByRole('button', { name: 'Add to cart' }).click();
  await expect(page.getByTestId('sf-cart-link')).toHaveAttribute('aria-label', /\(2\)/);
  await page.getByRole('link', { name: 'View cart' }).click();
  await expect(page.getByTestId('sf-subtotal')).toHaveText('$50.00');
  await page.getByRole('link', { name: 'Check out' }).click();
  await page.getByLabel('Email').fill(email);
  await page.getByLabel('Full name').fill('Ana Guest');
  await page.getByLabel('Country').selectOption('AR');
  await page.getByLabel('Address', { exact: true }).fill('Av. Corrientes 1234');
  await page.getByLabel('City').fill('Buenos Aires');
  await page.getByLabel('Discount code').fill(code);
  await page.getByRole('button', { name: 'Apply' }).click();
  await expect(page.getByTestId('sf-discount')).toContainText('$5.00');
  await expect(page.getByTestId('sf-total')).toHaveText('$50.00');
  await page.getByLabel('Credit or debit card').check();
  await page.getByRole('button', { name: 'Place order' }).click();
  await expect(page).toHaveURL(new RegExp(`/store/${store.handle}/orders/[A-Za-z0-9_-]+\\?return=1`));
  await expect(page.getByTestId('sf-order-status')).toHaveAttribute('data-status', 'pending');

  // 4. El webhook firmado marca el pedido pagado (y repetirlo no hace nada).
  const { items } = await ok<{ items: Array<{ id: string; number: number; totalCents: number }> }>(request.get(`/api/shop/orders?q=${encodeURIComponent(email)}`));
  expect(items).toHaveLength(1);
  const orderId = items[0].id;
  expect(items[0].totalCents).toBe(5000);
  const ref = String((await sql('SELECT payment_ref FROM shop_orders WHERE id = ?', [orderId]))[0].payment_ref);
  const body = JSON.stringify({
    id: `evt_${uid()}`,
    type: 'checkout.session.completed',
    data: { object: { id: ref, payment_status: 'paid', currency: 'usd', amount_total: 5000, payment_intent: `pi_${uid()}`, metadata: { source: 'zerosoft_shop', order_id: orderId } } },
  });
  const path = new URL(webhookUrl).pathname;
  const bad = await request.post(path, { data: body, headers: { 'content-type': 'application/json', 'stripe-signature': 't=1,v1=00' } });
  expect(bad.status()).toBe(400);
  const sig = stripeSignature(body, FAKE_WHSEC);
  expect((await ok<{ result: string }>(request.post(path, { data: body, headers: { 'content-type': 'application/json', 'stripe-signature': sig } }))).result).toBe('paid');
  expect((await ok<{ result: string }>(request.post(path, { data: body, headers: { 'content-type': 'application/json', 'stripe-signature': sig } }))).result).toBe('duplicate');
  await expect(page.getByTestId('sf-order-status')).toHaveAttribute('data-status', 'paid', { timeout: 30_000 });

  // 5. El stock bajó una sola vez.
  const after = await ok<{ product: { variants: Array<{ id: string; stock: number; inventory: Array<{ available: number; reserved: number }> }> } }>(request.get(`/api/shop/products/${productId}`));
  const mAfter = after.product.variants.find((v) => v.id === m.id)!;
  expect(mAfter.stock).toBe(3);
  expect(mAfter.inventory[0]).toMatchObject({ available: 3, reserved: 0 });

  // 6. El pedido en la app: enviarlo con seguimiento.
  await page.goto('/en/app/shop/orders', { waitUntil: 'networkidle' });
  await page.getByRole('link', { name: `#${items[0].number}` }).click();
  await expect(page.getByRole('heading', { name: `Order #${items[0].number}` })).toBeVisible();
  await expect(page.getByTestId('order-total')).toHaveText('$50.00');
  await page.getByRole('button', { name: 'Fulfill', exact: true }).click();
  await page.getByLabel('Tracking number').fill('1Z999E2E');
  await page.getByLabel('Carrier').fill('UPS');
  await page.getByRole('button', { name: 'Mark as fulfilled' }).click();
  await expect(page.locator('.shop-order-status .badge').first()).toHaveText('Fulfilled');
  await expect(page.getByTestId('order-timeline')).toContainText('1Z999E2E');

  // 7. El cliente es contacto del CRM, con el pedido en su timeline.
  const search = await ok<{ items: Array<{ group: string; meta: string; href: string }> }>(request.get(`/api/search?q=${encodeURIComponent(email)}`));
  const contact = search.items.find((i) => i.group === 'contacts' && i.meta === email);
  expect(contact).toBeTruthy();
  const notes = await sql("SELECT subject FROM crm_activities WHERE contact_id = ? AND subject LIKE 'Shop order #%'", [contact!.href.split('/').pop()!]);
  expect(notes.length).toBe(1);

  // La página pública del pedido ahora dice enviado, con el seguimiento.
  await page.goto(`/store/${store.handle}/orders`, { waitUntil: 'networkidle' });
  await page.getByLabel('Order number').fill(String(items[0].number));
  await page.getByLabel('Email').fill(email);
  await page.getByRole('button', { name: 'Find order' }).click();
  await expect(page.getByTestId('sf-order-status')).toHaveAttribute('data-status', 'fulfilled');
  await expect(page.getByText('1Z999E2E')).toBeVisible();
});

test('la tienda en el celular: sin scroll horizontal y tema claro', async ({ page, request }) => {
  const { handle } = await setupPayments(request);
  await ok(request.patch('/api/shop/store', { data: { published: true, theme: 'bold' } }));
  await ok(request.post('/api/shop/products', { data: { title: `Mobile ${uid()} with a very long product title that wraps`, status: 'active', variants: [{ options: [], priceCents: 999, initialStock: 1 }] } }));
  await page.setViewportSize({ width: 390, height: 844 });
  for (const path of ['', '/cart', '/checkout', '/search', '/orders']) {
    await page.goto(`/store/${handle}${path}`, { waitUntil: 'networkidle' });
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'light');
    const { scroll, inner } = await page.evaluate(() => ({ scroll: document.scrollingElement!.scrollWidth, inner: window.innerWidth }));
    expect(scroll, `${path}: ${scroll} > ${inner}`).toBeLessThanOrEqual(inner + 1);
  }
  const sitemap = await request.get(`/store/${handle}/sitemap.xml`);
  expect(sitemap.ok()).toBe(true);
  expect(await sitemap.text()).toContain(`/store/${handle}/products/`);
});

test('acceso por app: una persona sin Shop no ve páginas, APIs ni resultados de búsqueda', async ({ browser, baseURL, request }) => {
  test.setTimeout(90_000);
  const name = `Secreto ${uid()}`;
  await ok(request.post('/api/shop/products', { data: { title: name, variants: [{ options: [], priceCents: 100 }] } }));
  const demoTeam = String((await sql("SELECT id FROM teams WHERE owner_id = 'demo' ORDER BY created_at, id LIMIT 1"))[0].id);
  const email = `noshop-${uid()}@darwin-e2e.io`;
  const ctx = await browser.newContext({ baseURL });
  await ctx.addCookies([{ name: 'zs_e2e_as', value: email, url: baseURL! }]);
  const p = await ctx.newPage();
  try {
    await p.goto('/en/app', { waitUntil: 'networkidle' });
    const me = String((await sql('SELECT id FROM users WHERE email = ?', [email]))[0].id);
    await sql("UPDATE users SET onboarded_at = datetime('now') WHERE id = ?", [me]);
    await sql(`INSERT INTO team_members (team_id, user_id, role, apps) VALUES (?, ?, 'member', '["crm"]')`, [demoTeam, me]);
    await sql('UPDATE users SET active_team_id = ? WHERE id = ?', [demoTeam, me]);
    await p.goto('/en/app/shop/orders', { waitUntil: 'networkidle' });
    await expect(p).toHaveURL(/\/en\/app\?blocked=shop/);
    for (const path of ['/api/shop/orders', '/api/shop/products', '/api/shop/customers', '/api/shop/store', '/api/shop/payments']) {
      expect((await ctx.request.get(path)).status(), path).toBe(401);
    }
    const search = (await (await ctx.request.get(`/api/search?q=${encodeURIComponent(name)}`)).json()) as { items: Array<{ href: string }> };
    expect(search.items.filter((i) => i.href.startsWith('/app/shop'))).toEqual([]);
    expect((await ctx.request.post('/api/keys', { data: { name: 'nope', scopes: ['shop:read'] } })).status()).toBe(403);
  } finally {
    await ctx.close();
  }
});
