/**
 * Shop: lo que pasa alrededor de un pedido. Emails al cliente (Resend),
 * contacto y actividad en el CRM, avisos al equipo y eventos de Flow
 * (shop.order.created, shop.order.paid, shop.order.fulfilled,
 * shop.inventory.low). Nada de esto lanza: el pedido ya quedó guardado.
 *
 * Los eventos llevan datos del cliente: solo los reciben los flows creados
 * por alguien que hoy usa Shop en el workspace.
 */
import { localized, type NotificationText } from './notification-copy';
import { getDb } from './db';
import { escapeHtml, namedSender, renderBrandedHtml, sendEmail } from './email';
import { personAppAccess } from './api-auth';
import { DEFAULT_BRAND, normalizeBrand, normalizeSettings, parseJson } from './shop-schema';
import { formatMoney } from './shop-money';
import { addOrderEvent, type OrderItemRow, type OrderRow } from './shop-orders';
import { claimShopEmail, releaseEmailClaim, type ShopEmailKind } from './shop-email-guard';
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

export async function notifyStaff(ws: string, title: NotificationText, body: NotificationText, href: string, sourceId: string): Promise<void> {
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
    invoiceSubject: 'Invoice for order #{n}',
    invoiceHeading: 'Your order is ready to pay',
    invoice: 'Order #{n} is waiting for your payment. Open it to see how to pay.',
    partSubject: 'Part of order #{n} is on its way',
    partHeading: 'Part of your order shipped',
    part: 'Part of order #{n} left our warehouse. We will write again when the rest ships.',
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
    invoiceSubject: 'Factura del pedido #{n}',
    invoiceHeading: 'Tu pedido está listo para pagar',
    invoice: 'El pedido #{n} espera tu pago. Abrilo para ver cómo pagar.',
    partSubject: 'Parte del pedido #{n} está en camino',
    partHeading: 'Salió parte de tu pedido',
    part: 'Parte del pedido #{n} ya salió. Te escribimos de nuevo cuando salga el resto.',
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
    invoiceSubject: 'Fatura do pedido #{n}',
    invoiceHeading: 'Seu pedido está pronto para pagar',
    invoice: 'O pedido #{n} aguarda seu pagamento. Abra para ver como pagar.',
    partSubject: 'Parte do pedido #{n} está a caminho',
    partHeading: 'Parte do seu pedido foi enviada',
    part: 'Parte do pedido #{n} já saiu. Escreveremos de novo quando o resto sair.',
  },
} as const;

function copyFor(locale: string) {
  return COPY[(locale in COPY ? locale : 'en') as keyof typeof COPY];
}

type OrderEmail = 'confirmation' | 'pending' | 'shipped' | 'shipped_part' | 'invoice';

const EMAIL_KIND: Record<OrderEmail, ShopEmailKind> = { confirmation: 'order_confirmation', pending: 'order_pending', shipped: 'order_shipped', shipped_part: 'order_shipped', invoice: 'invoice' };
const EVENT_LABEL: Record<OrderEmail, string> = { confirmation: 'Confirmation', pending: 'Order received', shipped: 'Shipping', shipped_part: 'Shipping', invoice: 'Invoice' };

/** true si salió. Topes por destinatario y tienda, y una sola vez por pedido y tipo (lib/shop-email-guard.ts). */
export async function sendOrderEmail(store: StoreRow, o: OrderRow, items: OrderItemRow[], kind: OrderEmail, ref?: string): Promise<boolean> {
  const emailRef = ref ?? o.id;
  const claim = await claimShopEmail(o.workspace_id, o.email, EMAIL_KIND[kind], emailRef);
  if (!claim.ok) {
    if (claim.reason !== 'duplicate') await addOrderEvent(o, 'email', `${EVENT_LABEL[kind]} email not sent to ${o.email}: limit reached`);
    return false;
  }
  const c = copyFor(o.locale);
  const brand = normalizeBrand(parseJson(store.brand, DEFAULT_BRAND));
  const n = String(o.number);
  const url = `${appUrl()}/store/${store.handle}/orders/${o.status_token}`;
  const money = (cents: number) => formatMoney(cents, o.currency, o.locale);
  const lines = items.map((i) => `${escapeHtml(i.title)}${i.variant_title ? ` (${escapeHtml(i.variant_title)})` : ''} × ${i.quantity}: ${escapeHtml(money(i.total_cents))}`);
  const shippedKind = kind === 'shipped' || kind === 'shipped_part';
  const subject = (kind === 'shipped' ? c.shippedSubject : kind === 'shipped_part' ? c.partSubject : kind === 'invoice' ? c.invoiceSubject : kind === 'pending' ? c.pendingSubject : c.confirmSubject).replace('{n}', n);
  const heading = kind === 'shipped' ? c.shippedHeading : kind === 'shipped_part' ? c.partHeading : kind === 'invoice' ? c.invoiceHeading : kind === 'pending' ? c.pendingHeading : c.confirmHeading;
  const lead = (kind === 'shipped' ? c.shipped : kind === 'shipped_part' ? c.part : kind === 'invoice' ? c.invoice : kind === 'pending' ? c.pending : c.paid).replace('{n}', n);
  const paragraphs = [escapeHtml(lead)];
  if (shippedKind && o.tracking_number) {
    const label = `${o.tracking_company ? `${o.tracking_company} ` : ''}${o.tracking_number}`;
    paragraphs.push(`${escapeHtml(c.tracking)}: ${o.tracking_url ? `<a href="${escapeHtml(o.tracking_url)}">${escapeHtml(label)}</a>` : escapeHtml(label)}`);
  }
  // La factura sale por decisión del comercio a la dirección que escribió: sin texto suyo, solo el total y el link.
  if (!shippedKind && kind !== 'invoice') paragraphs.push(lines.join('<br>'));
  if (!shippedKind) paragraphs.push(`<strong>${escapeHtml(c.total)}: ${escapeHtml(money(o.total_cents))}</strong>`);
  paragraphs.push(`<a href="${escapeHtml(url)}">${escapeHtml(c.view)}</a>`);
  const logo = brand.logoUrl ? (brand.logoUrl.startsWith('/') ? `${appUrl()}${brand.logoUrl}` : brand.logoUrl) : null;
  const html = renderBrandedHtml({ heading, paragraphs, brandColor: brand.accent, logoUrl: logo, eyebrow: store.name });
  const text = [lead, ...(!shippedKind && kind !== 'invoice' ? items.map((i) => `${i.title}${i.variant_title ? ` (${i.variant_title})` : ''} x${i.quantity}`) : []), `${c.total}: ${money(o.total_cents)}`, url].join('\n');
  const from = namedSender(store.name);
  const res = await sendEmail({ to: o.email, subject, text, html, from, idempotencyKey: `shop:${EMAIL_KIND[kind]}:${emailRef}`, ...(store.contact_email ? { replyTo: store.contact_email } : {}) });
  if (!res.ok) await releaseEmailClaim(claim.id);
  await addOrderEvent(o, 'email', `${EVENT_LABEL[kind]} email ${res.ok ? 'sent' : 'failed'} to ${o.email}`);
  return res.ok;
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
    await notifyStaff(store.workspace_id, localized('orderAwaitingTransfer', { number: o.number }), `${o.email} · ${formatMoney(o.total_cents, o.currency)}`, `/app/shop/orders/${o.id}`, o.id);
  }
}

export async function onOrderPaid(store: StoreRow, o: OrderRow, items: OrderItemRow[]): Promise<void> {
  const settings = normalizeSettings(parseJson(store.settings, {}));
  if (settings.emailConfirmation) await sendOrderEmail(store, o, items, 'confirmation').catch((err) => console.error('[shop] email failed', err));
  await syncCrm(store, o, items);
  await notifyStaff(store.workspace_id, localized('orderPaid', { number: o.number }), `${o.email} · ${formatMoney(o.total_cents, o.currency)}`, `/app/shop/orders/${o.id}`, o.id);
  await emit(store, 'shop.order.paid', orderPayload(store, o, items));
  // Books: factura emitida y cobrada por el pedido, si el workspace lo activó (lib/books-integrations.ts).
  await import('./books-integrations').then((m) => m.onShopOrderPaid(store.workspace_id, o.id)).catch(() => undefined);
  await getDb().prepare('UPDATE shop_orders SET updated_at = ? WHERE id = ?').run(nowDb(), o.id);
}

export async function onOrderFulfilled(store: StoreRow, o: OrderRow, items: OrderItemRow[], notify: boolean, shipment?: { fulfillmentId: string; complete: boolean }): Promise<void> {
  const settings = normalizeSettings(parseJson(store.settings, {}));
  if (notify && settings.emailShipped) await sendOrderEmail(store, o, items, shipment && !shipment.complete ? 'shipped_part' : 'shipped', shipment?.fulfillmentId).catch(() => undefined);
  // El evento de Flow sale una vez, cuando salió todo el pedido.
  if (!shipment || shipment.complete) await emit(store, 'shop.order.fulfilled', orderPayload(store, o, items));
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
    fresh.length === 1 ? localized('lowStockOne', { product: `${first.product}${first.variant && first.variant !== 'Default' ? ` (${first.variant})` : ''}` }) : localized('lowStockMany', { count: fresh.length }),
    fresh.length === 1 ? localized('lowStockLeft', { count: first.available }) : fresh.map((r) => `${r.product} (${r.available})`).join(', ').slice(0, 200),
    '/app/shop/inventory?low=1',
    first.variantId,
  );
}
