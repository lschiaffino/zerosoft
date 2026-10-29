/**
 * Shop: lo que pasa alrededor de un pedido. Emails al cliente (Resend),
 * contacto y actividad en el CRM, avisos al equipo y eventos de Flow
 * (shop.order.created, shop.order.paid, shop.order.fulfilled,
 * shop.inventory.low). Nada de esto lanza: el pedido ya quedó guardado.
 *
 * Los eventos llevan datos del cliente: solo los reciben los flows creados
 * por alguien que hoy usa Shop en el workspace.
 */
import { getDb } from './db';
import { escapeHtml, namedSender, renderBrandedHtml, sendEmail } from './email';
import { personAppAccess } from './api-auth';
import { DEFAULT_BRAND, normalizeBrand, normalizeSettings, parseJson } from './shop-schema';
import { formatMoney } from './shop-money';
import { addOrderEvent, type OrderItemRow, type OrderRow } from './shop-orders';
import { nowDb, type StoreRow } from './shop';

function appUrl(): string {
  return (process.env.NEXTAUTH_URL ?? 'https://zerosoft.ai').replace(/\/$/, '');
}

/** ¿La persona usa Shop en el workspace? (owner siempre). */
export async function personUsesShop(ws: string, personId: string | null): Promise<boolean> {
  if (!personId) return false;
  const access = await personAppAccess(ws, personId).catch(() => null);
  if (!access) return false;
  return access.role === 'owner' || access.apps === '*' || access.apps.includes('shop');
}

export function orderPayload(store: StoreRow, o: OrderRow, items: OrderItemRow[]) {
  const addr = parseJson<Record<string, string>>(o.shipping_address, {});
  return {
    order: {
      id: o.id,
      number: o.number,
      status: o.status,
      email: o.email,
      name: o.name,
      phone: o.phone,
      currency: o.currency,
      subtotal: o.subtotal_cents / 100,
      discount: o.discount_cents / 100,
      shipping: o.shipping_cents / 100,
      tax: o.tax_cents / 100,
      total: o.total_cents / 100,
      discountCode: o.discount_code,
      paymentMethod: o.payment_method,
      shippingAddress: addr.line1 ? addr : null,
      tracking: { number: o.tracking_number, company: o.tracking_company, url: o.tracking_url },
      items: items.map((i) => ({ title: i.title, variant: i.variant_title, sku: i.sku, quantity: i.quantity, price: i.unit_cents / 100, total: i.total_cents / 100 })),
      createdAt: o.created_at,
      paidAt: o.paid_at,
      fulfilledAt: o.fulfilled_at,
      url: `${appUrl()}/en/app/shop/orders/${o.id}`,
    },
    store: { name: store.name, handle: store.handle, url: `${appUrl()}/store/${store.handle}` },
  };
}

async function emit(store: StoreRow, type: 'shop.order.created' | 'shop.order.paid' | 'shop.order.fulfilled' | 'shop.inventory.low', data: Record<string, unknown>): Promise<void> {
  try {
    const { emitEventSoon } = await import('./events');
    await emitEventSoon(store.workspace_id, type, data, { audience: (creatorId) => personUsesShop(store.workspace_id, creatorId ?? store.workspace_id) });
  } catch (err) {
    console.error('[shop] event failed', err instanceof Error ? err.message : 'error');
  }
}

/** Personas a avisar: owner y admins con Shop. */
async function staffToNotify(ws: string): Promise<string[]> {
  try {
    const { listOwnerSpacePeople } = await import('./workspace');
    const people = await listOwnerSpacePeople(ws, { app: 'shop' });
    const ids = people.filter((p) => p.role === 'owner' || p.role === 'admin').map((p) => p.id);
    return [...new Set([ws, ...ids])];
  } catch {
    return [ws];
  }
}

async function notifyStaff(ws: string, title: string, body: string, href: string, sourceId: string): Promise<void> {
  try {
    const { createNotification } = await import('./notifications');
    for (const userId of await staffToNotify(ws)) {
      await createNotification({ userId, type: 'shop_order', title, body, href, sourceType: 'shop_order', sourceId });
    }
  } catch (err) {
    console.error('[shop] notify failed', err instanceof Error ? err.message : 'error');
  }
}

// ---------- Emails ----------

const COPY = {
  en: {
    confirmSubject: 'Order #{n} confirmed',
    pendingSubject: 'Order #{n} received',
    confirmHeading: 'Thanks for your order',
    pendingHeading: 'We got your order',
    paid: 'We received your payment for order #{n}.',
    pending: 'Order #{n} is waiting for your payment.',
    total: 'Total',
    view: 'View your order',
    shippedSubject: 'Order #{n} is on its way',
    shippedHeading: 'Your order shipped',
    shipped: 'Order #{n} left our warehouse.',
    tracking: 'Tracking',
  },
  es: {
    confirmSubject: 'Pedido #{n} confirmado',
    pendingSubject: 'Recibimos el pedido #{n}',
    confirmHeading: 'Gracias por tu compra',
    pendingHeading: 'Recibimos tu pedido',
    paid: 'Recibimos el pago del pedido #{n}.',
    pending: 'El pedido #{n} espera tu pago.',
    total: 'Total',
    view: 'Ver tu pedido',
    shippedSubject: 'El pedido #{n} está en camino',
    shippedHeading: 'Tu pedido salió',
    shipped: 'El pedido #{n} ya salió.',
    tracking: 'Seguimiento',
  },
  pt: {
    confirmSubject: 'Pedido #{n} confirmado',
    pendingSubject: 'Recebemos o pedido #{n}',
    confirmHeading: 'Obrigado pela compra',
    pendingHeading: 'Recebemos seu pedido',
    paid: 'Recebemos o pagamento do pedido #{n}.',
    pending: 'O pedido #{n} aguarda seu pagamento.',
    total: 'Total',
    view: 'Ver seu pedido',
    shippedSubject: 'O pedido #{n} está a caminho',
    shippedHeading: 'Seu pedido foi enviado',
    shipped: 'O pedido #{n} já saiu.',
    tracking: 'Rastreio',
  },
} as const;

function copyFor(locale: string) {
  return COPY[(locale in COPY ? locale : 'en') as keyof typeof COPY];
}

async function sendOrderEmail(store: StoreRow, o: OrderRow, items: OrderItemRow[], kind: 'confirmation' | 'pending' | 'shipped'): Promise<void> {
  const c = copyFor(o.locale);
  const brand = normalizeBrand(parseJson(store.brand, DEFAULT_BRAND));
  const n = String(o.number);
  const url = `${appUrl()}/store/${store.handle}/orders/${o.status_token}`;
  const money = (cents: number) => formatMoney(cents, o.currency, o.locale);
  const lines = items.map((i) => `${escapeHtml(i.title)}${i.variant_title ? ` (${escapeHtml(i.variant_title)})` : ''} × ${i.quantity}: ${escapeHtml(money(i.total_cents))}`);
  const subject = (kind === 'shipped' ? c.shippedSubject : kind === 'pending' ? c.pendingSubject : c.confirmSubject).replace('{n}', n);
  const heading = kind === 'shipped' ? c.shippedHeading : kind === 'pending' ? c.pendingHeading : c.confirmHeading;
  const lead = (kind === 'shipped' ? c.shipped : kind === 'pending' ? c.pending : c.paid).replace('{n}', n);
  const paragraphs = [escapeHtml(lead)];
  if (kind === 'shipped' && o.tracking_number) {
    const label = `${o.tracking_company ? `${o.tracking_company} ` : ''}${o.tracking_number}`;
    paragraphs.push(`${escapeHtml(c.tracking)}: ${o.tracking_url ? `<a href="${escapeHtml(o.tracking_url)}">${escapeHtml(label)}</a>` : escapeHtml(label)}`);
  }
  if (kind !== 'shipped') {
    paragraphs.push(lines.join('<br>'));
    paragraphs.push(`<strong>${escapeHtml(c.total)}: ${escapeHtml(money(o.total_cents))}</strong>`);
  }
  paragraphs.push(`<a href="${escapeHtml(url)}">${escapeHtml(c.view)}</a>`);
  const logo = brand.logoUrl ? (brand.logoUrl.startsWith('/') ? `${appUrl()}${brand.logoUrl}` : brand.logoUrl) : null;
  const html = renderBrandedHtml({ heading, paragraphs, brandColor: brand.accent, logoUrl: logo, eyebrow: store.name });
  const text = [lead, ...(kind !== 'shipped' ? items.map((i) => `${i.title}${i.variant_title ? ` (${i.variant_title})` : ''} x${i.quantity}`) : []), `${c.total}: ${money(o.total_cents)}`, url].join('\n');
  const from = namedSender(store.name);
  const res = await sendEmail({ to: o.email, subject, text, html, from, ...(store.contact_email ? { replyTo: store.contact_email } : {}) });
  await addOrderEvent(o, 'email', `${kind === 'shipped' ? 'Shipping' : kind === 'pending' ? 'Order received' : 'Confirmation'} email ${res.ok ? 'sent' : 'failed'} to ${o.email}`);
}

// ---------- CRM ----------

/**
 * El cliente pasa a contacto del CRM (por email) y el pedido queda como
 * actividad en su ficha. El id del contacto se guarda en el cliente de Shop.
 */
async function syncCrm(store: StoreRow, o: OrderRow, items: OrderItemRow[]): Promise<void> {
  const settings = normalizeSettings(parseJson(store.settings, {}));
  if (!settings.crmSync) return;
  try {
    const { findOrCreateContact } = await import('./crm-integrations');
    const { contact } = await findOrCreateContact(store.workspace_id, { email: o.email, name: o.name, phone: o.phone || null, source: 'other' });
    if (o.customer_id) await getDb().prepare('UPDATE shop_customers SET crm_contact_id = ? WHERE id = ?').run(contact.id, o.customer_id);
    const { createActivity } = await import('./crm');
    const money = formatMoney(o.total_cents, o.currency);
    await createActivity(store.workspace_id, {
      type: 'note',
      subject: `Shop order #${o.number} paid: ${money}`,
      body: [
        ...items.map((i) => `${i.title}${i.variant_title ? ` (${i.variant_title})` : ''} x${i.quantity}`),
        o.discount_code ? `Discount: ${o.discount_code}` : '',
        `${appUrl()}/en/app/shop/orders/${o.id}`,
      ]
        .filter(Boolean)
        .join('\n'),
      contactId: contact.id,
    });
  } catch (err) {
    console.error('[shop] crm sync failed', err instanceof Error ? err.message : 'error');
  }
}

// ---------- Ganchos ----------

export async function onOrderCreated(store: StoreRow, o: OrderRow, items: OrderItemRow[]): Promise<void> {
  await emit(store, 'shop.order.created', orderPayload(store, o, items));
  if (o.payment_method === 'manual') {
    const settings = normalizeSettings(parseJson(store.settings, {}));
    if (settings.emailConfirmation) await sendOrderEmail(store, o, items, 'pending').catch(() => undefined);
    await notifyStaff(store.workspace_id, `New order #${o.number} waiting for transfer`, `${o.email} · ${formatMoney(o.total_cents, o.currency)}`, `/app/shop/orders/${o.id}`, o.id);
  }
}

export async function onOrderPaid(store: StoreRow, o: OrderRow, items: OrderItemRow[]): Promise<void> {
  const settings = normalizeSettings(parseJson(store.settings, {}));
  if (settings.emailConfirmation) await sendOrderEmail(store, o, items, 'confirmation').catch((err) => console.error('[shop] email failed', err));
  await syncCrm(store, o, items);
  await notifyStaff(store.workspace_id, `Order #${o.number} paid`, `${o.email} · ${formatMoney(o.total_cents, o.currency)}`, `/app/shop/orders/${o.id}`, o.id);
  await emit(store, 'shop.order.paid', orderPayload(store, o, items));
  await getDb().prepare('UPDATE shop_orders SET updated_at = ? WHERE id = ?').run(nowDb(), o.id);
}

export async function onOrderFulfilled(store: StoreRow, o: OrderRow, items: OrderItemRow[], notify: boolean): Promise<void> {
  const settings = normalizeSettings(parseJson(store.settings, {}));
  if (notify && settings.emailShipped) await sendOrderEmail(store, o, items, 'shipped').catch(() => undefined);
  await emit(store, 'shop.order.fulfilled', orderPayload(store, o, items));
}

const lowSent = new Map<string, number>();

export async function onLowStock(
  store: StoreRow,
  rows: Array<{ variantId: string; productId: string; product: string; variant: string; sku: string; available: number }>,
): Promise<void> {
  const day = nowDb().slice(0, 10);
  const fresh = rows.filter((r) => lowSent.get(`${r.variantId}:${r.available}:${day}`) == null);
  if (!fresh.length) return;
  for (const r of fresh) lowSent.set(`${r.variantId}:${r.available}:${day}`, Date.now());
  if (lowSent.size > 5000) lowSent.clear();
  for (const r of fresh) {
    await emit(store, 'shop.inventory.low', {
      item: { productId: r.productId, variantId: r.variantId, product: r.product, variant: r.variant, sku: r.sku, available: r.available, threshold: store.low_stock },
      store: { name: store.name, handle: store.handle },
    });
  }
  const first = fresh[0];
  await notifyStaff(
    store.workspace_id,
    fresh.length === 1 ? `Low stock: ${first.product}${first.variant && first.variant !== 'Default' ? ` (${first.variant})` : ''}` : `Low stock on ${fresh.length} items`,
    fresh.length === 1 ? `${first.available} left` : fresh.map((r) => `${r.product} (${r.available})`).join(', ').slice(0, 200),
    '/app/shop/inventory?low=1',
    first.variantId,
  );
}
