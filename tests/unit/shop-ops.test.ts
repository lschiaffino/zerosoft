import { beforeAll, describe, expect, it } from 'vitest';
import { getDb, upsertUser } from '@/lib/db';
import { computeTotals, discountLineError, lineDiscountAmount, shippingOptions, type ShippingRate } from '@/lib/shop-money';
import { createDiscount, createLocation, createProduct, ensureStore, listInventory, nowDb, updateStore } from '@/lib/shop';
import { createCheckoutOrder, fulfillOrder, getOrder, markPaidManually, orderByStatusToken, priceCart, publicOrder } from '@/lib/shop-orders';
import { confirmDraftOrder, createDraftOrder, createPurchaseOrder, createReturn, declineReturn, approveReturn, deleteDraftOrder, receivePurchaseOrder, receiveReturn, requestReturnAsCustomer, transferStock, orderReturns } from '@/lib/shop-ops';
import { SHOP_EMAIL_CAPS, claimShopEmail, optOut } from '@/lib/shop-email-guard';
import { listAbandoned, markCheckoutRecovered, saveCheckoutProgress, sendAbandonedEmails } from '@/lib/shop-abandoned';
import { accountOrders, createPage, deletePage, productFeed, sendAccountLink, storefrontPage, updatePage } from '@/lib/shop-pages';
import { exportOrdersCsv, shopReports } from '@/lib/shop-reports';
import { savePayments } from '@/lib/shop-payments';
import type { ShopActor } from '@/lib/shop-schema';

const line = (unitCents: number, quantity: number, productId = 'p') => ({ unitCents, quantity, weightGrams: 0, productId });

describe('descuentos por líneas', () => {
  it('lleve 3 pague 2: la unidad más barata de cada grupo sale gratis', () => {
    const d = { kind: 'bxgy' as const, value: 10_000, buyQuantity: 2, getQuantity: 1 };
    expect(lineDiscountAmount(d, [line(1000, 2), line(400, 1)], null)).toBe(400);
    expect(lineDiscountAmount(d, [line(1000, 6)], null)).toBe(2000);
    expect(lineDiscountAmount(d, [line(1000, 2)], null)).toBe(0);
  });
  it('lleve X con 50 %: descuenta la mitad de la unidad', () => {
    expect(lineDiscountAmount({ kind: 'bxgy', value: 5000, buyQuantity: 1, getQuantity: 1 }, [line(1000, 2)], null)).toBe(500);
  });
  it('el alcance limita la base del descuento', () => {
    const eligible = new Set(['a']);
    const lines = [line(1000, 1, 'a'), line(5000, 1, 'b')];
    expect(lineDiscountAmount({ kind: 'percent', value: 1000 }, lines, eligible)).toBe(100);
    expect(lineDiscountAmount({ kind: 'fixed', value: 99_999 }, lines, eligible)).toBe(1000);
    expect(discountLineError({ kind: 'percent' }, [line(1000, 1, 'b')], eligible)).toBe('discount_not_applicable');
  });
  it('unidades mínimas', () => {
    expect(discountLineError({ kind: 'percent', minQuantity: 3 }, [line(100, 2)], null)).toBe('discount_min_quantity');
    expect(discountLineError({ kind: 'percent', minQuantity: 3 }, [line(100, 3)], null)).toBeNull();
    expect(discountLineError({ kind: 'bxgy', buyQuantity: 2, getQuantity: 1 }, [line(100, 2)], null)).toBe('discount_min_quantity');
  });
  it('el descuento por medio de pago va sobre la mercadería, no sobre el envío, y se separa', () => {
    const rate: ShippingRate = { id: 's', name: 'S', kind: 'flat', countries: [], priceCents: 500, minWeightG: null, maxWeightG: null, freeOverCents: null };
    const t = computeTotals({ lines: [line(1000, 1)], discountCentsOverride: 200, paymentDiscountBps: 1000, shippingRates: [rate], address: { country: 'AR' }, taxRates: [] });
    expect(t.paymentDiscountCents).toBe(80);
    expect(t.discountCents).toBe(280);
    expect(t.totalCents).toBe(1000 - 280 + 500);
  });
  it('monedas sin decimales: redondea el descuento por medio a enteros', () => {
    const t = computeTotals({ lines: [{ unitCents: 12_300, quantity: 1, weightGrams: 0, requiresShipping: false }], paymentDiscountBps: 1000, shippingRates: [], address: null, taxRates: [], currency: 'CLP' });
    expect(t.paymentDiscountCents % 100).toBe(0);
  });
});

describe('retiro en un local', () => {
  const pickup: ShippingRate = { id: 'pu', name: 'Local', kind: 'pickup', countries: ['AR'], priceCents: 0, minWeightG: null, maxWeightG: null, freeOverCents: null, note: 'Calle 1' };
  const flat: ShippingRate = { id: 'fl', name: 'Correo', kind: 'flat', countries: ['AR'], priceCents: 100, minWeightG: null, maxWeightG: null, freeOverCents: null };
  it('se ofrece antes de elegir país', () => {
    expect(shippingOptions([pickup, flat], null, 0, 0).map((o) => o.id)).toEqual(['pu']);
  });
  it('solo se aplica si se eligió: ser la más barata no deja a nadie sin dirección', () => {
    const base = { lines: [line(1000, 1)], shippingRates: [pickup, flat], address: { country: 'AR' }, taxRates: [] };
    const auto = computeTotals(base);
    expect(auto.shipping?.id).toBe('fl');
    expect(auto.needsAddress).toBe(true);
    const chosen = computeTotals({ ...base, shippingRateId: 'pu' });
    expect(chosen.needsAddress).toBe(false);
    expect(chosen.shipping?.pickup).toBe(true);
  });
  it('el impuesto es el del país del local', () => {
    const t = computeTotals({ lines: [line(1000, 1)], shippingRates: [pickup], shippingRateId: 'pu', address: null, taxRates: [{ country: 'AR', region: '', rateBps: 2100, name: 'IVA', appliesToShipping: false }] });
    expect(t.taxCents).toBe(210);
  });
});

describe('Shop: operaciones', () => {
  const ws = `shop-ops-${Date.now()}`;
  const actor: ShopActor = { ws, person: ws, admin: true };
  const member: ShopActor = { ws, person: `${ws}-m`, admin: false };
  const uid = () => Math.random().toString(36).slice(2, 8);
  let storeRow: Awaited<ReturnType<typeof ensureStore>>;

  beforeAll(async () => {
    await upsertUser({ id: ws, email: `${ws}@example.com`, name: 'Ops' });
    storeRow = await ensureStore(ws);
    await updateStore(actor, { published: true, handle: `ops-${uid()}${uid()}` });
    await savePayments(actor, { manual: { enabled: true, label: 'Transferencia', instructions: 'CBU 123' } });
    storeRow = await ensureStore(ws);
  });

  async function product(stock = 10, opts: Record<string, unknown> = {}) {
    const p = await createProduct(actor, { title: `P ${uid()}`, status: 'active', requiresShipping: false, variants: [{ options: [], priceCents: 1000, initialStock: stock, ...opts }] });
    return { id: p.id, variantId: p.variants[0].id };
  }
  const buy = (variantId: string, quantity: number, extra: Record<string, unknown> = {}) =>
    createCheckoutOrder(storeRow, { email: `c-${uid()}@example.com`, lines: [{ variantId, quantity }], paymentMethod: 'manual', ...extra }, { origin: 'https://example.com' });

  it('venta sin stock: se acepta, avisa en el carrito y el disponible puede quedar negativo', async () => {
    const p = await product(1, { continueSelling: true });
    const cart = await priceCart(storeRow, { lines: [{ variantId: p.variantId, quantity: 3 }] });
    expect(cart.lines[0].short).toBe(false);
    expect(cart.lines[0].backorder).toBe(true);
    const { order } = await buy(p.variantId, 3);
    await markPaidManually(actor, order.id);
    const inv = (await listInventory(ws)).find((r) => r.variantId === p.variantId)!;
    expect(inv.available).toBe(-2);
    expect(inv.reserved).toBe(0);
  });

  it('sin la opción, sigue sin sobreventa', async () => {
    const p = await product(1);
    await expect(buy(p.variantId, 2)).rejects.toMatchObject({ code: 'out_of_stock' });
  });

  it('descuento automático: se aplica solo, gana el mayor y un código peor se avisa', async () => {
    const p = await product(50);
    const title = `Promo ${uid()}`;
    const auto = await createDiscount(actor, { code: `AUTO-${uid()}`, method: 'automatic', title, kind: 'percent', value: 3000, scope: { productIds: [p.id], collectionIds: [] } });
    const cart = await priceCart(storeRow, { lines: [{ variantId: p.variantId, quantity: 1 }] });
    expect(cart.applied?.label).toBe(title);
    expect(cart.totals.discountCents).toBe(300);
    const small = `SMALL${uid().toUpperCase()}`;
    await createDiscount(actor, { code: small, kind: 'percent', value: 500 });
    const withCode = await priceCart(storeRow, { lines: [{ variantId: p.variantId, quantity: 1 }], discountCode: small });
    expect(withCode.applied?.id).toBe(auto.id);
    expect(withCode.discount?.error).toBe('discount_auto_better');
    const { order } = await buy(p.variantId, 1, { discountCode: small });
    expect(order.discountCents).toBe(300);
    expect(order.discountCode).toBe(title);
    await getDb().prepare('UPDATE shop_discounts SET active = 0 WHERE id = ?').run(auto.id);
  });

  it('el nombre interno de un automático no sirve como código', async () => {
    const code = `HID${uid().toUpperCase()}`;
    const d = await createDiscount(actor, { code, method: 'automatic', title: 'Oculto', kind: 'percent', value: 100, minQuantity: 999 });
    const p = await product(5);
    const cart = await priceCart(storeRow, { lines: [{ variantId: p.variantId, quantity: 1 }], discountCode: code });
    expect(cart.discount?.error).toBe('discount_invalid');
    await getDb().prepare('UPDATE shop_discounts SET active = 0 WHERE id = ?').run(d.id);
  });

  it('una vez por cliente, por email', async () => {
    const p = await product(20);
    const code = `ONCE${uid().toUpperCase()}`;
    await createDiscount(actor, { code, kind: 'percent', value: 1000, oncePerCustomer: true });
    const email = `once-${uid()}@example.com`;
    await createCheckoutOrder(storeRow, { email, lines: [{ variantId: p.variantId, quantity: 1 }], paymentMethod: 'manual', discountCode: code }, { origin: 'https://example.com' });
    await expect(createCheckoutOrder(storeRow, { email, lines: [{ variantId: p.variantId, quantity: 1 }], paymentMethod: 'manual', discountCode: code }, { origin: 'https://example.com' })).rejects.toMatchObject({ code: 'discount_once' });
  });

  it('envío parcial: cada unidad sale una vez y el pedido pasa a enviado al final', async () => {
    const p = await product(10);
    const { order } = await buy(p.variantId, 3);
    await markPaidManually(actor, order.id);
    const itemId = order.items[0].id;
    const a = await fulfillOrder(actor, order.id, { items: [{ itemId, quantity: 2 }], trackingNumber: 'T1', notify: false });
    expect(a.status).toBe('paid');
    expect(a.fulfillment).toBe('partial');
    await expect(fulfillOrder(actor, order.id, { items: [{ itemId, quantity: 2 }], notify: false })).rejects.toMatchObject({ code: 'conflict' });
    const b = await fulfillOrder(actor, order.id, { items: [{ itemId, quantity: 1 }], trackingNumber: 'T2', notify: false });
    expect(b.status).toBe('fulfilled');
    expect(b.fulfillment).toBe('full');
    const pub = await publicOrder(storeRow, (await orderByStatusToken(storeRow, (await buyToken(order.id))))!);
    expect(pub.shipments.map((s) => s.number)).toEqual(['T1', 'T2']);
  });
  async function buyToken(id: string) {
    return ((await getDb().prepare('SELECT status_token FROM shop_orders WHERE id = ?').get(id)) as { status_token: string }).status_token;
  }

  it('devolución: no se devuelve más de lo enviado, repone y rechazar libera las unidades', async () => {
    const p = await product(10);
    const { order } = await buy(p.variantId, 2);
    await markPaidManually(actor, order.id);
    const itemId = order.items[0].id;
    await expect(createReturn(actor, order.id, { items: [{ itemId, quantity: 1 }] })).rejects.toMatchObject({ code: 'invalid_return_quantity' });
    await fulfillOrder(actor, order.id, { notify: false });
    await expect(createReturn(actor, order.id, { items: [{ itemId, quantity: 3 }] })).rejects.toMatchObject({ code: 'invalid_return_quantity' });
    const [r] = await createReturn(actor, order.id, { items: [{ itemId, quantity: 2 }], reason: 'size' });
    await declineReturn(actor, r.id);
    const [r2] = (await createReturn(actor, order.id, { items: [{ itemId, quantity: 1 }], reason: 'damaged' })).filter((x) => x.status === 'approved');
    const before = (await listInventory(ws)).find((x) => x.variantId === p.variantId)!.available;
    await expect(receiveReturn(member, r2.id, { restock: true, refundCents: 100 })).rejects.toMatchObject({ code: 'forbidden' });
    await receiveReturn(actor, r2.id, { restock: true });
    expect((await listInventory(ws)).find((x) => x.variantId === p.variantId)!.available).toBe(before + 1);
    await expect(receiveReturn(actor, r2.id, { restock: true })).rejects.toMatchObject({ code: 'invalid_status' });
    expect((await listInventory(ws)).find((x) => x.variantId === p.variantId)!.available).toBe(before + 1);
    expect((await orderReturns(ws, order.id)).map((x) => x.status).sort()).toEqual(['declined', 'received']);
  });

  it('el cliente solo pide devolución si la tienda la abrió y dentro del plazo', async () => {
    const p = await product(5);
    const { order } = await buy(p.variantId, 1);
    await markPaidManually(actor, order.id);
    await fulfillOrder(actor, order.id, { notify: false });
    const row = (await orderByStatusToken(storeRow, await buyToken(order.id)))!;
    const body = { items: [{ itemId: order.items[0].id, quantity: 1 }], reason: 'size' };
    await expect(requestReturnAsCustomer(storeRow, row, body)).rejects.toMatchObject({ code: 'returns_closed' });
    const open = await updateStore(actor, { settings: { returnsDays: 30 } });
    await requestReturnAsCustomer(open, row, body);
    await expect(requestReturnAsCustomer(open, row, body)).rejects.toMatchObject({ code: 'return_open' });
    await getDb().prepare('UPDATE shop_orders SET fulfilled_at = ? WHERE id = ?').run(nowDb(new Date(Date.now() - 40 * 86_400_000)), order.id);
    await approveReturn(actor, (await orderReturns(ws, order.id))[0].id);
    const late = (await orderByStatusToken(storeRow, await buyToken(order.id)))!;
    await expect(requestReturnAsCustomer(open, late, body)).rejects.toMatchObject({ code: 'returns_closed' });
    await updateStore(actor, { settings: { returnsDays: 0 } });
    storeRow = await ensureStore(ws);
  });

  it('borrador: no reserva ni es visible hasta confirmar; sin stock vuelve a borrador', async () => {
    const p = await product(2);
    const d = await createDraftOrder(actor, { email: `d-${uid()}@example.com`, lines: [{ variantId: p.variantId, quantity: 2 }, { title: 'Armado', priceCents: 500, quantity: 1 }], discountCents: 100, shippingCents: 300, shippingName: 'Moto' });
    expect(d.status).toBe('draft');
    expect(d.totalCents).toBe(2000 + 500 - 100 + 300);
    expect((await listInventory(ws)).find((x) => x.variantId === p.variantId)!.reserved).toBe(0);
    expect(await orderByStatusToken(storeRow, await buyToken(d.id))).toBeNull();

    const big = await createDraftOrder(actor, { email: `d-${uid()}@example.com`, lines: [{ variantId: p.variantId, quantity: 99 }] });
    await expect(confirmDraftOrder(actor, big.id, 'pending')).rejects.toMatchObject({ code: 'out_of_stock' });
    expect((await getOrder(ws, big.id))!.status).toBe('draft');
    await deleteDraftOrder(actor, big.id);

    const { order } = await confirmDraftOrder(actor, d.id, 'paid');
    expect(order.status).toBe('paid');
    expect((await listInventory(ws)).find((x) => x.variantId === p.variantId)!.available).toBe(0);
    await expect(confirmDraftOrder(actor, d.id, 'paid')).rejects.toMatchObject({ code: 'invalid_status' });
    await expect(deleteDraftOrder(actor, d.id)).rejects.toMatchObject({ code: 'invalid_status' });
  });

  it('transferencia: mueve solo lo libre y deja las dos ubicaciones al día', async () => {
    const other = await createLocation(actor, `Dep ${uid()}`);
    const p = await product(5);
    const from = (await listInventory(ws)).find((x) => x.variantId === p.variantId)!.locationId;
    await buy(p.variantId, 4);
    await expect(transferStock(actor, { variantId: p.variantId, fromLocationId: from, toLocationId: other.id, quantity: 2 })).rejects.toMatchObject({ code: 'out_of_stock' });
    await transferStock(actor, { variantId: p.variantId, fromLocationId: from, toLocationId: other.id, quantity: 1 });
    const inv = (await listInventory(ws)).filter((x) => x.variantId === p.variantId);
    expect(inv.find((x) => x.locationId === from)!.available).toBe(4);
    expect(inv.find((x) => x.locationId === other.id)!.available).toBe(1);
    await expect(transferStock(actor, { variantId: p.variantId, fromLocationId: from, toLocationId: from, quantity: 1 })).rejects.toMatchObject({ code: 'same_location' });
    const foreign: ShopActor = { ws: `${ws}-otro`, person: 'x', admin: true };
    await expect(transferStock(foreign, { variantId: p.variantId, fromLocationId: from, toLocationId: other.id, quantity: 1 })).rejects.toMatchObject({ code: 'not_found' });
  });

  it('orden de compra: recepción parcial suma al stock y no se recibe de más', async () => {
    const p = await product(0);
    const po = await createPurchaseOrder(actor, { supplier: 'Textil SA', items: [{ variantId: p.variantId, quantity: 10, unitCostCents: 300 }] });
    const itemId = po.items[0].id;
    const a = await receivePurchaseOrder(actor, po.id, [{ itemId, quantity: 4 }]);
    expect(a.status).toBe('partial');
    expect((await listInventory(ws)).find((x) => x.variantId === p.variantId)!.available).toBe(4);
    await expect(receivePurchaseOrder(actor, po.id, [{ itemId, quantity: 7 }])).rejects.toMatchObject({ code: 'invalid_return_quantity' });
    const b = await receivePurchaseOrder(actor, po.id, [{ itemId, quantity: 6 }]);
    expect(b.status).toBe('received');
    await expect(receivePurchaseOrder(actor, po.id, [{ itemId, quantity: 1 }])).rejects.toMatchObject({ code: 'invalid_status' });
  });

  it('topes de email: idempotencia, por destinatario, global, recordatorios y cuenta nueva', async () => {
    const wsA = `${ws}-a`;
    const to = `cap-${uid()}@example.com`;
    await upsertUser({ id: wsA, email: `${wsA}@example.com`, name: 'A' });
    await ensureStore(wsA);
    const first = await claimShopEmail(wsA, to, 'order_confirmation', 'r1');
    expect(first.ok).toBe(true);
    expect(await claimShopEmail(wsA, to, 'order_confirmation', 'r1')).toEqual({ ok: false, reason: 'duplicate' });
    for (let i = 2; i <= SHOP_EMAIL_CAPS.recipientStoreDay; i++) expect((await claimShopEmail(wsA, to, 'order_shipped', `r${i}`)).ok).toBe(true);
    expect(await claimShopEmail(wsA, to, 'order_shipped', 'over')).toEqual({ ok: false, reason: 'recipient_cap' });

    const reminded = `rem-${uid()}@example.com`;
    expect((await claimShopEmail(wsA, reminded, 'abandoned', 'a1')).ok).toBe(true);
    expect((await claimShopEmail(wsA, reminded, 'abandoned', 'a2')).ok).toBe(true);
    expect(await claimShopEmail(wsA, reminded, 'abandoned', 'a3')).toEqual({ ok: false, reason: 'recipient_cap' });

    const out = `out-${uid()}@example.com`;
    await optOut(wsA, out);
    expect(await claimShopEmail(wsA, out, 'abandoned', 'o1')).toEqual({ ok: false, reason: 'opted_out' });
    expect((await claimShopEmail(wsA, out, 'order_confirmation', 'o2')).ok).toBe(true);

    // Cuenta nueva: tope diario de la tienda, con destinatarios distintos.
    const wsB = `${ws}-b`;
    await upsertUser({ id: wsB, email: `${wsB}@example.com`, name: 'B' });
    await ensureStore(wsB);
    let sent = 0;
    for (let i = 0; i < SHOP_EMAIL_CAPS.newAccountReminderDay + 3; i++) if ((await claimShopEmail(wsB, `n${i}-${uid()}@example.com`, 'abandoned', `n${i}`)).ok) sent++;
    expect(sent).toBe(SHOP_EMAIL_CAPS.newAccountReminderDay);
  });

  it('cron de abandonados: opt-in, una sola vez y recuperado no recibe nada', async () => {
    const wsC = `${ws}-c`;
    await upsertUser({ id: wsC, email: `${wsC}@example.com`, name: 'C' });
    const actorC: ShopActor = { ws: wsC, person: wsC, admin: true };
    await ensureStore(wsC);
    let store = await updateStore(actorC, { published: true, handle: `cron-${uid()}${uid()}` });
    const email = `ab-${uid()}@example.com`;
    const gone = `gone-${uid()}@example.com`;
    await saveCheckoutProgress(store, { email, lines: [{ variantId: 'v', quantity: 1 }], subtotalCents: 1000 });
    await saveCheckoutProgress(store, { email: gone, lines: [{ variantId: 'v', quantity: 1 }], subtotalCents: 500 });
    await markCheckoutRecovered(wsC, gone, 'ord_x');
    const later = new Date(Date.now() + 5 * 3_600_000);
    // Apagado por defecto.
    await sendAbandonedEmails(later);
    expect((await listAbandoned(store, { now: later })).find((c) => c.email === email)!.emailState).toBe('none');
    store = await updateStore(actorC, { settings: { emailAbandoned: true, abandonedHours: 4 } });
    // Todavía no pasaron las horas.
    await sendAbandonedEmails(new Date(Date.now() + 2 * 3_600_000));
    expect((await listAbandoned(store, { now: later })).find((c) => c.email === email)!.emailState).toBe('none');
    await sendAbandonedEmails(later);
    const rows = await listAbandoned(store, { now: later });
    expect(rows.find((c) => c.email === email)!.emailState).toBe('sent');
    expect(rows.find((c) => c.email === gone)!.status).toBe('recovered');
    expect(rows.find((c) => c.email === gone)!.emailState).toBe('none');
    const log = (await getDb().prepare("SELECT COUNT(*) AS n FROM shop_email_log WHERE workspace_id = ? AND kind = 'abandoned'").get(wsC)) as { n: number };
    await sendAbandonedEmails(later);
    const again = (await getDb().prepare("SELECT COUNT(*) AS n FROM shop_email_log WHERE workspace_id = ? AND kind = 'abandoned'").get(wsC)) as { n: number };
    expect(Number(log.n)).toBe(1);
    expect(Number(again.n)).toBe(1);
  });

  it('páginas: HTML saneado, oculta no es pública, dirección única', async () => {
    const a = await createPage(actor, { title: 'Cambios', body: '<p>Hola <script>alert(1)</script><a href="javascript:x">y</a></p>' });
    expect(a.body).not.toContain('script');
    expect(a.body).not.toContain('javascript:');
    const b = await createPage(actor, { title: 'Cambios' });
    expect(b.handle).not.toBe(a.handle);
    expect(await storefrontPage(ws, 'page', a.handle)).not.toBeNull();
    await updatePage(actor, a.id, { published: false });
    expect(await storefrontPage(ws, 'page', a.handle)).toBeNull();
    const foreign: ShopActor = { ws: `${ws}-otro`, person: 'x', admin: true };
    await expect(updatePage(foreign, a.id, { title: 'x' })).rejects.toMatchObject({ code: 'not_found' });
    expect(await deletePage(foreign, a.id)).toBe(false);
  });

  it('mis pedidos: sin compras no sale nada y el token no sirve en otra tienda', async () => {
    const p = await product(5);
    const email = `acc-${uid()}@example.com`;
    await createCheckoutOrder(storeRow, { email, lines: [{ variantId: p.variantId, quantity: 1 }], paymentMethod: 'manual' }, { origin: 'https://example.com' });
    await sendAccountLink(storeRow, `nadie-${uid()}@example.com`, 'https://example.com');
    const none = (await getDb().prepare("SELECT COUNT(*) AS n FROM shop_account_links WHERE workspace_id = ? AND email LIKE 'nadie-%'").get(ws)) as { n: number };
    expect(Number(none.n)).toBe(0);
    await sendAccountLink(storeRow, email, 'https://example.com');
    const links = (await getDb().prepare('SELECT COUNT(*) AS n FROM shop_account_links WHERE workspace_id = ? AND email = ?').get(ws, email)) as { n: number };
    expect(Number(links.n)).toBe(1);
    expect(await accountOrders(storeRow, 'a'.repeat(32))).toBeNull();
  });

  it('feed: escapa XML y marca disponibilidad; CSV sin fórmulas y reportes del período', async () => {
    const p = await createProduct(actor, { title: 'A & B <x>', status: 'active', requiresShipping: false, variants: [{ options: [], priceCents: 1250, initialStock: 0 }] });
    const xml = await productFeed(storeRow, 'https://example.com');
    expect(xml).toContain('A &amp; B &lt;x&gt;');
    expect(xml).toContain('out_of_stock');
    expect(xml).toContain('12.50');
    expect(p.id).toBeTruthy();
    const q = await product(5);
    const { order } = await createCheckoutOrder(storeRow, { email: `=cmd-${uid()}@example.com`.replace('=', 'x'), lines: [{ variantId: q.variantId, quantity: 1 }], paymentMethod: 'manual', contactName: '=HYPERLINK("x")' }, { origin: 'https://example.com' });
    await markPaidManually(actor, order.id);
    const csv = await exportOrdersCsv(ws, null);
    expect(csv).toContain(`${order.number}`);
    expect(csv).not.toMatch(/(^|,)=HYPERLINK/m);
    const r = await shopReports(ws, 30);
    expect(r.byPayment.find((x) => x.key === 'manual')!.orders).toBeGreaterThan(0);
    expect(r.byDay.length).toBeGreaterThan(0);
  });
});
