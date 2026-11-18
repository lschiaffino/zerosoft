/**
 * Shop: carrito, checkout y pedidos. Server-only.
 *
 * Precios y totales siempre del servidor: el carrito solo manda variante y
 * cantidad. Al crear el pedido se reserva el stock (compare-and-set) y se
 * reclama un uso del código; al pagar (webhook verificado o "marcar pagado")
 * el pedido pasa de pending a paid con compare-and-set y recién ahí se
 * descuenta el stock. Un pedido online sin pagar vence (cron) y libera todo.
 */
import { localized } from './notification-copy';
import { randomBytes } from 'crypto';
import { getDb } from './db';
import {
  checkLowStock,
  claimDiscountUse,
  commitStock,
  discountEligibleProducts,
  ensureStore,
  findDiscountByCode,
  getDiscount,
  getStore,
  listAutomaticDiscounts,
  listShippingRates,
  listTaxRates,
  newId,
  nowDb,
  releaseDiscountUse,
  releaseReservation,
  reserveStock,
  restock,
  revalidateStore,
  upsertCustomer,
  type StockItem,
  type StoreRow,
} from './shop';
import { computeTotals, discountError, discountLineError, lineDiscountAmount, type MoneyLine, type Totals } from './shop-money';
import { ShopError, checkoutSchema, normalizeSettings, parseJson, type OrderStatus, type ShippingAddress, type ShopActor } from './shop-schema';

// ---------- Carrito ----------

export interface PricedLine {
  variantId: string;
  productId: string;
  productHandle: string;
  title: string;
  variantTitle: string;
  sku: string;
  imageUrl: string | null;
  unitCents: number;
  compareAtCents: number | null;
  quantity: number;
  totalCents: number;
  weightGrams: number;
  trackInventory: boolean;
  requiresShipping: boolean;
  /** Disponible para vender ahora (null = no lleva stock). */
  stock: number | null;
  /** La cantidad pedida supera lo disponible. */
  short: boolean;
  /** La variante se sigue vendiendo sin stock. */
  continueSelling: boolean;
  /** Esta línea sale de lo que todavía no hay (se avisa en el carrito). */
  backorder: boolean;
}

export interface PricedCart {
  lines: PricedLine[];
  /** Variantes que ya no se venden (borradas o en borrador). */
  removed: string[];
  totals: Totals;
  /** El código escrito y si se pudo usar. */
  discount: { code: string; kind: string; error: string | null } | null;
  /** El descuento que quedó aplicado (código o automático). */
  applied: { id: string; label: string; kind: string; automatic: boolean; oncePerCustomer: boolean } | null;
  currency: string;
}

/**
 * Precio del carrito con lo que dice la base: precio de cada variante,
 * stock libre, envío, impuesto y descuento. Las líneas repetidas se suman.
 */
export async function priceCart(
  store: StoreRow,
  raw: { lines: Array<{ variantId: string; quantity: number }>; address?: { country: string; region?: string } | null; shippingRateId?: string | null; discountCode?: string | null; paymentMethod?: string | null },
): Promise<PricedCart> {
  const ws = store.workspace_id;
  const merged = new Map<string, number>();
  for (const l of raw.lines.slice(0, 100)) {
    const q = Math.max(0, Math.min(999, Math.trunc(Number(l.quantity) || 0)));
    if (q > 0 && typeof l.variantId === 'string' && l.variantId.length <= 80) merged.set(l.variantId, Math.min(999, (merged.get(l.variantId) ?? 0) + q));
  }
  const ids = [...merged.keys()];
  const db = getDb();
  const rows = ids.length
    ? ((await db
        .prepare(
          `SELECT v.id, v.title AS vtitle, v.sku, v.price_cents, v.compare_at_cents, v.weight_grams, v.track_inventory, v.continue_selling, v.image_url, v.options,
             p.id AS pid, p.handle, p.title, p.images, p.requires_shipping,
             (SELECT COALESCE(MAX(MAX(i.available - i.reserved, 0)), 0) FROM shop_inventory i WHERE i.variant_id = v.id) AS free
           FROM shop_variants v JOIN shop_products p ON p.id = v.product_id
           WHERE v.workspace_id = ? AND p.status = 'active' AND v.id IN (${ids.map(() => '?').join(',')})`,
        )
        .all(ws, ...ids)) as Array<Record<string, unknown>>)
    : [];
  const lines: PricedLine[] = [];
  const removed: string[] = [];
  for (const id of ids) {
    const r = rows.find((x) => x.id === id);
    if (!r) {
      removed.push(id);
      continue;
    }
    const quantity = merged.get(id)!;
    const track = Number(r.track_inventory) === 1;
    const free = track ? Number(r.free) : null;
    const keepSelling = track && Number(r.continue_selling ?? 0) === 1;
    const stock = keepSelling ? null : free;
    const opts = parseJson<string[]>(r.options, []);
    lines.push({
      variantId: id,
      productId: String(r.pid),
      productHandle: String(r.handle),
      title: String(r.title),
      variantTitle: opts.length ? String(r.vtitle) : '',
      sku: String(r.sku ?? ''),
      imageUrl: (r.image_url as string | null) || parseJson<string[]>(r.images, [])[0] || null,
      unitCents: Number(r.price_cents),
      compareAtCents: r.compare_at_cents == null ? null : Number(r.compare_at_cents),
      quantity,
      totalCents: Number(r.price_cents) * quantity,
      weightGrams: Number(r.weight_grams ?? 0),
      trackInventory: track,
      requiresShipping: Number(r.requires_shipping) === 1,
      stock,
      short: stock != null && quantity > stock,
      continueSelling: keepSelling,
      backorder: keepSelling && free != null && quantity > free,
    });
  }
  const [rates, taxes] = await Promise.all([listShippingRates(ws), listTaxRates(ws)]);
  const subtotal = lines.reduce((s, l) => s + l.totalCents, 0);
  const moneyLines: MoneyLine[] = lines.map((l) => ({ unitCents: l.unitCents, quantity: l.quantity, weightGrams: l.weightGrams, requiresShipping: l.requiresShipping, productId: l.productId }));
  let discount: PricedCart['discount'] = null;
  // Un solo descuento por pedido: el código si lo escribieron y sirve, salvo que un automático ahorre más.
  type Candidate = { rule: Awaited<ReturnType<typeof listAutomaticDiscounts>>[number]; amount: number };
  let best: Candidate | null = null;
  if (raw.discountCode?.trim()) {
    const d = await findDiscountByCode(ws, raw.discountCode);
    let error: string | null = discountError(d, subtotal);
    // Un descuento automático no se usa escribiendo su nombre interno.
    if (!error && d?.method === 'automatic') error = 'discount_invalid';
    if (!error && d) {
      const eligible = await discountEligibleProducts(ws, d);
      error = discountLineError(d, moneyLines, eligible);
      if (!error) best = { rule: d, amount: lineDiscountAmount(d, moneyLines, eligible) };
    }
    discount = { code: raw.discountCode.trim().toUpperCase(), kind: d?.kind ?? '', error };
  }
  if (lines.length) {
    for (const d of await listAutomaticDiscounts(ws)) {
      if (discountError(d, subtotal)) continue;
      const eligible = await discountEligibleProducts(ws, d);
      if (discountLineError(d, moneyLines, eligible)) continue;
      const amount = lineDiscountAmount(d, moneyLines, eligible);
      const beats = !best || amount > best.amount;
      if (beats && (amount > 0 || (d.kind === 'free_shipping' && !best))) {
        if (best && discount && !discount.error) discount = { ...discount, error: 'discount_auto_better' };
        best = { rule: d, amount };
      }
    }
  }
  const settings = normalizeSettings(parseJson(store.settings, {}));
  const method = raw.paymentMethod as keyof typeof settings.paymentDiscounts | null | undefined;
  const totals = computeTotals({
    lines: moneyLines,
    discount: best?.rule ?? null,
    discountCentsOverride: best ? (best.rule.kind === 'free_shipping' ? 0 : best.amount) : undefined,
    paymentDiscountBps: method && method in settings.paymentDiscounts ? settings.paymentDiscounts[method] : 0,
    shippingRates: rates,
    shippingRateId: raw.shippingRateId ?? null,
    address: raw.address ?? null,
    taxRates: taxes,
    taxIncluded: store.tax_included === 1,
    currency: store.currency,
  });
  const applied = best
    ? { id: best.rule.id, label: best.rule.method === 'automatic' ? best.rule.title || best.rule.code : best.rule.code, kind: best.rule.kind, automatic: best.rule.method === 'automatic', oncePerCustomer: best.rule.oncePerCustomer === true }
    : null;
  return { lines, removed, totals, discount, applied, currency: store.currency };
}

// ---------- Pedidos ----------

export interface OrderRow {
  id: string;
  workspace_id: string;
  number: number;
  status: OrderStatus;
  email: string;
  customer_id: string | null;
  name: string;
  phone: string;
  currency: string;
  subtotal_cents: number;
  discount_cents: number;
  shipping_cents: number;
  tax_cents: number;
  total_cents: number;
  tax_included: number;
  discount_code: string | null;
  discount_id: string | null;
  shipping_name: string | null;
  shipping_address: string;
  payment_method: 'stripe' | 'mercadopago' | 'manual';
  tax_id: string;
  source: string;
  pickup: number;
  payment_discount_cents: number;
  payment_ref: string | null;
  payment_id: string | null;
  paid_at: string | null;
  fulfilled_at: string | null;
  cancelled_at: string | null;
  refunded_at: string | null;
  refunded_cents: number;
  tracking_number: string | null;
  tracking_company: string | null;
  tracking_url: string | null;
  customer_note: string;
  stock_state: 'none' | 'reserved' | 'committed' | 'released' | 'oversold' | 'restocked';
  status_token: string;
  locale: string;
  expires_at: string | null;
  cancel_reason: string | null;
  created_at: string;
  updated_at: string;
}

export interface OrderItemRow extends StockItem {
  id: string;
  order_id: string;
  product_id: string | null;
  title: string;
  variant_title: string;
  sku: string;
  unit_cents: number;
  total_cents: number;
  weight_grams: number;
  image_url: string | null;
  fulfilled_qty: number;
  returned_qty: number;
}

export interface OrderEventDto {
  id: string;
  kind: string;
  message: string;
  actor: string | null;
  createdAt: string;
}

export interface OrderDto {
  id: string;
  number: number;
  status: OrderStatus;
  email: string;
  name: string;
  phone: string;
  customerId: string | null;
  currency: string;
  subtotalCents: number;
  discountCents: number;
  shippingCents: number;
  taxCents: number;
  totalCents: number;
  taxIncluded: boolean;
  discountCode: string | null;
  shippingName: string | null;
  shippingAddress: ShippingAddress | null;
  paymentMethod: string;
  paidAt: string | null;
  fulfilledAt: string | null;
  cancelledAt: string | null;
  refundedAt: string | null;
  refundedCents: number;
  tracking: { number: string | null; company: string | null; url: string | null };
  note: string;
  stockState: string;
  cancelReason: string | null;
  createdAt: string;
  taxId: string;
  source: string;
  pickup: boolean;
  paymentDiscountCents: number;
  /** none, partial o full: lo que salió de cada línea. */
  fulfillment: 'none' | 'partial' | 'full';
  items: Array<{ id: string; productId: string | null; variantId: string | null; title: string; variantTitle: string; sku: string; quantity: number; unitCents: number; totalCents: number; imageUrl: string | null; fulfilledQty: number; returnedQty: number; backorder: boolean }>;
  events?: OrderEventDto[];
}

export function orderDto(o: OrderRow, items: OrderItemRow[], events?: OrderEventDto[]): OrderDto {
  const addr = parseJson<ShippingAddress | Record<string, never>>(o.shipping_address, {});
  return {
    id: o.id,
    number: o.number,
    status: o.status,
    email: o.email,
    name: o.name,
    phone: o.phone,
    customerId: o.customer_id,
    currency: o.currency,
    subtotalCents: o.subtotal_cents,
    discountCents: o.discount_cents,
    shippingCents: o.shipping_cents,
    taxCents: o.tax_cents,
    totalCents: o.total_cents,
    taxIncluded: o.tax_included === 1,
    discountCode: o.discount_code,
    shippingName: o.shipping_name,
    shippingAddress: 'line1' in addr ? (addr as ShippingAddress) : null,
    paymentMethod: o.payment_method,
    paidAt: o.paid_at,
    fulfilledAt: o.fulfilled_at,
    cancelledAt: o.cancelled_at,
    refundedAt: o.refunded_at,
    refundedCents: o.refunded_cents,
    tracking: { number: o.tracking_number, company: o.tracking_company, url: o.tracking_url },
    note: o.customer_note,
    stockState: o.stock_state,
    cancelReason: o.cancel_reason,
    createdAt: o.created_at,
    taxId: o.tax_id ?? '',
    source: o.source ?? 'online',
    pickup: o.pickup === 1,
    paymentDiscountCents: o.payment_discount_cents ?? 0,
    fulfillment: fulfillmentState(o, items),
    items: items.map((i) => ({
      id: i.id,
      productId: i.product_id,
      variantId: i.variant_id,
      title: i.title,
      variantTitle: i.variant_title,
      sku: i.sku,
      quantity: i.quantity,
      unitCents: i.unit_cents,
      totalCents: i.total_cents,
      imageUrl: i.image_url,
      fulfilledQty: Number(i.fulfilled_qty ?? 0),
      returnedQty: Number(i.returned_qty ?? 0),
      backorder: Number(i.backorder ?? 0) === 1,
    })),
    ...(events ? { events } : {}),
  };
}

/** Un pedido enviado de antes de los envíos parciales no tiene cantidades por línea. */
function fulfillmentState(o: Pick<OrderRow, 'status' | 'fulfilled_at'>, items: OrderItemRow[]): 'none' | 'partial' | 'full' {
  const total = items.reduce((s, i) => s + i.quantity, 0);
  const done = items.reduce((s, i) => s + Number(i.fulfilled_qty ?? 0), 0);
  if (o.status === 'fulfilled' || (total > 0 && done >= total)) return 'full';
  return done > 0 ? 'partial' : 'none';
}

export async function getOrderRow(ws: string, id: string): Promise<OrderRow | null> {
  return ((await getDb().prepare('SELECT * FROM shop_orders WHERE id = ? AND workspace_id = ?').get(id, ws)) as OrderRow | undefined) ?? null;
}

export async function orderItems(orderId: string): Promise<OrderItemRow[]> {
  return (await getDb().prepare('SELECT * FROM shop_order_items WHERE order_id = ? ORDER BY rowid ASC').all(orderId)) as OrderItemRow[];
}

export async function orderEvents(orderId: string): Promise<OrderEventDto[]> {
  const rows = (await getDb().prepare('SELECT * FROM shop_order_events WHERE order_id = ? ORDER BY created_at ASC, rowid ASC').all(orderId)) as Array<Record<string, unknown>>;
  return rows.map((r) => ({ id: String(r.id), kind: String(r.kind), message: String(r.message ?? ''), actor: (r.actor as string | null) ?? null, createdAt: String(r.created_at) }));
}

export async function getOrder(ws: string, id: string): Promise<OrderDto | null> {
  const o = await getOrderRow(ws, id);
  if (!o) return null;
  const [items, events] = await Promise.all([orderItems(o.id), orderEvents(o.id)]);
  return orderDto(o, items, events);
}

export async function addOrderEvent(o: Pick<OrderRow, 'id' | 'workspace_id'>, kind: string, message: string, actor: string | null = null): Promise<void> {
  await getDb()
    .prepare('INSERT INTO shop_order_events (id, order_id, workspace_id, kind, message, actor, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)')
    .run(newId('oev'), o.id, o.workspace_id, kind, message.slice(0, 2000), actor, nowDb());
}

export interface OrderListItem {
  id: string;
  number: number;
  status: OrderStatus;
  email: string;
  name: string;
  totalCents: number;
  currency: string;
  paymentMethod: string;
  items: number;
  createdAt: string;
}

export async function listOrders(
  ws: string,
  opts: { q?: string; status?: string; customerId?: string; limit?: number; offset?: number } = {},
): Promise<{ items: OrderListItem[]; total: number }> {
  const where = ['o.workspace_id = ?'];
  const args: Array<string | number> = [ws];
  const q = opts.q?.trim();
  if (q) {
    const num = /^#?(\d{1,9})$/.exec(q)?.[1];
    const l = `%${q.replace(/[\\%_]/g, (m) => `\\${m}`)}%`;
    where.push(`(${num ? 'o.number = ? OR ' : ''}o.email LIKE ? ESCAPE '\\' OR o.name LIKE ? ESCAPE '\\')`);
    if (num) args.push(Number(num));
    args.push(l, l);
  }
  if (opts.status && ['draft', 'pending', 'paid', 'fulfilled', 'cancelled', 'refunded'].includes(opts.status)) {
    where.push('o.status = ?');
    args.push(opts.status);
  } else {
    // Un borrador todavía no es un pedido: solo se ve en su pestaña.
    where.push("o.status != 'draft'");
  }
  if (opts.customerId) {
    where.push('o.customer_id = ?');
    args.push(opts.customerId);
  }
  const db = getDb();
  const limit = Math.min(500, Math.max(1, opts.limit ?? 100));
  const [rows, count] = await Promise.all([
    db
      .prepare(
        `SELECT o.id, o.number, o.status, o.email, o.name, o.total_cents, o.currency, o.payment_method, o.created_at,
           (SELECT COALESCE(SUM(quantity), 0) FROM shop_order_items i WHERE i.order_id = o.id) AS items
         FROM shop_orders o WHERE ${where.join(' AND ')} ORDER BY o.created_at DESC, o.number DESC LIMIT ? OFFSET ?`,
      )
      .all(...args, limit, Math.max(0, opts.offset ?? 0)) as Promise<Array<Record<string, unknown>>>,
    db.prepare(`SELECT COUNT(*) AS n FROM shop_orders o WHERE ${where.join(' AND ')}`).get(...args) as Promise<{ n: number }>,
  ]);
  return {
    total: Number(count?.n ?? 0),
    items: rows.map((r) => ({
      id: String(r.id),
      number: Number(r.number),
      status: r.status as OrderStatus,
      email: String(r.email),
      name: String(r.name ?? ''),
      totalCents: Number(r.total_cents),
      currency: String(r.currency),
      paymentMethod: String(r.payment_method),
      items: Number(r.items ?? 0),
      createdAt: String(r.created_at),
    })),
  };
}

async function nextOrderNumber(ws: string): Promise<number> {
  const row = (await getDb()
    .prepare('UPDATE shop_stores SET next_number = next_number + 1 WHERE workspace_id = ? RETURNING next_number - 1 AS n')
    .get(ws)) as { n: number } | undefined;
  if (!row) throw new ShopError('store_not_found', 404);
  return Number(row.n);
}

export interface CheckoutResult {
  order: OrderDto;
  statusToken: string;
  /** A dónde mandar al cliente: la página de pago del proveedor o la del pedido. */
  redirectUrl: string;
}

/**
 * Crea el pedido de un checkout: valida, precia en el servidor, reserva stock,
 * reclama el uso del código y abre el cobro del método elegido.
 */
export async function createCheckoutOrder(store: StoreRow, raw: unknown, opts: { origin: string }): Promise<CheckoutResult> {
  const parsed = checkoutSchema.safeParse(raw);
  if (!parsed.success) throw new ShopError('invalid_input', 400, { issues: parsed.error.issues.slice(0, 5).map((i) => i.path.join('.')) });
  const input = parsed.data;
  if (input.website) throw new ShopError('invalid_input');
  if (store.published !== 1) throw new ShopError('store_closed', 404);
  const { enabledMethods } = await import('./shop');
  if (!enabledMethods(store).includes(input.paymentMethod)) throw new ShopError('payment_unavailable', 409);
  const ws = store.workspace_id;
  const cart = await priceCart(store, { lines: input.lines, address: input.address ?? null, shippingRateId: input.shippingRateId, discountCode: input.discountCode, paymentMethod: input.paymentMethod });
  if (cart.removed.length) throw new ShopError('cart_changed', 409, { removed: cart.removed });
  if (!cart.lines.length) throw new ShopError('empty_cart');
  const short = cart.lines.filter((l) => l.short);
  if (short.length) throw new ShopError('out_of_stock', 409, { variantId: short[0].variantId });
  if (cart.discount?.error && cart.discount.error !== 'discount_auto_better') throw new ShopError(cart.discount.error, 409);
  const needsShipping = cart.totals.needsShipping;
  if (cart.totals.needsAddress && !input.address) throw new ShopError('address_required');
  if (needsShipping && !cart.totals.shipping) throw new ShopError('no_shipping_rate', 409);
  const isPickup = cart.totals.shipping?.pickup === true;
  if (isPickup && !input.contactName && !input.address?.name) throw new ShopError('invalid_input', 400, { issues: ['contactName'] });
  if (cart.totals.totalCents <= 0 && input.paymentMethod !== 'manual') throw new ShopError('invalid_total');

  // Uso del código: compare-and-set contra el tope antes de reservar.
  const discount = cart.applied ? await getDiscount(ws, cart.applied.id) : null;
  // Una vez por cliente: cuenta cualquier pedido no cancelado con este descuento.
  if (discount?.oncePerCustomer) {
    const used = await getDb().prepare("SELECT 1 AS x FROM shop_orders WHERE workspace_id = ? AND email = ? AND discount_id = ? AND status NOT IN ('cancelled', 'draft') LIMIT 1").get(ws, input.email, discount.id);
    if (used) throw new ShopError('discount_once', 409);
  }
  if (discount && !(await claimDiscountUse(discount.id))) throw new ShopError('discount_used_up', 409);

  let locations: Array<string | null>;
  try {
    locations = await reserveStock(
      ws,
      cart.lines.map((l) => ({ variantId: l.variantId, quantity: l.quantity, track: l.trackInventory, continueSelling: l.continueSelling })),
    );
  } catch (err) {
    if (discount) await releaseDiscountUse(discount.id);
    throw err;
  }

  const settings = normalizeSettings(parseJson(store.settings, {}));
  const id = newId('ord');
  const statusToken = randomBytes(18).toString('base64url');
  const number = await nextOrderNumber(ws);
  const ts = new Date();
  const name = input.address?.name || input.contactName;
  const phone = input.address?.phone || input.contactPhone;
  const customerId = await upsertCustomer(ws, { email: input.email, name, phone });
  // El pedido por transferencia espera al comercio (no vence solo); el online vence.
  const hold = input.paymentMethod === 'stripe' ? Math.min(23 * 60, Math.max(31, settings.holdMinutes)) : settings.holdMinutes;
  const expires = input.paymentMethod === 'manual' ? null : nowDb(new Date(ts.getTime() + hold * 60_000));
  const db = getDb();
  await db
    .prepare(
      `INSERT INTO shop_orders (id, workspace_id, number, status, email, customer_id, name, phone, currency, subtotal_cents, discount_cents, shipping_cents, tax_cents, total_cents,
         tax_included, discount_code, discount_id, shipping_name, shipping_address, payment_method, customer_note, stock_state, status_token, locale, expires_at, created_at, updated_at, tax_id, pickup, payment_discount_cents)
       VALUES (?, ?, ?, 'pending', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'reserved', ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(
      id,
      ws,
      number,
      input.email,
      customerId,
      name,
      phone,
      store.currency,
      cart.totals.subtotalCents,
      cart.totals.discountCents,
      cart.totals.shippingCents,
      cart.totals.taxCents,
      cart.totals.totalCents,
      cart.totals.taxIncluded ? 1 : 0,
      cart.applied?.label ?? null,
      discount?.id ?? null,
      cart.totals.shipping?.name ?? null,
      JSON.stringify(isPickup ? {} : (input.address ?? {})),
      input.paymentMethod,
      input.note.trim(),
      statusToken,
      store.locale,
      expires,
      nowDb(ts),
      nowDb(ts),
      settings.askTaxId ? input.taxId : '',
      isPickup ? 1 : 0,
      cart.totals.paymentDiscountCents,
    );
  for (const [i, l] of cart.lines.entries()) {
    await db
      .prepare(
        `INSERT INTO shop_order_items (id, order_id, workspace_id, product_id, variant_id, location_id, title, variant_title, sku, quantity, unit_cents, total_cents, weight_grams, image_url, track_inventory, backorder)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(newId('oit'), id, ws, l.productId, l.variantId, locations[i], l.title, l.variantTitle, l.sku, l.quantity, l.unitCents, l.totalCents, l.weightGrams, l.imageUrl, l.trackInventory ? 1 : 0, l.continueSelling ? 1 : 0);
  }
  await addOrderEvent({ id, workspace_id: ws }, 'created', `Order placed (${input.paymentMethod})`);
  await getDb()
    .prepare(`INSERT INTO shop_stats (workspace_id, day, views, checkouts) VALUES (?, ?, 0, 1) ON CONFLICT (workspace_id, day) DO UPDATE SET checkouts = checkouts + 1`)
    .run(ws, nowDb(ts).slice(0, 10));

  const row = (await getOrderRow(ws, id))!;
  const items = await orderItems(id);
  // Disponible − reservado bajó: puede cruzar el umbral de stock bajo.
  void checkLowStock(ws, items.filter((i) => i.track_inventory).map((i) => i.variant_id!).filter(Boolean));
  const { startPayment } = await import('./shop-payments');
  let redirectUrl: string;
  try {
    redirectUrl = await startPayment(store, row, items, opts.origin);
  } catch (err) {
    // Sin cobro no hay pedido: se cancela y se libera todo.
    await cancelOrderRow(row, { reason: 'payment_error', actor: null, restock: false }).catch(() => undefined);
    throw err;
  }
  const { onOrderCreated } = await import('./shop-effects');
  await onOrderCreated(store, row, items);
  // Si había un checkout a medias con este email, ya no hace falta el recordatorio.
  await import('./shop-abandoned').then((m) => m.markCheckoutRecovered(ws, input.email, id)).catch(() => undefined);
  return { order: orderDto((await getOrderRow(ws, id))!, items), statusToken, redirectUrl };
}

/**
 * Marca pagado (webhook, regreso del checkout o "marcar pagado" a mano).
 * Compare-and-set: solo desde pending (o cancelado por vencimiento, si el
 * pago llegó tarde). true si esta llamada lo marcó.
 */
export async function markOrderPaid(
  ws: string,
  orderId: string,
  opts: { paymentId?: string | null; actor?: string | null; source: string },
): Promise<boolean | 'after_cancel'> {
  const db = getDb();
  const ts = nowDb();
  const res = await db
    .prepare(
      `UPDATE shop_orders SET status = 'paid', paid_at = ?, payment_id = COALESCE(?, payment_id), expires_at = NULL, cancelled_at = NULL, cancel_reason = NULL, updated_at = ?
       WHERE id = ? AND workspace_id = ? AND (status = 'pending' OR (status = 'cancelled' AND cancel_reason = 'expired'))`,
    )
    .run(ts, opts.paymentId ?? null, ts, orderId, ws);
  if (!res.changes) return recordPaymentAfterCancel(ws, orderId, opts);
  const order = (await getOrderRow(ws, orderId))!;
  const items = await orderItems(orderId);
  // Stock: de la reserva si seguía; si se había liberado (vencido), de lo libre.
  const prev = order.stock_state;
  const claimed = await db
    .prepare("UPDATE shop_orders SET stock_state = 'committed' WHERE id = ? AND stock_state = ?")
    .run(orderId, prev);
  if (claimed.changes && (prev === 'reserved' || prev === 'released')) {
    const failed = await commitStock(ws, orderId, items, prev === 'reserved', opts.actor ?? null);
    if (failed.length) {
      await db.prepare("UPDATE shop_orders SET stock_state = 'oversold' WHERE id = ?").run(orderId);
      await addOrderEvent(order, 'stock', `Not enough stock for ${failed.length} item(s): paid after the hold expired. Refund or restock.`);
    }
  }
  // Pedido vencido que se pagó: el vencimiento había devuelto el uso del código; se vuelve a contar (aunque pase el tope: el pago ya entró).
  if (order.discount_id && prev === 'released' && claimed.changes) await forceDiscountUse(order.discount_id);
  await addOrderEvent(order, 'paid', `Payment received (${opts.source})`, opts.actor ?? null);
  await db
    .prepare('UPDATE shop_customers SET orders_count = orders_count + 1, total_spent_cents = total_spent_cents + ?, updated_at = ? WHERE id = ?')
    .run(order.total_cents, ts, order.customer_id ?? '');
  const store = await getStore(ws);
  if (store) {
    await revalidateStore(store.handle);
    const { onOrderPaid } = await import('./shop-effects');
    await onOrderPaid(store, (await getOrderRow(ws, orderId))!, items);
  }
  await checkLowStock(ws, items.filter((i) => i.track_inventory && i.variant_id).map((i) => i.variant_id!));
  return true;
}

export async function markPaidManually(actor: ShopActor, orderId: string): Promise<OrderDto> {
  const o = await getOrderRow(actor.ws, orderId);
  if (!o) throw new ShopError('not_found', 404);
  if (o.status !== 'pending') throw new ShopError('invalid_status', 409);
  await markOrderPaid(actor.ws, orderId, { actor: actor.person, source: o.payment_method === 'manual' ? 'manual' : `${o.payment_method}, marked by staff` });
  return (await getOrder(actor.ws, orderId))!;
}

export async function fulfillOrder(
  actor: ShopActor,
  orderId: string,
  input: { trackingNumber?: string; trackingCompany?: string; trackingUrl?: string; notify?: boolean; items?: Array<{ itemId: string; quantity: number }> },
): Promise<OrderDto> {
  const o = await getOrderRow(actor.ws, orderId);
  if (!o) throw new ShopError('not_found', 404);
  if (o.status !== 'paid') throw new ShopError('invalid_status', 409);
  const trackingUrl = (input.trackingUrl ?? '').trim();
  if (trackingUrl && !/^https?:\/\/[^\s]{3,500}$/i.test(trackingUrl)) throw new ShopError('invalid_tracking_url');
  const db = getDb();
  const items = await orderItems(orderId);
  // Sin detalle: todo lo que falta salir.
  const wanted = input.items?.length
    ? input.items.map((w) => ({ item: items.find((i) => i.id === w.itemId), quantity: Math.trunc(Number(w.quantity) || 0) }))
    : items.map((item) => ({ item: item as OrderItemRow | undefined, quantity: item.quantity - Number(item.fulfilled_qty ?? 0) })).filter((w) => w.quantity > 0);
  if (!wanted.length || wanted.some((w) => !w.item || w.quantity < 1)) throw new ShopError('invalid_input');
  // Cada línea con compare-and-set: dos personas no mandan dos veces la misma unidad.
  const claimed: Array<{ itemId: string; quantity: number }> = [];
  for (const w of wanted) {
    const res = await db.prepare('UPDATE shop_order_items SET fulfilled_qty = fulfilled_qty + ? WHERE id = ? AND order_id = ? AND fulfilled_qty + ? <= quantity').run(w.quantity, w.item!.id, orderId, w.quantity);
    if (!res.changes) {
      for (const c of claimed) await db.prepare('UPDATE shop_order_items SET fulfilled_qty = MAX(fulfilled_qty - ?, 0) WHERE id = ?').run(c.quantity, c.itemId);
      throw new ShopError('conflict', 409);
    }
    claimed.push({ itemId: w.item!.id, quantity: w.quantity });
  }
  const ts = nowDb();
  const number = (input.trackingNumber ?? '').trim().slice(0, 80) || null;
  const company = (input.trackingCompany ?? '').trim().slice(0, 80) || null;
  const fulfillmentId = newId('ful');
  await db
    .prepare('INSERT INTO shop_fulfillments (id, order_id, workspace_id, items, tracking_number, tracking_company, tracking_url, created_by, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)')
    .run(fulfillmentId, orderId, actor.ws, JSON.stringify(claimed), number, company, trackingUrl || null, actor.person, ts);
  const after = await orderItems(orderId);
  const complete = after.every((i) => Number(i.fulfilled_qty ?? 0) >= i.quantity);
  // El pedido guarda el último seguimiento; pasa a enviado cuando salió todo.
  await db
    .prepare(`UPDATE shop_orders SET ${complete ? "status = 'fulfilled', fulfilled_at = ?," : 'fulfilled_at = COALESCE(fulfilled_at, ?),'} tracking_number = COALESCE(?, tracking_number), tracking_company = COALESCE(?, tracking_company), tracking_url = COALESCE(?, tracking_url), updated_at = ? WHERE id = ? AND workspace_id = ?`)
    .run(ts, number, company, trackingUrl || null, ts, orderId, actor.ws);
  const next = (await getOrderRow(actor.ws, orderId))!;
  const summary = claimed.map((c) => `${after.find((i) => i.id === c.itemId)?.title ?? ''} x${c.quantity}`).join(', ').slice(0, 300);
  const prefix = complete && claimed.length === items.length && claimed.every((c, i) => c.quantity === items[i]?.quantity) ? 'Fulfilled' : complete ? `Fulfilled the rest: ${summary}` : `Partly fulfilled: ${summary}`;
  await addOrderEvent(next, 'fulfilled', number ? `${prefix}. Tracking ${company ? `${company} ` : ''}${number}` : prefix, actor.person);
  const store = await getStore(actor.ws);
  if (store) {
    const { onOrderFulfilled } = await import('./shop-effects');
    await onOrderFulfilled(store, next, after, input.notify !== false, { fulfillmentId, complete });
  }
  return (await getOrder(actor.ws, orderId))!;
}

/**
 * Pago verificado que llega para un pedido que el equipo ya canceló (sin
 * pagar): se guarda el pago (una sola vez, compare-and-set sobre paid_at),
 * queda en la línea de tiempo y se avisa al equipo para reembolsarlo. El
 * pedido sigue cancelado y sin stock.
 */
async function recordPaymentAfterCancel(ws: string, orderId: string, opts: { paymentId?: string | null; source: string }): Promise<false | 'after_cancel'> {
  const ts = nowDb();
  const res = await getDb()
    .prepare(
      `UPDATE shop_orders SET paid_at = ?, payment_id = COALESCE(?, payment_id), updated_at = ?
       WHERE id = ? AND workspace_id = ? AND status = 'cancelled' AND paid_at IS NULL`,
    )
    .run(ts, opts.paymentId ?? null, ts, orderId, ws);
  if (!res.changes) return false;
  const o = (await getOrderRow(ws, orderId))!;
  const { formatMoney } = await import('./shop-money');
  await addOrderEvent(o, 'paid', `Payment received after the order was cancelled (${opts.source}): refund ${formatMoney(o.total_cents, o.currency)} to the customer.`);
  const { notifyStaff } = await import('./shop-effects');
  await notifyStaff(ws, localized('orderPaidAfterCancel', { number: o.number }), localized('orderRefundBody', { amount: formatMoney(o.total_cents, o.currency), email: o.email }), `/app/shop/orders/${o.id}`, o.id);
  return 'after_cancel';
}

async function forceDiscountUse(id: string): Promise<void> {
  await getDb().prepare('UPDATE shop_discounts SET used_count = used_count + 1 WHERE id = ?').run(id);
}

/** Cancela con compare-and-set desde el estado leído; libera reserva o repone stock. */
async function cancelOrderRow(o: OrderRow, opts: { reason: string; actor: string | null; restock: boolean }): Promise<boolean> {
  const db = getDb();
  const ts = nowDb();
  const res = await db
    .prepare("UPDATE shop_orders SET status = 'cancelled', cancelled_at = ?, cancel_reason = ?, expires_at = NULL, updated_at = ? WHERE id = ? AND status = ?")
    .run(ts, opts.reason, ts, o.id, o.status);
  if (!res.changes) return false;
  const items = await orderItems(o.id);
  let released = false;
  if (o.stock_state === 'reserved') {
    const claimed = await db.prepare("UPDATE shop_orders SET stock_state = 'released' WHERE id = ? AND stock_state = 'reserved'").run(o.id);
    if (claimed.changes) {
      released = true;
      await releaseReservation(items);
    }
  } else if (o.stock_state === 'committed' && opts.restock) {
    const claimed = await db.prepare("UPDATE shop_orders SET stock_state = 'restocked' WHERE id = ? AND stock_state = 'committed'").run(o.id);
    if (claimed.changes) await restock(o.workspace_id, o.id, items, opts.actor, 'cancel');
  }
  // Un pedido que nunca se pagó devuelve el uso del código, atado al reclamo de la
  // reserva: si un pago tardío ya la había tomado, el uso no se devuelve.
  if (o.status === 'pending' && o.discount_id && released) await releaseDiscountUse(o.discount_id);
  await addOrderEvent(o, 'cancelled', opts.reason === 'expired' ? 'Cancelled: payment not received in time' : `Cancelled${opts.reason && opts.reason !== 'staff' ? ` (${opts.reason})` : ''}`, opts.actor);
  const store = await getStore(o.workspace_id);
  if (store) await revalidateStore(store.handle);
  return true;
}

export async function cancelOrder(actor: ShopActor, orderId: string, opts: { restock?: boolean; refund?: boolean } = {}): Promise<OrderDto> {
  const o = await getOrderRow(actor.ws, orderId);
  if (!o) throw new ShopError('not_found', 404);
  if (o.status !== 'pending' && o.status !== 'paid') throw new ShopError('invalid_status', 409);
  // Con parte ya enviada no se cancela: eso es una devolución.
  if (o.status === 'paid' && (await orderItems(orderId)).some((i) => Number(i.fulfilled_qty ?? 0) > 0)) throw new ShopError('partly_fulfilled', 409);
  // Reembolsar es de admins: se chequea antes de cancelar para no dejar un pedido a medias.
  const refund = opts.refund === true && o.status === 'paid' && o.total_cents - o.refunded_cents > 0;
  if (refund && !actor.admin) throw new ShopError('forbidden', 403);
  // Antes de cancelar: si el reembolso no puede salir (sin credenciales o sin id del pago), no se toca nada.
  if (refund) {
    const { canRefundPayment } = await import('./shop-payments');
    if (!canRefundPayment(await ensureStore(actor.ws), o)) throw new ShopError('refund_unavailable', 409);
  }
  if (!(await cancelOrderRow(o, { reason: 'staff', actor: actor.person, restock: opts.restock !== false }))) throw new ShopError('conflict', 409);
  if (refund) {
    try {
      return await refundOrder(actor, orderId, { restock: false, reason: 'Order cancelled' });
    } catch (err) {
      // El pedido ya quedó cancelado: se dice en la línea de tiempo y la página muestra el aviso para reintentar.
      const code = err instanceof ShopError ? err.code : 'error';
      await addOrderEvent(o, 'refund_failed', `Cancelled, but the refund failed (${code}). Retry it from Refund.`, actor.person);
      return (await getOrder(actor.ws, orderId))!;
    }
  }
  return (await getOrder(actor.ws, orderId))!;
}

/**
 * Reembolso total o parcial por el proveedor del pago (Stripe o Mercado
 * Pago; transferencia: solo se registra). Total → estado refunded.
 */
export async function refundOrder(actor: ShopActor, orderId: string, input: { amountCents?: number; restock?: boolean; reason?: string }): Promise<OrderDto> {
  if (!actor.admin) throw new ShopError('forbidden', 403);
  const o = await getOrderRow(actor.ws, orderId);
  if (!o) throw new ShopError('not_found', 404);
  const refundable = o.status === 'paid' || o.status === 'fulfilled' || (o.status === 'cancelled' && o.paid_at != null);
  if (!refundable) throw new ShopError('invalid_status', 409);
  const remaining = o.total_cents - o.refunded_cents;
  const amount = input.amountCents == null ? remaining : Math.trunc(input.amountCents);
  if (!(amount > 0) || amount > remaining) throw new ShopError('invalid_amount');
  const store = await ensureStore(actor.ws);
  // Reclamo: se suma el monto con compare-and-set sobre lo ya reembolsado (dos clics no reembolsan dos veces).
  const db = getDb();
  const claim = await db
    .prepare("UPDATE shop_orders SET refunded_cents = refunded_cents + ?, updated_at = ? WHERE id = ? AND refunded_cents = ? AND (status IN ('paid', 'fulfilled') OR (status = 'cancelled' AND paid_at IS NOT NULL))")
    .run(amount, nowDb(), orderId, o.refunded_cents);
  if (!claim.changes) throw new ShopError('conflict', 409);
  const { refundPayment } = await import('./shop-payments');
  try {
    await refundPayment(store, o, amount);
  } catch (err) {
    await db.prepare('UPDATE shop_orders SET refunded_cents = refunded_cents - ? WHERE id = ?').run(amount, orderId);
    throw err;
  }
  const full = o.refunded_cents + amount >= o.total_cents;
  // Un pedido cancelado sigue cancelado (con el reembolso registrado); el resto pasa a reembolsado.
  if (full) await db.prepare("UPDATE shop_orders SET status = CASE WHEN status = 'cancelled' THEN status ELSE 'refunded' END, refunded_at = ? WHERE id = ?").run(nowDb(), orderId);
  const { formatMoney } = await import('./shop-money');
  await addOrderEvent(o, 'refunded', `Refunded ${formatMoney(amount, o.currency)}${input.reason ? `: ${input.reason.slice(0, 200)}` : ''}`, actor.person);
  if (input.restock && full && o.stock_state === 'committed' && o.status !== 'cancelled') {
    const claimed = await db.prepare("UPDATE shop_orders SET stock_state = 'restocked' WHERE id = ? AND stock_state = 'committed'").run(orderId);
    if (claimed.changes) await restock(actor.ws, orderId, await orderItems(orderId), actor.person, 'refund');
  }
  // Lo cobrado después de cancelar nunca sumó al gasto del cliente.
  if (o.status !== 'cancelled') await db.prepare('UPDATE shop_customers SET total_spent_cents = MAX(total_spent_cents - ?, 0) WHERE id = ?').run(amount, o.customer_id ?? '');
  await revalidateStore(store.handle);
  return (await getOrder(actor.ws, orderId))!;
}

export async function addOrderNote(actor: ShopActor, orderId: string, text: string): Promise<OrderDto> {
  const o = await getOrderRow(actor.ws, orderId);
  if (!o) throw new ShopError('not_found', 404);
  const clean = text.trim().slice(0, 2000);
  if (!clean) throw new ShopError('invalid_input');
  await addOrderEvent(o, 'note', clean, actor.person);
  await getDb().prepare('UPDATE shop_orders SET updated_at = ? WHERE id = ?').run(nowDb(), orderId);
  return (await getOrder(actor.ws, orderId))!;
}

/** Cron: cancela los pedidos online vencidos sin pagar y libera su stock. */
export async function expirePendingOrders(now: Date = new Date(), limit = 50): Promise<number> {
  const rows = (await getDb()
    .prepare("SELECT * FROM shop_orders WHERE status = 'pending' AND expires_at IS NOT NULL AND expires_at < ? ORDER BY expires_at ASC LIMIT ?")
    .all(nowDb(now), limit)) as OrderRow[];
  let n = 0;
  for (const o of rows) if (await cancelOrderRow(o, { reason: 'expired', actor: null, restock: false })) n++;
  return n;
}

// ---------- Estado público del pedido ----------

/** Lo que ve el cliente: sin ids internos ni notas del equipo. */
export interface PublicOrder {
  number: number;
  status: OrderStatus;
  email: string;
  currency: string;
  subtotalCents: number;
  discountCents: number;
  shippingCents: number;
  taxCents: number;
  totalCents: number;
  taxIncluded: boolean;
  discountCode: string | null;
  shippingName: string | null;
  paymentMethod: string;
  createdAt: string;
  paidAt: string | null;
  fulfilledAt: string | null;
  tracking: { number: string | null; company: string | null; url: string | null };
  items: Array<{ title: string; variantTitle: string; quantity: number; totalCents: number; imageUrl: string | null }>;
  /** Transferencia: las instrucciones del comercio. */
  instructions: string | null;
  statusToken: string;
  pickup: boolean;
  /** Dirección y horario del retiro. */
  pickupNote: string;
  fulfillment: 'none' | 'partial' | 'full';
  /** Envíos con su seguimiento (el pedido puede salir en partes). */
  shipments: Array<{ number: string | null; company: string | null; url: string | null; items: Array<{ title: string; quantity: number }>; createdAt: string }>;
  /** Medios con los que se puede pagar desde esta página (pedido pendiente). */
  payMethods: string[];
  /** Se puede pedir la devolución desde esta página, y qué líneas. */
  returnable: Array<{ itemId: string; title: string; variantTitle: string; quantity: number }>;
  returnRequested: boolean;
}

export async function publicOrder(store: StoreRow, o: OrderRow): Promise<PublicOrder> {
  const items = await orderItems(o.id);
  const { storedPayments, enabledMethods, listShippingRates: rates } = await import('./shop');
  const manual = storedPayments(store).manual;
  const db = getDb();
  const settings = normalizeSettings(parseJson(store.settings, {}));
  const shipRows = (await db.prepare('SELECT * FROM shop_fulfillments WHERE order_id = ? ORDER BY created_at ASC, rowid ASC').all(o.id)) as Array<Record<string, unknown>>;
  const shipments = shipRows.map((r) => ({
    number: (r.tracking_number as string | null) ?? null,
    company: (r.tracking_company as string | null) ?? null,
    url: (r.tracking_url as string | null) ?? null,
    createdAt: String(r.created_at),
    items: parseJson<Array<{ itemId: string; quantity: number }>>(r.items, []).map((x) => ({ title: items.find((i) => i.id === x.itemId)?.title ?? '', quantity: x.quantity })),
  }));
  const pickupNote = o.pickup === 1 ? ((await rates(o.workspace_id)).find((r) => r.name === o.shipping_name)?.note ?? '') : '';
  const fulfilledAt = o.fulfilled_at ? Date.parse(`${o.fulfilled_at.replace(' ', 'T')}Z`) : null;
  const inWindow = settings.returnsDays > 0 && fulfilledAt != null && Date.now() - fulfilledAt <= settings.returnsDays * 86_400_000;
  const open = (await db.prepare("SELECT 1 AS x FROM shop_returns WHERE order_id = ? AND status IN ('requested', 'approved') LIMIT 1").get(o.id)) != null;
  const returnable = inWindow && (o.status === 'fulfilled' || o.status === 'paid') && !open
    ? items
        .map((i) => ({ itemId: i.id, title: i.title, variantTitle: i.variant_title, quantity: Number(i.fulfilled_qty ?? 0) - Number(i.returned_qty ?? 0) }))
        .filter((i) => i.quantity > 0)
    : [];
  return {
    number: o.number,
    status: o.status,
    email: o.email,
    currency: o.currency,
    subtotalCents: o.subtotal_cents,
    discountCents: o.discount_cents,
    shippingCents: o.shipping_cents,
    taxCents: o.tax_cents,
    totalCents: o.total_cents,
    taxIncluded: o.tax_included === 1,
    discountCode: o.discount_code,
    shippingName: o.shipping_name,
    paymentMethod: o.payment_method,
    createdAt: o.created_at,
    paidAt: o.paid_at,
    fulfilledAt: o.fulfilled_at,
    tracking: { number: o.tracking_number, company: o.tracking_company, url: o.tracking_url },
    items: items.map((i) => ({ title: i.title, variantTitle: i.variant_title, quantity: i.quantity, totalCents: i.total_cents, imageUrl: i.image_url })),
    instructions: o.payment_method === 'manual' && o.status === 'pending' ? (manual?.instructions ?? '') : null,
    statusToken: o.status_token,
    pickup: o.pickup === 1,
    pickupNote,
    fulfillment: fulfillmentState(o, items),
    shipments,
    // Una factura de borrador se paga con cualquier medio de la tienda; un pedido online, reintentando el suyo.
    payMethods:
      o.status !== 'pending' || o.total_cents <= 0
        ? []
        : enabledMethods(store).filter((m) => m !== 'manual' && (o.source === 'draft' || m === o.payment_method)),
    returnable,
    returnRequested: open,
  };
}

export async function orderByStatusToken(store: StoreRow, token: string): Promise<OrderRow | null> {
  if (!/^[A-Za-z0-9_-]{16,64}$/.test(token)) return null;
  // Un borrador no existe para el cliente hasta que se confirma.
  return ((await getDb().prepare("SELECT * FROM shop_orders WHERE workspace_id = ? AND status_token = ? AND status != 'draft'").get(store.workspace_id, token)) as OrderRow | undefined) ?? null;
}

/** Número + email (los dos tienen que coincidir, como la página de estado de Shopify). */
export async function lookupOrder(store: StoreRow, number: string, email: string): Promise<OrderRow | null> {
  const n = /^#?(\d{1,9})$/.exec(number.trim())?.[1];
  const e = email.trim().toLowerCase();
  if (!n || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e)) return null;
  return (
    ((await getDb().prepare("SELECT * FROM shop_orders WHERE workspace_id = ? AND number = ? AND email = ? AND status != 'draft'").get(store.workspace_id, Number(n), e)) as OrderRow | undefined) ??
    null
  );
}

// ---------- Analítica ----------

export interface ShopAnalytics {
  days: number;
  currency: string;
  salesCents: number;
  orders: number;
  aovCents: number;
  views: number;
  checkouts: number;
  /** Pedidos pagados / visitas (0..1). null sin visitas. */
  conversion: number | null;
  series: Array<{ day: string; salesCents: number; orders: number; views: number }>;
  topProducts: Array<{ productId: string | null; title: string; quantity: number; salesCents: number }>;
  byStatus: Record<string, number>;
}

export async function shopAnalytics(ws: string, days = 30, now: Date = new Date()): Promise<ShopAnalytics> {
  const store = await ensureStore(ws);
  const span = Math.min(365, Math.max(1, Math.trunc(days)));
  const from = new Date(now.getTime() - (span - 1) * 86_400_000);
  const fromDay = from.toISOString().slice(0, 10);
  const db = getDb();
  // Ventas: pedidos pagados (pagados, enviados o reembolsados en parte), por fecha de pago, menos lo reembolsado.
  const [sales, views, top, statuses] = await Promise.all([
    db
      .prepare(
        `SELECT substr(paid_at, 1, 10) AS day, COUNT(*) AS orders, COALESCE(SUM(total_cents - refunded_cents), 0) AS sales
         FROM shop_orders WHERE workspace_id = ? AND paid_at IS NOT NULL AND substr(paid_at, 1, 10) >= ? GROUP BY day`,
      )
      .all(ws, fromDay) as Promise<Array<{ day: string; orders: number; sales: number }>>,
    db.prepare('SELECT day, views, checkouts FROM shop_stats WHERE workspace_id = ? AND day >= ?').all(ws, fromDay) as Promise<Array<{ day: string; views: number; checkouts: number }>>,
    db
      .prepare(
        `SELECT i.product_id, i.title, SUM(i.quantity) AS qty, SUM(i.total_cents) AS sales FROM shop_order_items i JOIN shop_orders o ON o.id = i.order_id
         WHERE o.workspace_id = ? AND o.paid_at IS NOT NULL AND substr(o.paid_at, 1, 10) >= ? GROUP BY COALESCE(i.product_id, i.title) ORDER BY sales DESC LIMIT 5`,
      )
      .all(ws, fromDay) as Promise<Array<{ product_id: string | null; title: string; qty: number; sales: number }>>,
    db.prepare('SELECT status, COUNT(*) AS n FROM shop_orders WHERE workspace_id = ? AND substr(created_at, 1, 10) >= ? GROUP BY status').all(ws, fromDay) as Promise<
      Array<{ status: string; n: number }>
    >,
  ]);
  const series: ShopAnalytics['series'] = [];
  for (let i = 0; i < span; i++) {
    const day = new Date(from.getTime() + i * 86_400_000).toISOString().slice(0, 10);
    const s = sales.find((x) => x.day === day);
    const v = views.find((x) => x.day === day);
    series.push({ day, salesCents: Number(s?.sales ?? 0), orders: Number(s?.orders ?? 0), views: Number(v?.views ?? 0) });
  }
  const salesCents = series.reduce((a, d) => a + d.salesCents, 0);
  const orders = series.reduce((a, d) => a + d.orders, 0);
  const viewCount = views.reduce((a, v) => a + Number(v.views), 0);
  return {
    days: span,
    currency: store.currency,
    salesCents,
    orders,
    aovCents: orders ? Math.round(salesCents / orders) : 0,
    views: viewCount,
    checkouts: views.reduce((a, v) => a + Number(v.checkouts), 0),
    conversion: viewCount ? orders / viewCount : null,
    series,
    topProducts: top.map((t) => ({ productId: t.product_id, title: t.title, quantity: Number(t.qty), salesCents: Number(t.sales) })),
    byStatus: Object.fromEntries(statuses.map((s) => [s.status, Number(s.n)])),
  };
}

/** Visita de la tienda (beacon de las páginas públicas). */
export async function recordView(ws: string, now: Date = new Date()): Promise<void> {
  await getDb()
    .prepare('INSERT INTO shop_stats (workspace_id, day, views, checkouts) VALUES (?, ?, 1, 0) ON CONFLICT (workspace_id, day) DO UPDATE SET views = views + 1')
    .run(ws, now.toISOString().slice(0, 10));
}
