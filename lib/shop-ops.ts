/**
 * Shop: operaciones del equipo sobre pedidos y stock. Borradores de pedido y
 * factura, devoluciones (del equipo o pedidas desde la página del pedido),
 * transferencias entre ubicaciones y órdenes de compra. Cada transición se
 * reclama con compare-and-set. Server-only.
 */
import { randomBytes } from 'crypto';
import { z } from 'zod';
import { getDb } from './db';
import {
  defaultLocation,
  ensureStore,
  getStore,
  logInventory,
  newId,
  nowDb,
  reserveStock,
  revalidateStore,
  upsertCustomer,
  listTaxRates,
  type StoreRow,
} from './shop';
import { computeTotals, roundToCurrency } from './shop-money';
import { addOrderEvent, getOrder, getOrderRow, markOrderPaid, orderItems, refundOrder, type OrderDto, type OrderItemRow, type OrderRow } from './shop-orders';
import { ShopError, addressSchema, normalizeSettings, parseJson, type ShopActor } from './shop-schema';

// ---------- Borradores ----------

export const draftInputSchema = z.object({
  email: z.string().trim().toLowerCase().email().max(200),
  name: z.string().trim().max(120).default(''),
  phone: z.string().trim().max(40).default(''),
  lines: z
    .array(
      z.union([
        z.object({ variantId: z.string().min(1).max(80), quantity: z.number().int().min(1).max(999) }),
        z.object({ title: z.string().trim().min(1).max(200), priceCents: z.number().int().min(0).max(1_000_000_000), quantity: z.number().int().min(1).max(999), requiresShipping: z.boolean().default(true) }),
      ]),
    )
    .min(1)
    .max(100),
  address: addressSchema.nullable().optional(),
  shippingName: z.string().trim().max(80).default(''),
  shippingCents: z.number().int().min(0).max(100_000_000).default(0),
  discountCents: z.number().int().min(0).max(1_000_000_000).default(0),
  note: z.string().max(1000).default(''),
});
export type DraftInput = z.infer<typeof draftInputSchema>;

interface DraftLine {
  productId: string | null;
  variantId: string | null;
  title: string;
  variantTitle: string;
  sku: string;
  quantity: number;
  unitCents: number;
  weightGrams: number;
  imageUrl: string | null;
  track: boolean;
  continueSelling: boolean;
  requiresShipping: boolean;
}

async function resolveDraftLines(ws: string, lines: DraftInput['lines']): Promise<DraftLine[]> {
  const db = getDb();
  const out: DraftLine[] = [];
  for (const l of lines) {
    if ('variantId' in l) {
      const r = (await db
        .prepare(
          `SELECT v.id, v.title AS vtitle, v.sku, v.price_cents, v.weight_grams, v.track_inventory, v.continue_selling, v.image_url, v.options, p.id AS pid, p.title, p.images, p.requires_shipping
           FROM shop_variants v JOIN shop_products p ON p.id = v.product_id WHERE v.id = ? AND v.workspace_id = ?`,
        )
        .get(l.variantId, ws)) as Record<string, unknown> | undefined;
      if (!r) throw new ShopError('cart_changed', 409);
      out.push({
        productId: String(r.pid),
        variantId: String(r.id),
        title: String(r.title),
        variantTitle: parseJson<string[]>(r.options, []).length ? String(r.vtitle) : '',
        sku: String(r.sku ?? ''),
        quantity: l.quantity,
        unitCents: Number(r.price_cents),
        weightGrams: Number(r.weight_grams ?? 0),
        imageUrl: (r.image_url as string | null) || parseJson<string[]>(r.images, [])[0] || null,
        track: Number(r.track_inventory) === 1,
        continueSelling: Number(r.continue_selling ?? 0) === 1,
        requiresShipping: Number(r.requires_shipping) === 1,
      });
    } else {
      out.push({ productId: null, variantId: null, title: l.title, variantTitle: '', sku: '', quantity: l.quantity, unitCents: l.priceCents, weightGrams: 0, imageUrl: null, track: false, continueSelling: false, requiresShipping: l.requiresShipping });
    }
  }
  return out;
}

async function draftTotals(store: StoreRow, lines: DraftLine[], input: DraftInput) {
  const taxes = await listTaxRates(store.workspace_id);
  const shipping = roundToCurrency(input.shippingCents, store.currency);
  const totals = computeTotals({
    lines: lines.map((l) => ({ unitCents: l.unitCents, quantity: l.quantity, weightGrams: l.weightGrams, requiresShipping: l.requiresShipping })),
    discountCentsOverride: input.discountCents,
    shippingRates: [{ id: 'draft', name: input.shippingName || 'Shipping', kind: 'flat', countries: [], priceCents: shipping, minWeightG: null, maxWeightG: null, freeOverCents: null }],
    shippingRateId: 'draft',
    address: input.address ?? null,
    taxRates: taxes,
    taxIncluded: store.tax_included === 1,
    currency: store.currency,
  });
  // Sin dirección no hay tarifa que aplique en computeTotals: el envío del borrador lo pone el equipo.
  if (!totals.shipping && totals.needsShipping && shipping > 0) {
    totals.shippingCents = shipping;
    totals.totalCents += shipping;
  }
  return totals;
}

async function writeDraftItems(ws: string, orderId: string, lines: DraftLine[]): Promise<void> {
  const db = getDb();
  await db.prepare('DELETE FROM shop_order_items WHERE order_id = ?').run(orderId);
  for (const l of lines) {
    await db
      .prepare(
        `INSERT INTO shop_order_items (id, order_id, workspace_id, product_id, variant_id, location_id, title, variant_title, sku, quantity, unit_cents, total_cents, weight_grams, image_url, track_inventory, backorder)
         VALUES (?, ?, ?, ?, ?, NULL, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(newId('oit'), orderId, ws, l.productId, l.variantId, l.title, l.variantTitle, l.sku, l.quantity, l.unitCents, l.unitCents * l.quantity, l.weightGrams, l.imageUrl, l.track ? 1 : 0, l.continueSelling ? 1 : 0);
  }
}

/** Borrador: no reserva stock ni existe para el cliente hasta confirmarlo. */
export async function createDraftOrder(actor: ShopActor, raw: unknown): Promise<OrderDto> {
  const parsed = draftInputSchema.safeParse(raw);
  if (!parsed.success) throw new ShopError('invalid_input', 400, { issues: parsed.error.issues.slice(0, 5).map((i) => i.path.join('.')) });
  const input = parsed.data;
  const store = await ensureStore(actor.ws);
  const lines = await resolveDraftLines(actor.ws, input.lines);
  const t = await draftTotals(store, lines, input);
  const row = (await getDb().prepare('UPDATE shop_stores SET next_number = next_number + 1 WHERE workspace_id = ? RETURNING next_number - 1 AS n').get(actor.ws)) as { n: number };
  const id = newId('ord');
  const ts = nowDb();
  const customerId = await upsertCustomer(actor.ws, { email: input.email, name: input.name, phone: input.phone });
  await getDb()
    .prepare(
      `INSERT INTO shop_orders (id, workspace_id, number, status, email, customer_id, name, phone, currency, subtotal_cents, discount_cents, shipping_cents, tax_cents, total_cents, tax_included, shipping_name, shipping_address, payment_method, customer_note, stock_state, status_token, locale, created_at, updated_at, source)
       VALUES (?, ?, ?, 'draft', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'manual', ?, 'none', ?, ?, ?, ?, 'draft')`,
    )
    .run(id, actor.ws, Number(row.n), input.email, customerId, input.name, input.phone, store.currency, t.subtotalCents, t.discountCents, t.shippingCents, t.taxCents, t.totalCents, t.taxIncluded ? 1 : 0, input.shippingName || (t.shippingCents ? 'Shipping' : null), JSON.stringify(input.address ?? {}), input.note.trim(), randomBytes(18).toString('base64url'), store.locale, ts, ts);
  await writeDraftItems(actor.ws, id, lines);
  await addOrderEvent({ id, workspace_id: actor.ws }, 'created', 'Draft created', actor.person);
  return (await getOrder(actor.ws, id))!;
}

export async function updateDraftOrder(actor: ShopActor, id: string, raw: unknown): Promise<OrderDto> {
  const parsed = draftInputSchema.safeParse(raw);
  if (!parsed.success) throw new ShopError('invalid_input');
  const input = parsed.data;
  const store = await ensureStore(actor.ws);
  const lines = await resolveDraftLines(actor.ws, input.lines);
  const t = await draftTotals(store, lines, input);
  const customerId = await upsertCustomer(actor.ws, { email: input.email, name: input.name, phone: input.phone });
  const res = await getDb()
    .prepare(
      `UPDATE shop_orders SET email = ?, customer_id = ?, name = ?, phone = ?, subtotal_cents = ?, discount_cents = ?, shipping_cents = ?, tax_cents = ?, total_cents = ?, shipping_name = ?, shipping_address = ?, customer_note = ?, updated_at = ?
       WHERE id = ? AND workspace_id = ? AND status = 'draft'`,
    )
    .run(input.email, customerId, input.name, input.phone, t.subtotalCents, t.discountCents, t.shippingCents, t.taxCents, t.totalCents, input.shippingName || (t.shippingCents ? 'Shipping' : null), JSON.stringify(input.address ?? {}), input.note.trim(), nowDb(), id, actor.ws);
  if (!res.changes) throw new ShopError('invalid_status', 409);
  await writeDraftItems(actor.ws, id, lines);
  return (await getOrder(actor.ws, id))!;
}

export async function deleteDraftOrder(actor: ShopActor, id: string): Promise<void> {
  const res = await getDb().prepare("DELETE FROM shop_orders WHERE id = ? AND workspace_id = ? AND status = 'draft'").run(id, actor.ws);
  if (!res.changes) throw new ShopError('invalid_status', 409);
}

/**
 * Confirma el borrador: reclama la fila, reserva el stock y queda pendiente.
 * `paid` lo marca pagado (cobro por fuera) e `invoice` manda la factura.
 */
export async function confirmDraftOrder(actor: ShopActor, id: string, mode: 'pending' | 'invoice' | 'paid'): Promise<{ order: OrderDto; emailSent: boolean | null }> {
  const db = getDb();
  const o = await getOrderRow(actor.ws, id);
  if (!o) throw new ShopError('not_found', 404);
  const claim = await db.prepare("UPDATE shop_orders SET status = 'pending', updated_at = ? WHERE id = ? AND workspace_id = ? AND status = 'draft'").run(nowDb(), id, actor.ws);
  if (!claim.changes) throw new ShopError('invalid_status', 409);
  const items = await orderItems(id);
  let locations: Array<string | null>;
  try {
    locations = await reserveStock(
      actor.ws,
      items.map((i) => ({ variantId: i.variant_id ?? '', quantity: i.quantity, track: i.track_inventory === 1 && !!i.variant_id, continueSelling: Number(i.backorder ?? 0) === 1 })),
    );
  } catch (err) {
    await db.prepare("UPDATE shop_orders SET status = 'draft' WHERE id = ?").run(id);
    throw err;
  }
  for (const [n, it] of items.entries()) await db.prepare('UPDATE shop_order_items SET location_id = ? WHERE id = ?').run(locations[n], it.id);
  await db.prepare("UPDATE shop_orders SET stock_state = 'reserved' WHERE id = ?").run(id);
  await addOrderEvent(o, 'created', 'Draft confirmed', actor.person);
  let emailSent: boolean | null = null;
  if (mode === 'paid') {
    await markOrderPaid(actor.ws, id, { actor: actor.person, source: 'draft, marked by staff' });
  } else if (mode === 'invoice') {
    const store = await getStore(actor.ws);
    if (store) {
      const { sendOrderEmail } = await import('./shop-effects');
      emailSent = await sendOrderEmail(store, (await getOrderRow(actor.ws, id))!, await orderItems(id), 'invoice');
    }
  }
  return { order: (await getOrder(actor.ws, id))!, emailSent };
}

/** Reenviar la factura de un pedido pendiente. */
export async function resendInvoice(actor: ShopActor, id: string): Promise<boolean> {
  const o = await getOrderRow(actor.ws, id);
  if (!o) throw new ShopError('not_found', 404);
  if (o.status !== 'pending') throw new ShopError('invalid_status', 409);
  const store = await ensureStore(actor.ws);
  const { sendOrderEmail } = await import('./shop-effects');
  // Una referencia por día: reenviar se puede, pero los topes por destinatario siguen mandando.
  const sent = await sendOrderEmail(store, o, await orderItems(id), 'invoice', `${id}:${nowDb().slice(0, 10)}`);
  if (!sent) throw new ShopError('email_limit', 429);
  return true;
}

// ---------- Devoluciones ----------

export const RETURN_REASONS = ['size', 'damaged', 'wrong_item', 'not_as_described', 'changed_mind', 'other'] as const;
export const RETURN_STATUSES = ['requested', 'approved', 'received', 'declined'] as const;

export interface ReturnDto {
  id: string;
  orderId: string;
  orderNumber: number;
  email: string;
  status: (typeof RETURN_STATUSES)[number];
  items: Array<{ itemId: string; quantity: number; title: string; variantTitle: string }>;
  reason: string;
  note: string;
  refundCents: number;
  restocked: boolean;
  fromCustomer: boolean;
  createdAt: string;
  currency: string;
}

function returnDto(r: Record<string, unknown>, items: OrderItemRow[], o: Pick<OrderRow, 'number' | 'email' | 'currency'>): ReturnDto {
  return {
    id: String(r.id),
    orderId: String(r.order_id),
    orderNumber: o.number,
    email: o.email,
    currency: o.currency,
    status: r.status as ReturnDto['status'],
    items: parseJson<Array<{ itemId: string; quantity: number }>>(r.items, []).map((x) => {
      const it = items.find((i) => i.id === x.itemId);
      return { ...x, title: it?.title ?? '', variantTitle: it?.variant_title ?? '' };
    }),
    reason: String(r.reason),
    note: String(r.note ?? ''),
    refundCents: Number(r.refund_cents),
    restocked: Number(r.restocked) === 1,
    fromCustomer: Number(r.from_customer) === 1,
    createdAt: String(r.created_at),
  };
}

export async function orderReturns(ws: string, orderId: string): Promise<ReturnDto[]> {
  const o = await getOrderRow(ws, orderId);
  if (!o) return [];
  const [rows, items] = await Promise.all([getDb().prepare('SELECT * FROM shop_returns WHERE order_id = ? AND workspace_id = ? ORDER BY created_at DESC').all(orderId, ws) as Promise<Array<Record<string, unknown>>>, orderItems(orderId)]);
  return rows.map((r) => returnDto(r, items, o));
}

export async function listReturns(ws: string, opts: { status?: string; limit?: number } = {}): Promise<ReturnDto[]> {
  const status = (RETURN_STATUSES as readonly string[]).includes(opts.status ?? '') ? opts.status : null;
  const rows = (await getDb()
    .prepare(`SELECT r.*, o.number AS o_number, o.email AS o_email, o.currency AS o_currency FROM shop_returns r JOIN shop_orders o ON o.id = r.order_id WHERE r.workspace_id = ? ${status ? 'AND r.status = ?' : ''} ORDER BY r.created_at DESC LIMIT ?`)
    .all(...(status ? [ws, status] : [ws]), Math.min(500, opts.limit ?? 200))) as Array<Record<string, unknown>>;
  const out: ReturnDto[] = [];
  for (const r of rows) out.push(returnDto(r, await orderItems(String(r.order_id)), { number: Number(r.o_number), email: String(r.o_email), currency: String(r.o_currency) }));
  return out;
}

/** Reclama las unidades (returned_qty con compare-and-set contra lo enviado). */
async function claimReturnUnits(orderId: string, wanted: Array<{ itemId: string; quantity: number }>): Promise<void> {
  const db = getDb();
  const done: Array<{ itemId: string; quantity: number }> = [];
  for (const w of wanted) {
    const q = Math.trunc(Number(w.quantity) || 0);
    const res = q > 0 ? await db.prepare('UPDATE shop_order_items SET returned_qty = returned_qty + ? WHERE id = ? AND order_id = ? AND returned_qty + ? <= fulfilled_qty').run(q, w.itemId, orderId, q) : { changes: 0 };
    if (!res.changes) {
      for (const d of done) await db.prepare('UPDATE shop_order_items SET returned_qty = MAX(returned_qty - ?, 0) WHERE id = ?').run(d.quantity, d.itemId);
      throw new ShopError('invalid_return_quantity', 409);
    }
    done.push({ itemId: w.itemId, quantity: q });
  }
}

const returnInput = z.object({
  items: z.array(z.object({ itemId: z.string().max(80), quantity: z.number().int().min(1).max(999) })).min(1).max(100),
  reason: z.enum(RETURN_REASONS).default('other'),
  note: z.string().trim().max(500).default(''),
});

async function insertReturn(o: OrderRow, input: z.infer<typeof returnInput>, opts: { status: 'requested' | 'approved'; fromCustomer: boolean; by: string | null }): Promise<string> {
  await claimReturnUnits(o.id, input.items);
  const id = newId('ret');
  const ts = nowDb();
  await getDb()
    .prepare('INSERT INTO shop_returns (id, order_id, workspace_id, status, items, reason, note, from_customer, created_by, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)')
    .run(id, o.id, o.workspace_id, opts.status, JSON.stringify(input.items), input.reason, input.note, opts.fromCustomer ? 1 : 0, opts.by, ts, ts);
  await addOrderEvent(o, 'return', opts.fromCustomer ? `Return requested by the customer (${input.reason})` : `Return opened (${input.reason})`, opts.by);
  return id;
}

export async function createReturn(actor: ShopActor, orderId: string, raw: unknown): Promise<ReturnDto[]> {
  const parsed = returnInput.safeParse(raw);
  if (!parsed.success) throw new ShopError('invalid_input');
  const o = await getOrderRow(actor.ws, orderId);
  if (!o) throw new ShopError('not_found', 404);
  if (o.status !== 'fulfilled' && o.status !== 'paid') throw new ShopError('invalid_status', 409);
  await insertReturn(o, parsed.data, { status: 'approved', fromCustomer: false, by: actor.person });
  return orderReturns(actor.ws, orderId);
}

/** Pedido desde la página del pedido: dentro del plazo de la tienda y con las unidades ya enviadas. */
export async function requestReturnAsCustomer(store: StoreRow, o: OrderRow, raw: unknown): Promise<void> {
  const parsed = returnInput.safeParse(raw);
  if (!parsed.success) throw new ShopError('invalid_input');
  const settings = normalizeSettings(parseJson(store.settings, {}));
  if (settings.returnsDays <= 0 || !o.fulfilled_at) throw new ShopError('returns_closed', 409);
  const shipped = Date.parse(`${o.fulfilled_at.replace(' ', 'T')}Z`);
  if (Date.now() - shipped > settings.returnsDays * 86_400_000) throw new ShopError('returns_closed', 409);
  if (o.status !== 'fulfilled' && o.status !== 'paid') throw new ShopError('invalid_status', 409);
  const open = await getDb().prepare("SELECT 1 AS x FROM shop_returns WHERE order_id = ? AND status IN ('requested', 'approved') LIMIT 1").get(o.id);
  if (open) throw new ShopError('return_open', 409);
  const id = await insertReturn(o, parsed.data, { status: 'requested', fromCustomer: true, by: null });
  const { notifyStaff } = await import('./shop-effects');
  const { localized } = await import('./notification-copy');
  await notifyStaff(o.workspace_id, localized('orderReturnRequested', { number: o.number }), o.email, `/app/shop/orders/${o.id}`, id);
}

async function returnRow(ws: string, id: string): Promise<Record<string, unknown>> {
  const r = (await getDb().prepare('SELECT * FROM shop_returns WHERE id = ? AND workspace_id = ?').get(id, ws)) as Record<string, unknown> | undefined;
  if (!r) throw new ShopError('not_found', 404);
  return r;
}

export async function approveReturn(actor: ShopActor, id: string): Promise<void> {
  const r = await returnRow(actor.ws, id);
  const res = await getDb().prepare("UPDATE shop_returns SET status = 'approved', updated_at = ? WHERE id = ? AND status = 'requested'").run(nowDb(), id);
  if (!res.changes) throw new ShopError('invalid_status', 409);
  await addOrderEvent({ id: String(r.order_id), workspace_id: actor.ws }, 'return', 'Return approved', actor.person);
}

export async function declineReturn(actor: ShopActor, id: string): Promise<void> {
  const r = await returnRow(actor.ws, id);
  const res = await getDb().prepare("UPDATE shop_returns SET status = 'declined', updated_at = ? WHERE id = ? AND status IN ('requested', 'approved')").run(nowDb(), id);
  if (!res.changes) throw new ShopError('invalid_status', 409);
  for (const x of parseJson<Array<{ itemId: string; quantity: number }>>(r.items, [])) {
    await getDb().prepare('UPDATE shop_order_items SET returned_qty = MAX(returned_qty - ?, 0) WHERE id = ?').run(x.quantity, x.itemId);
  }
  await addOrderEvent({ id: String(r.order_id), workspace_id: actor.ws }, 'return', 'Return declined', actor.person);
}

/** Llegó la mercadería: repone lo que se pida y, si hace falta, reembolsa (solo admins). */
export async function receiveReturn(actor: ShopActor, id: string, input: { restock?: boolean; refundCents?: number }): Promise<OrderDto> {
  const r = await returnRow(actor.ws, id);
  const refund = Math.trunc(Number(input.refundCents) || 0);
  if (refund < 0) throw new ShopError('invalid_amount');
  if (refund > 0 && !actor.admin) throw new ShopError('forbidden', 403);
  const db = getDb();
  const orderId = String(r.order_id);
  const claim = await db.prepare("UPDATE shop_returns SET status = 'received', updated_at = ? WHERE id = ? AND status = 'approved'").run(nowDb(), id);
  if (!claim.changes) throw new ShopError('invalid_status', 409);
  if (refund > 0) {
    try {
      await refundOrder(actor, orderId, { amountCents: refund, restock: false, reason: 'Return' });
    } catch (err) {
      // El reembolso no salió: la devolución sigue abierta para reintentar.
      await db.prepare("UPDATE shop_returns SET status = 'approved' WHERE id = ?").run(id);
      throw err;
    }
  }
  const items = await orderItems(orderId);
  let restocked = false;
  if (input.restock) {
    for (const x of parseJson<Array<{ itemId: string; quantity: number }>>(r.items, [])) {
      const it = items.find((i) => i.id === x.itemId);
      if (!it?.variant_id || !it.track_inventory || !it.location_id) continue;
      const res = await db.prepare('UPDATE shop_inventory SET available = available + ? WHERE variant_id = ? AND location_id = ?').run(x.quantity, it.variant_id, it.location_id);
      if (!res.changes) continue;
      const after = (await db.prepare('SELECT available FROM shop_inventory WHERE variant_id = ? AND location_id = ?').get(it.variant_id, it.location_id)) as { available: number };
      await logInventory(actor.ws, it.variant_id, it.location_id, x.quantity, Number(after.available), 'returned', orderId, actor.person);
      restocked = true;
    }
  }
  await db.prepare('UPDATE shop_returns SET refund_cents = ?, restocked = ? WHERE id = ?').run(refund, restocked ? 1 : 0, id);
  await addOrderEvent({ id: orderId, workspace_id: actor.ws }, 'return', `Return received${restocked ? ', items back in stock' : ''}`, actor.person);
  const store = await ensureStore(actor.ws);
  await revalidateStore(store.handle);
  return (await getOrder(actor.ws, orderId))!;
}

// ---------- Transferencias ----------

/**
 * Mueve stock libre de una ubicación a otra en un paso: sale con
 * compare-and-set contra lo no reservado y entra en la otra, con historial.
 */
export async function transferStock(actor: ShopActor, input: { variantId: string; fromLocationId: string; toLocationId: string; quantity: number }): Promise<void> {
  const q = Math.trunc(Number(input.quantity) || 0);
  if (q < 1 || q > 1_000_000) throw new ShopError('invalid_input');
  if (input.fromLocationId === input.toLocationId) throw new ShopError('same_location');
  const db = getDb();
  const locs = (await db.prepare('SELECT id FROM shop_locations WHERE workspace_id = ? AND id IN (?, ?)').all(actor.ws, input.fromLocationId, input.toLocationId)) as Array<{ id: string }>;
  if (locs.length !== 2) throw new ShopError('not_found', 404);
  const out = await db
    .prepare('UPDATE shop_inventory SET available = available - ? WHERE variant_id = ? AND location_id = ? AND workspace_id = ? AND available - reserved >= ?')
    .run(q, input.variantId, input.fromLocationId, actor.ws, q);
  if (!out.changes) throw new ShopError('out_of_stock', 409);
  await db.prepare('INSERT OR IGNORE INTO shop_inventory (variant_id, location_id, workspace_id, available, reserved) VALUES (?, ?, ?, 0, 0)').run(input.variantId, input.toLocationId, actor.ws);
  await db.prepare('UPDATE shop_inventory SET available = available + ? WHERE variant_id = ? AND location_id = ?').run(q, input.variantId, input.toLocationId);
  const level = async (loc: string) => Number(((await db.prepare('SELECT available FROM shop_inventory WHERE variant_id = ? AND location_id = ?').get(input.variantId, loc)) as { available: number }).available);
  await logInventory(actor.ws, input.variantId, input.fromLocationId, -q, await level(input.fromLocationId), 'transfer', null, actor.person);
  await logInventory(actor.ws, input.variantId, input.toLocationId, q, await level(input.toLocationId), 'transfer', null, actor.person);
  const store = await getStore(actor.ws);
  if (store) await revalidateStore(store.handle);
}

// ---------- Órdenes de compra ----------

export interface PurchaseOrderDto {
  id: string;
  number: number;
  supplier: string;
  locationId: string;
  locationName: string;
  status: 'ordered' | 'partial' | 'received' | 'cancelled';
  note: string;
  expectedAt: string | null;
  createdAt: string;
  items: Array<{ id: string; variantId: string; title: string; quantity: number; received: number; unitCostCents: number }>;
}

const poInput = z.object({
  supplier: z.string().trim().min(1).max(120),
  locationId: z.string().max(80).optional(),
  note: z.string().trim().max(1000).default(''),
  expectedAt: z.string().max(10).nullable().default(null),
  items: z.array(z.object({ variantId: z.string().min(1).max(80), quantity: z.number().int().min(1).max(1_000_000), unitCostCents: z.number().int().min(0).max(1_000_000_000).default(0) })).min(1).max(200),
});

export async function listPurchaseOrders(ws: string, opts: { q?: string } = {}): Promise<PurchaseOrderDto[]> {
  const db = getDb();
  const q = opts.q?.trim();
  const like = q ? `%${q.replace(/[\\%_]/g, (m) => `\\${m}`)}%` : null;
  const rows = (await db
    .prepare(`SELECT po.*, l.name AS location_name FROM shop_purchase_orders po LEFT JOIN shop_locations l ON l.id = po.location_id WHERE po.workspace_id = ? ${like ? "AND po.supplier LIKE ? ESCAPE '\\'" : ''} ORDER BY po.created_at DESC LIMIT 200`)
    .all(...(like ? [ws, like] : [ws]))) as Array<Record<string, unknown>>;
  if (!rows.length) return [];
  const items = (await db
    .prepare(
      `SELECT i.*, p.title AS ptitle, v.title AS vtitle FROM shop_purchase_order_items i LEFT JOIN shop_variants v ON v.id = i.variant_id LEFT JOIN shop_products p ON p.id = v.product_id
       WHERE i.po_id IN (${rows.map(() => '?').join(',')}) ORDER BY i.rowid ASC`,
    )
    .all(...rows.map((r) => String(r.id)))) as Array<Record<string, unknown>>;
  return rows.map((r) => ({
    id: String(r.id),
    number: Number(r.number),
    supplier: String(r.supplier),
    locationId: String(r.location_id),
    locationName: String(r.location_name ?? ''),
    status: r.status as PurchaseOrderDto['status'],
    note: String(r.note ?? ''),
    expectedAt: (r.expected_at as string | null) ?? null,
    createdAt: String(r.created_at),
    items: items
      .filter((i) => i.po_id === r.id)
      .map((i) => ({
        id: String(i.id),
        variantId: String(i.variant_id),
        title: `${String(i.ptitle ?? '')}${i.vtitle && i.vtitle !== 'Default' ? ` (${String(i.vtitle)})` : ''}`,
        quantity: Number(i.quantity),
        received: Number(i.received),
        unitCostCents: Number(i.unit_cost_cents),
      })),
  }));
}

export async function getPurchaseOrder(ws: string, id: string): Promise<PurchaseOrderDto | null> {
  return (await listPurchaseOrders(ws)).find((p) => p.id === id) ?? null;
}

export async function createPurchaseOrder(actor: ShopActor, raw: unknown): Promise<PurchaseOrderDto> {
  const parsed = poInput.safeParse(raw);
  if (!parsed.success) throw new ShopError('invalid_input');
  const input = parsed.data;
  const db = getDb();
  await ensureStore(actor.ws);
  const location = input.locationId || (await defaultLocation(actor.ws));
  if (!(await db.prepare('SELECT 1 AS x FROM shop_locations WHERE id = ? AND workspace_id = ?').get(location, actor.ws))) throw new ShopError('not_found', 404);
  for (const it of input.items) {
    if (!(await db.prepare('SELECT 1 AS x FROM shop_variants WHERE id = ? AND workspace_id = ?').get(it.variantId, actor.ws))) throw new ShopError('cart_changed', 409);
  }
  const last = (await db.prepare('SELECT COALESCE(MAX(number), 0) AS n FROM shop_purchase_orders WHERE workspace_id = ?').get(actor.ws)) as { n: number };
  const id = newId('po');
  const ts = nowDb();
  await db
    .prepare('INSERT INTO shop_purchase_orders (id, workspace_id, number, supplier, location_id, note, expected_at, created_by, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)')
    .run(id, actor.ws, Number(last.n) + 1, input.supplier, location, input.note, input.expectedAt, actor.person, ts, ts);
  for (const it of input.items) {
    await db.prepare('INSERT INTO shop_purchase_order_items (id, po_id, workspace_id, variant_id, quantity, unit_cost_cents) VALUES (?, ?, ?, ?, ?, ?)').run(newId('poi'), id, actor.ws, it.variantId, it.quantity, it.unitCostCents);
  }
  return (await getPurchaseOrder(actor.ws, id))!;
}

/** Recibe mercadería: cada línea con compare-and-set contra lo pedido; suma al stock con historial. */
export async function receivePurchaseOrder(actor: ShopActor, id: string, lines: Array<{ itemId: string; quantity: number }>): Promise<PurchaseOrderDto> {
  const db = getDb();
  const po = await getPurchaseOrder(actor.ws, id);
  if (!po) throw new ShopError('not_found', 404);
  if (po.status === 'received' || po.status === 'cancelled') throw new ShopError('invalid_status', 409);
  let moved = 0;
  for (const l of lines.slice(0, 200)) {
    const q = Math.trunc(Number(l.quantity) || 0);
    if (q < 1) continue;
    const item = po.items.find((i) => i.id === l.itemId);
    if (!item) continue;
    const res = await db.prepare('UPDATE shop_purchase_order_items SET received = received + ? WHERE id = ? AND po_id = ? AND received + ? <= quantity').run(q, item.id, id, q);
    if (!res.changes) throw new ShopError('invalid_return_quantity', 409);
    await db.prepare('INSERT OR IGNORE INTO shop_inventory (variant_id, location_id, workspace_id, available, reserved) VALUES (?, ?, ?, 0, 0)').run(item.variantId, po.locationId, actor.ws);
    await db.prepare('UPDATE shop_inventory SET available = available + ? WHERE variant_id = ? AND location_id = ?').run(q, item.variantId, po.locationId);
    const after = (await db.prepare('SELECT available FROM shop_inventory WHERE variant_id = ? AND location_id = ?').get(item.variantId, po.locationId)) as { available: number };
    await logInventory(actor.ws, item.variantId, po.locationId, q, Number(after.available), 'received', id, actor.person);
    moved += q;
  }
  if (!moved) throw new ShopError('invalid_input');
  const next = (await getPurchaseOrder(actor.ws, id))!;
  const complete = next.items.every((i) => i.received >= i.quantity);
  await db.prepare('UPDATE shop_purchase_orders SET status = ?, updated_at = ? WHERE id = ?').run(complete ? 'received' : 'partial', nowDb(), id);
  const store = await getStore(actor.ws);
  if (store) await revalidateStore(store.handle);
  return (await getPurchaseOrder(actor.ws, id))!;
}

export async function cancelPurchaseOrder(actor: ShopActor, id: string): Promise<void> {
  const res = await getDb().prepare("UPDATE shop_purchase_orders SET status = 'cancelled', updated_at = ? WHERE id = ? AND workspace_id = ? AND status IN ('ordered', 'partial')").run(nowDb(), id, actor.ws);
  if (!res.changes) throw new ShopError('invalid_status', 409);
}
