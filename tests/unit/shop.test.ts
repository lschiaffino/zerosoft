import { beforeAll, describe, expect, it } from 'vitest';
import { getDb, upsertUser } from '@/lib/db';
import {
  computeTotals,
  discountAmount,
  discountError,
  formatMoney,
  parseMoney,
  shippingOptions,
  stripeAmount,
  taxRateFor,
  type DiscountRule,
  type ShippingRate,
  type TaxRate,
} from '@/lib/shop-money';
import {
  adjustInventory,
  createProduct,
  createDiscount,
  ensureStore,
  getProduct,
  listCustomers,
  matchesRules,
  replaceShippingRates,
  reserveStock,
  sanitizeDescription,
  descriptionHtml,
  sniffRaster,
  updateStore,
  type StockItem,
} from '@/lib/shop';
import { commitStock } from '@/lib/shop';
import { createCheckoutOrder, expirePendingOrders, getOrderRow, markPaidManually, priceCart, refundOrder } from '@/lib/shop-orders';
import { handleMercadoPagoWebhook, handleStripeWebhook, savePayments, signMercadoPago, verifyMercadoPagoSignature } from '@/lib/shop-payments';
import { signStripePayload } from '@/lib/calendar-payments';
import { parseProductCsv, importProductsCsv, exportShopifyCsv, toProductInput } from '@/lib/shop-csv';
import { canUseApp } from '@/lib/workspace';
import { scopesForApps } from '@/lib/api-scopes';
import { toolsFor } from '@/lib/assistant/tools';
import { ShopError, type ShopActor } from '@/lib/shop-schema';

process.env.SHOP_PAYMENTS_FAKE = '1';

// Claves falsas armadas por partes (nunca un literal con forma de clave).
const FAKE_STRIPE_KEY = ['sk', 'test', 'abcdefgh12345678'].join('_');
const FAKE_WHSEC = ['whsec', 'abcdefgh12345678'].join('_');
const FAKE_MP_TOKEN = ['TEST', '1234567890-abcdefghijklmnop'].join('-');
const FAKE_MP_SECRET = 'mpsecret1234567890abcdef';

const uid = () => Math.random().toString(36).slice(2, 10);

async function workspace(): Promise<ShopActor> {
  const u = await upsertUser({ email: `shop-${uid()}@example.com`, name: 'Shop Owner', image: null });
  return { ws: u.id, person: u.id, admin: true };
}

// ---------- Matemática ----------

const rule = (over: Partial<DiscountRule> = {}): DiscountRule => ({
  code: 'X',
  kind: 'percent',
  value: 1000,
  minOrderCents: 0,
  usageLimit: null,
  usedCount: 0,
  startsAt: null,
  endsAt: null,
  active: true,
  ...over,
});

const rates: ShippingRate[] = [
  { id: 'flat-ar', name: 'Standard AR', kind: 'flat', countries: ['AR'], priceCents: 1500, minWeightG: null, maxWeightG: null, freeOverCents: 10000 },
  { id: 'light', name: 'Light', kind: 'weight', countries: [], priceCents: 800, minWeightG: 0, maxWeightG: 1000, freeOverCents: null },
  { id: 'heavy', name: 'Heavy', kind: 'weight', countries: [], priceCents: 2500, minWeightG: 1001, maxWeightG: null, freeOverCents: null },
];
const taxes: TaxRate[] = [
  { country: 'AR', region: '', rateBps: 2100, name: 'IVA', appliesToShipping: false },
  { country: 'US', region: 'NY', rateBps: 888, name: 'NY tax', appliesToShipping: true },
  { country: 'US', region: '', rateBps: 0, name: '', appliesToShipping: false },
];

describe('shop: dinero', () => {
  it('subtotal, descuento porcentual y fijo con tope en el subtotal', () => {
    expect(discountAmount({ kind: 'percent', value: 1000 }, 4999)).toBe(500);
    expect(discountAmount({ kind: 'percent', value: 2500 }, 333)).toBe(83);
    expect(discountAmount({ kind: 'fixed', value: 2000 }, 1500)).toBe(1500);
    expect(discountAmount({ kind: 'free_shipping', value: 0 }, 1500)).toBe(0);
  });

  it('validez del código: activo, fechas, usos y mínimo', () => {
    const now = new Date('2026-10-29T12:00:00Z');
    expect(discountError(null, 100, now)).toBe('discount_invalid');
    expect(discountError(rule({ active: false }), 100, now)).toBe('discount_inactive');
    expect(discountError(rule({ startsAt: '2026-11-01 00:00:00' }), 100, now)).toBe('discount_not_started');
    expect(discountError(rule({ endsAt: '2026-10-28 23:59:59' }), 100, now)).toBe('discount_expired');
    expect(discountError(rule({ usageLimit: 3, usedCount: 3 }), 100, now)).toBe('discount_used_up');
    expect(discountError(rule({ minOrderCents: 5000 }), 4999, now)).toBe('discount_min_order');
    expect(discountError(rule({ minOrderCents: 5000 }), 5000, now)).toBeNull();
  });

  it('envío: por país, por peso y gratis desde un monto', () => {
    expect(shippingOptions(rates, { country: 'AR' }, 500, 5000).map((o) => o.id)).toEqual(['light', 'flat-ar']);
    expect(shippingOptions(rates, { country: 'UY' }, 1500, 5000).map((o) => o.id)).toEqual(['heavy']);
    const free = shippingOptions(rates, { country: 'AR' }, 2000, 10000);
    expect(free.find((o) => o.id === 'flat-ar')).toMatchObject({ priceCents: 0, free: true });
    expect(shippingOptions(rates, null, 100, 100)).toEqual([]);
  });

  it('impuesto: la región gana al país; sumado o incluido', () => {
    expect(taxRateFor(taxes, { country: 'US', region: 'ny' })?.name).toBe('NY tax');
    expect(taxRateFor(taxes, { country: 'US', region: 'CA' })?.rateBps).toBe(0);
    expect(taxRateFor(taxes, { country: 'BR' })).toBeNull();
    const added = computeTotals({ lines: [{ unitCents: 10000, quantity: 1, weightGrams: 0, requiresShipping: false }], shippingRates: [], address: { country: 'AR' }, taxRates: taxes });
    expect(added).toMatchObject({ subtotalCents: 10000, taxCents: 2100, totalCents: 12100 });
    const included = computeTotals({ lines: [{ unitCents: 12100, quantity: 1, weightGrams: 0, requiresShipping: false }], shippingRates: [], address: { country: 'AR' }, taxRates: taxes, taxIncluded: true });
    expect(included).toMatchObject({ taxCents: 2100, totalCents: 12100, taxIncluded: true });
  });

  it('total completo: descuento, envío elegido, impuesto sobre el envío', () => {
    const t = computeTotals({
      lines: [
        { unitCents: 2500, quantity: 2, weightGrams: 300 },
        { unitCents: 1000, quantity: 1, weightGrams: 200 },
      ],
      discount: { kind: 'percent', value: 1000 },
      shippingRates: rates,
      shippingRateId: 'light',
      address: { country: 'US', region: 'NY' },
      taxRates: taxes,
    });
    // 6000 − 600 = 5400; envío 800; impuesto 8,88 % de 6200 = 550,56 → 551.
    expect(t).toMatchObject({ subtotalCents: 6000, discountCents: 600, shippingCents: 800, taxCents: 551, totalCents: 6751, weightGrams: 800 });
  });

  it('envío gratis por código y opción que no aplica cae en la más barata', () => {
    const t = computeTotals({
      lines: [{ unitCents: 3000, quantity: 1, weightGrams: 2000 }],
      discount: { kind: 'free_shipping', value: 0 },
      shippingRates: rates,
      shippingRateId: 'light',
      address: { country: 'CL' },
      taxRates: [],
    });
    expect(t.shipping?.id).toBe('heavy');
    expect(t).toMatchObject({ shippingCents: 0, freeShippingByCode: true, totalCents: 3000 });
  });

  it('montos: parseo latino, Stripe sin decimales y formato', () => {
    expect(parseMoney('1.234,56')).toBe(123456);
    expect(parseMoney('1,234.56')).toBe(123456);
    expect(parseMoney('19.9')).toBe(1990);
    expect(parseMoney('abc')).toBeNull();
    expect(stripeAmount(150000, true)).toBe(1500);
    expect(stripeAmount(1999, false)).toBe(1999);
    expect(formatMoney(1999, 'USD', 'en')).toBe('$19.99');
  });
});

// ---------- Catálogo ----------

describe('shop: catálogo', () => {
  it('reglas de colecciones automáticas', () => {
    const p = { title: 'Linen shirt', vendor: 'Acme', productType: 'Shirts', tags: ['summer', 'linen'], minPriceCents: 4500 };
    expect(matchesRules(p, { match: 'all', rules: [{ field: 'tag', op: 'equals', value: 'Summer' }] })).toBe(true);
    expect(matchesRules(p, { match: 'all', rules: [{ field: 'tag', op: 'equals', value: 'summer' }, { field: 'price', op: 'gt', value: '50' }] })).toBe(false);
    expect(matchesRules(p, { match: 'any', rules: [{ field: 'title', op: 'contains', value: 'shirt' }, { field: 'price', op: 'gt', value: '50' }] })).toBe(true);
    expect(matchesRules(p, { match: 'all', rules: [] })).toBe(false);
  });

  it('descripción: deja negrita y links, saca scripts y bloques', () => {
    const out = sanitizeDescription('<p>Hola <strong>mundo</strong></p><script>alert(1)</script><p><a href="javascript:alert(1)">x</a> <a href="https://a.com">ok</a></p>');
    expect(out).not.toMatch(/script|javascript/);
    expect(out).toContain('<strong>mundo</strong>');
    expect(descriptionHtml(out)).toMatch(/^<p>Hola <strong>mundo<\/strong><\/p><p>/);
    expect(descriptionHtml('<img src=x onerror=alert(1)>texto')).not.toMatch(/onerror|<img/);
  });

  it('las imágenes se reconocen por sus bytes (sin SVG)', () => {
    expect(sniffRaster(new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0, 0, 0, 0]))?.mime).toBe('image/png');
    expect(sniffRaster(new Uint8Array([0xff, 0xd8, 0xff, 0xe0]))?.mime).toBe('image/jpeg');
    expect(sniffRaster(new TextEncoder().encode('<svg xmlns="http://www.w3.org/2000/svg"></svg>'))).toBeNull();
  });

  it('variantes: una por combinación, sin repetidas', async () => {
    const a = await workspace();
    const p = await createProduct(a, {
      title: 'Remera',
      status: 'active',
      options: [
        { name: 'Talle', values: ['S', 'M'] },
        { name: 'Color', values: ['Rojo'] },
      ],
      variants: [
        { options: ['S', 'Rojo'], priceCents: 1000, initialStock: 2 },
        { options: ['M', 'Rojo'], priceCents: 1200, initialStock: 0 },
      ],
    });
    expect(p.variants.map((v) => v.title)).toEqual(['S / Rojo', 'M / Rojo']);
    expect(p.variants[0].stock).toBe(2);
    await expect(createProduct(a, { title: 'X', options: [{ name: 'Talle', values: ['S'] }], variants: [{ options: ['S'], priceCents: 1 }, { options: ['S'], priceCents: 2 }] })).rejects.toMatchObject({
      code: 'duplicate_variant',
    });
  });
});

// ---------- Inventario bajo concurrencia ----------

describe('shop: inventario', () => {
  it('veinte compras a la vez por la última unidad: solo una reserva', async () => {
    const a = await workspace();
    const p = await createProduct(a, { title: 'Última', status: 'active', variants: [{ options: [], priceCents: 500, initialStock: 1 }] });
    const v = p.variants[0];
    const results = await Promise.allSettled(Array.from({ length: 20 }, () => reserveStock(a.ws, [{ variantId: v.id, quantity: 1, track: true }])));
    expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
    const rejected = results.filter((r): r is PromiseRejectedResult => r.status === 'rejected');
    expect(rejected.every((r) => r.reason instanceof ShopError && r.reason.code === 'out_of_stock')).toBe(true);
    const row = (await getDb().prepare('SELECT available, reserved FROM shop_inventory WHERE variant_id = ?').get(v.id)) as { available: number; reserved: number };
    expect(row).toEqual({ available: 1, reserved: 1 });
  });

  it('descontar al pagar es compare-and-set y nunca baja de cero', async () => {
    const a = await workspace();
    const p = await createProduct(a, { title: 'Cinco', status: 'active', variants: [{ options: [], priceCents: 500, initialStock: 5 }] });
    const v = p.variants[0];
    const [loc] = await reserveStock(a.ws, [{ variantId: v.id, quantity: 3, track: true }]);
    const item: StockItem = { variant_id: v.id, location_id: loc, quantity: 3, track_inventory: 1 };
    // Dos confirmaciones del mismo pago a la vez sobre la misma reserva (sin el CAS del pedido): la segunda no puede tomar la reserva ya consumida.
    const [first, second] = await Promise.all([commitStock(a.ws, 'o1', [item], true, null), commitStock(a.ws, 'o1', [item], true, null)]);
    expect([first.length, second.length].sort()).toEqual([0, 1]);
    const row = (await getDb().prepare('SELECT available, reserved FROM shop_inventory WHERE variant_id = ?').get(v.id)) as { available: number; reserved: number };
    expect(row).toEqual({ available: 2, reserved: 0 });
    // Un conteo por debajo de lo reservado se rechaza.
    await reserveStock(a.ws, [{ variantId: v.id, quantity: 2, track: true }]);
    await expect(adjustInventory(a, { variantId: v.id, locationId: loc!, set: 1, reason: 'count' })).rejects.toMatchObject({ code: 'below_reserved' });
    await expect(adjustInventory(a, { variantId: v.id, locationId: loc!, delta: -1, reason: 'damaged' })).rejects.toMatchObject({ code: 'below_reserved' });
  });
});

// ---------- Checkout, webhooks e idempotencia ----------

async function sellingStore() {
  const a = await workspace();
  await updateStore(a, { published: true, currency: 'USD' });
  await savePayments(a, { stripe: { secretKey: FAKE_STRIPE_KEY, webhookSecret: FAKE_WHSEC }, mercadopago: { accessToken: FAKE_MP_TOKEN, webhookSecret: FAKE_MP_SECRET }, manual: { enabled: true, instructions: 'CBU 123' } });
  await replaceShippingRates(a, [{ name: 'Flat', kind: 'flat', countries: [], priceCents: 500 }]);
  const p = await createProduct(a, { title: 'Taza', status: 'active', variants: [{ options: [], priceCents: 2000, initialStock: 3, weightGrams: 300 }] });
  return { a, store: await ensureStore(a.ws), variantId: p.variants[0].id, productId: p.id };
}

const address = { name: 'Ana Pérez', line1: 'Av. Siempre Viva 742', city: 'Springfield', country: 'AR' };

describe('shop: checkout y webhooks', () => {
  it('precios del servidor: el cliente no puede mandar precios', async () => {
    const { store, variantId } = await sellingStore();
    const cart = await priceCart(store, { lines: [{ variantId, quantity: 2, unitCents: 1 } as never], address: { country: 'AR' } });
    expect(cart.totals).toMatchObject({ subtotalCents: 4000, shippingCents: 500, totalCents: 4500 });
  });

  it('Stripe: el webhook firmado marca pagado una sola vez y descuenta el stock una vez', async () => {
    const { a, store, variantId } = await sellingStore();
    await createDiscount(a, { code: 'WELCOME10', kind: 'percent', value: 1000 });
    const res = await createCheckoutOrder(store, { email: 'ana@example.com', lines: [{ variantId, quantity: 2 }], address, discountCode: 'welcome10', paymentMethod: 'stripe' }, { origin: 'http://localhost' });
    const order = (await getOrderRow(a.ws, res.order.id))!;
    expect(order).toMatchObject({ status: 'pending', subtotal_cents: 4000, discount_cents: 400, shipping_cents: 500, total_cents: 4100, payment_ref: `fake_cs_${order.id}` });
    const event = {
      id: `evt_${uid()}`,
      type: 'checkout.session.completed',
      data: { object: { id: order.payment_ref, payment_status: 'paid', currency: 'usd', amount_total: 4100, payment_intent: 'pi_fake', metadata: { source: 'zerosoft_shop', order_id: order.id } } },
    };
    const body = JSON.stringify(event);
    const sig = signStripePayload(body, FAKE_WHSEC);
    await expect(handleStripeWebhook(store.webhook_token, body, 't=1,v1=00')).rejects.toMatchObject({ code: 'invalid_signature' });
    const results = await Promise.all([handleStripeWebhook(store.webhook_token, body, sig), handleStripeWebhook(store.webhook_token, body, sig)]);
    expect(results.filter((r) => r.kind === 'paid')).toHaveLength(1);
    expect((await handleStripeWebhook(store.webhook_token, body, sig)).kind).toBe('duplicate');
    // Otro evento con el mismo pago (reintento con id nuevo): el compare-and-set lo frena.
    const again = JSON.stringify({ ...event, id: `evt_${uid()}` });
    expect((await handleStripeWebhook(store.webhook_token, again, signStripePayload(again, FAKE_WHSEC))).kind).toBe('duplicate');
    const paid = (await getOrderRow(a.ws, order.id))!;
    expect(paid).toMatchObject({ status: 'paid', stock_state: 'committed', payment_id: 'pi_fake' });
    const inv = (await getDb().prepare('SELECT available, reserved FROM shop_inventory WHERE variant_id = ?').get(variantId)) as { available: number; reserved: number };
    expect(inv).toEqual({ available: 1, reserved: 0 });
    // Monto que no coincide: se ignora.
    const res2 = await createCheckoutOrder(store, { email: 'ana@example.com', lines: [{ variantId, quantity: 1 }], address, paymentMethod: 'stripe' }, { origin: 'http://localhost' });
    const o2 = (await getOrderRow(a.ws, res2.order.id))!;
    const bad = JSON.stringify({ id: `evt_${uid()}`, type: 'checkout.session.completed', data: { object: { id: o2.payment_ref, payment_status: 'paid', currency: 'usd', amount_total: 1, metadata: { source: 'zerosoft_shop', order_id: o2.id } } } });
    expect(await handleStripeWebhook(store.webhook_token, bad, signStripePayload(bad, FAKE_WHSEC))).toEqual({ kind: 'ignored', reason: 'amount' });
    // El cliente quedó en Shop y en el CRM.
    const customers = await listCustomers(a.ws);
    expect(customers[0]).toMatchObject({ email: 'ana@example.com', ordersCount: 1, totalSpentCents: 4100 });
    expect(customers[0].crmContactId).toBeTruthy();
    const discount = (await getDb().prepare("SELECT used_count FROM shop_discounts WHERE workspace_id = ? AND code = 'WELCOME10'").get(a.ws)) as { used_count: number };
    expect(discount.used_count).toBe(1);
  });

  it('Mercado Pago: firma x-signature y aviso repetido', async () => {
    const { a, store, variantId } = await sellingStore();
    const ts = Math.floor(Date.now() / 1000);
    expect(verifyMercadoPagoSignature(signMercadoPago('12345', 'req-1', FAKE_MP_SECRET, ts), 'req-1', '12345', FAKE_MP_SECRET, ts)).toBe(true);
    expect(verifyMercadoPagoSignature(signMercadoPago('12345', 'req-1', FAKE_MP_SECRET, ts), 'req-2', '12345', FAKE_MP_SECRET, ts)).toBe(false);
    const res = await createCheckoutOrder(store, { email: 'bruno@example.com', lines: [{ variantId, quantity: 1 }], address, paymentMethod: 'mercadopago' }, { origin: 'http://localhost' });
    const dataId = `fake${res.order.id}`;
    const send = () => handleMercadoPagoWebhook(store.webhook_token, { dataId, type: 'payment', requestId: 'r1', signature: signMercadoPago(dataId, 'r1', FAKE_MP_SECRET) });
    expect((await send()).kind).toBe('paid');
    expect((await send()).kind).toBe('duplicate');
    await expect(handleMercadoPagoWebhook(store.webhook_token, { dataId, type: 'payment', requestId: 'r1', signature: 'ts=1,v1=' + '0'.repeat(64) })).rejects.toMatchObject({ code: 'invalid_signature' });
    expect((await getOrderRow(a.ws, res.order.id))!.status).toBe('paid');
  });

  it('transferencia: queda pendiente con la reserva; vencidos online liberan stock y código', async () => {
    const { a, store, variantId } = await sellingStore();
    const manual = await createCheckoutOrder(store, { email: 'c@example.com', lines: [{ variantId, quantity: 1 }], address, paymentMethod: 'manual' }, { origin: 'http://localhost' });
    expect(manual.redirectUrl).toContain(`/store/${store.handle}/orders/`);
    await createDiscount(a, { code: 'ONCE', kind: 'fixed', value: 100, usageLimit: 1 });
    const online = await createCheckoutOrder(store, { email: 'd@example.com', lines: [{ variantId, quantity: 2 }], address, paymentMethod: 'stripe', discountCode: 'ONCE' }, { origin: 'http://localhost' });
    // Sin stock libre para un tercero, y el código ya no tiene usos.
    await expect(createCheckoutOrder(store, { email: 'e@example.com', lines: [{ variantId, quantity: 1 }], address, paymentMethod: 'stripe' }, { origin: 'http://localhost' })).rejects.toMatchObject({ code: 'out_of_stock' });
    expect(await expirePendingOrders(new Date(Date.now() + 2 * 3600_000))).toBeGreaterThanOrEqual(1);
    expect((await getOrderRow(a.ws, online.order.id))!).toMatchObject({ status: 'cancelled', cancel_reason: 'expired', stock_state: 'released' });
    expect((await getOrderRow(a.ws, manual.order.id))!.status).toBe('pending');
    const inv = (await getDb().prepare('SELECT available, reserved FROM shop_inventory WHERE variant_id = ?').get(variantId)) as { available: number; reserved: number };
    expect(inv).toEqual({ available: 3, reserved: 1 });
    expect(((await getDb().prepare("SELECT used_count FROM shop_discounts WHERE workspace_id = ? AND code = 'ONCE'").get(a.ws)) as { used_count: number }).used_count).toBe(0);
    await markPaidManually(a, manual.order.id);
    const inv2 = (await getDb().prepare('SELECT available, reserved FROM shop_inventory WHERE variant_id = ?').get(variantId)) as { available: number; reserved: number };
    expect(inv2).toEqual({ available: 2, reserved: 0 });
  });
});

// ---------- CSV ----------

const SHOPIFY_CSV = [
  'Handle,Title,Body (HTML),Vendor,Type,Tags,Published,Option1 Name,Option1 Value,Option2 Name,Option2 Value,Variant SKU,Variant Grams,Variant Inventory Tracker,Variant Inventory Qty,Variant Price,Variant Compare At Price,Variant Requires Shipping,Variant Barcode,Image Src,Status',
  'linen-shirt,Linen Shirt,"<p>Soft <b>linen</b>, cut loose.</p>",Acme,Shirts,"summer, linen",TRUE,Size,S,Color,Sand,LS-S-SA,250,shopify,4,45.00,60.00,TRUE,7790001,https://cdn.example.com/a.jpg,active',
  'linen-shirt,,,,,,,,M,,Sand,LS-M-SA,260,shopify,0,45.00,60.00,TRUE,7790002,https://cdn.example.com/b.jpg,',
  'linen-shirt,,,,,,,,,,,,,,,,,,,https://cdn.example.com/c.jpg,',
  'gift-note,Gift note,,,,,FALSE,Title,Default Title,,,GN,0,,,"1,500.00",,FALSE,,,draft',
].join('\n');

const TIENDANUBE_CSV = [
  'Identificador de URL;Nombre;Categorías;Nombre de propiedad 1;Valor de propiedad 1;Nombre de propiedad 2;Valor de propiedad 2;Nombre de propiedad 3;Valor de propiedad 3;Precio;Precio promocional;Peso (kg);Alto (cm);Ancho (cm);Profundidad (cm);Stock;SKU;Código de barras;Mostrar en tienda;Envío sin cargo;Descripción;Tags;Título para SEO;Descripción para SEO;Marca;Producto Físico',
  'zapatilla-urbana;Zapatilla Urbana;Calzado > Zapatillas;Talle;40;Color;Negro;;;35000,00;29900,00;0,8;;;;5;ZU-40-N;;SI;NO;<p>Cómoda</p>;urbana;;;Andes;SI',
  'zapatilla-urbana;Zapatilla Urbana;Calzado > Zapatillas;Talle;41;Color;Negro;;;35000,00;;0,8;;;;;ZU-41-N;;SI;NO;;;;;;SI',
].join('\n');

describe('shop: CSV', () => {
  it('lee el CSV de Shopify: variantes, imágenes y el producto sin opciones', () => {
    const r = parseProductCsv(SHOPIFY_CSV)!;
    expect(r.format).toBe('shopify');
    expect(r.errors).toEqual([]);
    const shirt = r.products.find((p) => p.handle === 'linen-shirt')!;
    expect(shirt.optionNames).toEqual(['Size', 'Color']);
    expect(shirt.variants.map((v) => [v.options.join('/'), v.priceCents, v.compareAtCents, v.stock])).toEqual([
      ['S/Sand', 4500, 6000, 4],
      ['M/Sand', 4500, 6000, 0],
    ]);
    expect(shirt.images).toHaveLength(3);
    const note = r.products.find((p) => p.handle === 'gift-note')!;
    expect(note.optionNames).toEqual([]);
    expect(note).toMatchObject({ status: 'draft', requiresShipping: false });
    expect(note.variants[0].priceCents).toBe(150000);
    expect(toProductInput(note, []).variants).toHaveLength(1);
  });

  it('lee la exportación de Tiendanube (punto y coma, precio promocional, kg, stock vacío = sin control)', () => {
    const r = parseProductCsv(TIENDANUBE_CSV)!;
    expect(r.format).toBe('tiendanube');
    const p = r.products[0];
    expect(p).toMatchObject({ handle: 'zapatilla-urbana', vendor: 'Andes', productType: 'Zapatillas', optionNames: ['Talle', 'Color'] });
    expect(p.variants[0]).toMatchObject({ priceCents: 2990000, compareAtCents: 3500000, weightGrams: 800, stock: 5, trackInventory: true });
    expect(p.variants[1]).toMatchObject({ priceCents: 3500000, compareAtCents: null, trackInventory: false });
  });

  it('importa, no duplica sin "actualizar" y el export vuelve a leerse igual', async () => {
    const a = await workspace();
    const first = await importProductsCsv(a, SHOPIFY_CSV, { fetchImages: false });
    expect(first).toMatchObject({ format: 'shopify', created: 2, updated: 0 });
    const again = await importProductsCsv(a, SHOPIFY_CSV, { fetchImages: false });
    expect(again).toMatchObject({ created: 0, skipped: 2 });
    const id = ((await getDb().prepare("SELECT id FROM shop_products WHERE workspace_id = ? AND handle = 'linen-shirt'").get(a.ws)) as { id: string }).id;
    const p = (await getProduct(a.ws, id))!;
    expect(p.variants.map((v) => v.stock)).toEqual([4, 0]);
    expect(p.description).toContain('<b>linen</b>');
    const csv = exportShopifyCsv([{ ...p, variants: p.variants.map((v) => ({ ...v, stock: v.stock })) }], (u) => u);
    const back = parseProductCsv(csv)!;
    expect(back.products[0].variants.map((v) => v.sku)).toEqual(['LS-S-SA', 'LS-M-SA']);
    expect(parseProductCsv('a,b\n1,2')).toBeNull();
  });
});

// ---------- Permisos ----------

describe('shop: permisos', () => {
  it('una persona sin la app no tiene Shop, ni sus herramientas ni sus scopes', () => {
    expect(canUseApp({ role: 'member', apps: '["crm"]' }, 'shop')).toBe(false);
    expect(canUseApp({ role: 'member', apps: '["shop"]' }, 'shop')).toBe(true);
    expect(canUseApp({ role: 'guest', apps: '*' }, 'shop')).toBe(false);
    expect(toolsFor({ role: 'member', apps: ['crm'] }).some((t) => t.app === 'shop')).toBe(false);
    expect(toolsFor({ role: 'member', apps: ['shop'] }).filter((t) => t.app === 'shop').map((t) => t.name)).toContain('shop_orders');
    expect(scopesForApps(['shop:read', 'crm:read'], ['crm'])).toEqual(['crm:read']);
  });

  it('cobros y reembolsos solo para admins', async () => {
    const { a, store, variantId } = await sellingStore();
    const member: ShopActor = { ...a, admin: false };
    await expect(savePayments(member, { manual: { enabled: false } })).rejects.toMatchObject({ code: 'forbidden' });
    const res = await createCheckoutOrder(store, { email: 'f@example.com', lines: [{ variantId, quantity: 1 }], address, paymentMethod: 'manual' }, { origin: 'http://localhost' });
    await markPaidManually(a, res.order.id);
    await expect(refundOrder(member, res.order.id, {})).rejects.toMatchObject({ code: 'forbidden' });
    const refunded = await refundOrder(a, res.order.id, { amountCents: 1000 });
    expect(refunded).toMatchObject({ status: 'paid', refundedCents: 1000 });
    await expect(refundOrder(a, res.order.id, { amountCents: 999_999 })).rejects.toMatchObject({ code: 'invalid_amount' });
    const full = await refundOrder(a, res.order.id, { restock: true });
    expect(full.status).toBe('refunded');
  });

  it('la tienda sin publicar no vende', async () => {
    const { a, store, variantId } = await sellingStore();
    await updateStore(a, { published: false });
    await expect(createCheckoutOrder({ ...store, published: 0 }, { email: 'g@example.com', lines: [{ variantId, quantity: 1 }], address, paymentMethod: 'manual' }, { origin: 'http://localhost' })).rejects.toMatchObject({
      code: 'store_closed',
    });
  });
});

beforeAll(async () => {
  await getDb().prepare('SELECT 1').get();
});
