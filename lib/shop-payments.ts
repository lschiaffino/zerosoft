/**
 * Shop: cobros con Stripe Checkout, Mercado Pago (Checkout Pro) y
 * transferencia. Credenciales por workspace, cifradas con lib/secret-box;
 * nunca se devuelven ni se loguean. Todo lo saliente pasa por safeFetch.
 *
 * Webhooks: /api/shop/webhooks/stripe/<token> y
 * /api/shop/webhooks/mercadopago/<token> (token propio de la tienda). Se
 * verifica la firma con el secreto del comercio; el pedido pasa a pagado con
 * compare-and-set (lib/shop-orders.ts) y cada evento queda en
 * shop_webhook_events: repetir un evento no hace nada.
 *
 * SHOP_PAYMENTS_FAKE=1: sin salir a internet. La sesión es "fake_cs_<pedido>"
 * o "fake_pref_<pedido>" y el checkout vuelve directo a la página del pedido;
 * el pago lo marca un webhook firmado (los e2e lo firman con el secreto que
 * guardaron) o "marcar pagado".
 */
import { createHmac, timingSafeEqual } from 'crypto';
import { getDb } from './db';
import { safeFetch } from './safe-fetch';
import { open as openSecret, seal } from './secret-box';
import { verifyStripeSignature } from './calendar-payments';
import { ensureStore, getStoreByWebhookToken, nowDb, storedPayments, type StoreRow, type StoredPayments } from './shop';
import { markOrderPaid, type OrderItemRow, type OrderRow } from './shop-orders';
import { isZeroDecimalCurrency, stripeAmount } from './shop-money';
import { ShopError, type ShopActor } from './shop-schema';

const STRIPE_API = 'https://api.stripe.com/v1';
const MP_API = 'https://api.mercadopago.com';

export function paymentsFake(): boolean {
  return process.env.SHOP_PAYMENTS_FAKE === '1';
}

function appBase(): string {
  return (process.env.NEXTAUTH_URL ?? 'https://zerosoft.ai').replace(/\/$/, '');
}

const last4 = (s: string) => s.slice(-4);

// ---------- Credenciales ----------

export interface PaymentsView {
  stripe: { connected: boolean; last4: string | null; webhookSecretSet: boolean; webhookUrl: string };
  mercadopago: { connected: boolean; last4: string | null; webhookSecretSet: boolean; webhookUrl: string };
  manual: { enabled: boolean; label: string; instructions: string };
}

export function paymentsView(store: StoreRow): PaymentsView {
  const p = storedPayments(store);
  const base = appBase();
  return {
    stripe: {
      connected: Boolean(p.stripe?.secret),
      last4: p.stripe?.last4 ?? null,
      webhookSecretSet: Boolean(p.stripe?.webhookSecret),
      webhookUrl: `${base}/api/shop/webhooks/stripe/${store.webhook_token}`,
    },
    mercadopago: {
      connected: Boolean(p.mercadopago?.token),
      last4: p.mercadopago?.last4 ?? null,
      webhookSecretSet: Boolean(p.mercadopago?.webhookSecret),
      webhookUrl: `${base}/api/shop/webhooks/mercadopago/${store.webhook_token}`,
    },
    manual: { enabled: Boolean(p.manual?.enabled), label: p.manual?.label ?? '', instructions: p.manual?.instructions ?? '' },
  };
}

export interface PaymentsPatch {
  stripe?: { secretKey?: string; webhookSecret?: string } | null;
  mercadopago?: { accessToken?: string; webhookSecret?: string } | null;
  manual?: { enabled?: boolean; label?: string; instructions?: string };
}

async function stripeRequest(key: string, method: 'GET' | 'POST', path: string, form?: URLSearchParams): Promise<Record<string, unknown>> {
  const res = await safeFetch(
    `${STRIPE_API}${path}`,
    { method, headers: { authorization: `Bearer ${key}`, ...(form ? { 'content-type': 'application/x-www-form-urlencoded' } : {}) }, body: form?.toString() },
    10_000,
  );
  const data = (await res.json().catch(() => ({}))) as Record<string, unknown>;
  if (!res.ok) throw new ShopError(res.status === 401 ? 'stripe_invalid_key' : 'stripe_error', 502);
  return data;
}

async function mpRequest(token: string, method: 'GET' | 'POST', path: string, body?: unknown, idempotencyKey?: string): Promise<Record<string, unknown>> {
  const res = await safeFetch(
    `${MP_API}${path}`,
    {
      method,
      headers: {
        authorization: `Bearer ${token}`,
        ...(body ? { 'content-type': 'application/json' } : {}),
        ...(idempotencyKey ? { 'x-idempotency-key': idempotencyKey } : {}),
      },
      body: body ? JSON.stringify(body) : undefined,
    },
    10_000,
  );
  const data = (await res.json().catch(() => ({}))) as Record<string, unknown>;
  if (!res.ok) throw new ShopError(res.status === 401 ? 'mp_invalid_token' : 'mp_error', 502);
  return data;
}

/**
 * Guarda credenciales (solo admins). Un campo vacío deja el valor anterior;
 * `null` desconecta el proveedor. Las claves se prueban contra el proveedor
 * antes de guardarse (salvo en modo de prueba).
 */
export async function savePayments(actor: ShopActor, patch: PaymentsPatch): Promise<PaymentsView> {
  if (!actor.admin) throw new ShopError('forbidden', 403);
  const store = await ensureStore(actor.ws);
  const p: StoredPayments = storedPayments(store);
  const ts = nowDb();
  if (patch.stripe === null) delete p.stripe;
  else if (patch.stripe) {
    const key = patch.stripe.secretKey?.trim() ?? '';
    const hook = patch.stripe.webhookSecret?.trim() ?? '';
    if (key) {
      if (!/^(sk|rk)_(test|live)_[A-Za-z0-9]{8,}$/.test(key)) throw new ShopError('stripe_invalid_key');
      if (!paymentsFake()) await stripeRequest(key, 'GET', '/balance');
    }
    if (hook && !/^whsec_[A-Za-z0-9]{8,}$/.test(hook)) throw new ShopError('stripe_invalid_webhook_secret');
    if (!key && !p.stripe) throw new ShopError('stripe_invalid_key');
    p.stripe = {
      secret: key ? seal(key) : p.stripe!.secret,
      webhookSecret: hook ? seal(hook) : (p.stripe?.webhookSecret ?? ''),
      last4: key ? last4(key) : p.stripe!.last4,
      connectedAt: key ? ts : p.stripe!.connectedAt,
    };
  }
  if (patch.mercadopago === null) delete p.mercadopago;
  else if (patch.mercadopago) {
    const token = patch.mercadopago.accessToken?.trim() ?? '';
    const hook = patch.mercadopago.webhookSecret?.trim() ?? '';
    if (token) {
      if (!/^(APP_USR|TEST)-[A-Za-z0-9-]{16,}$/.test(token)) throw new ShopError('mp_invalid_token');
      if (!paymentsFake()) await mpRequest(token, 'GET', '/users/me');
    }
    if (hook && !/^[A-Za-z0-9]{16,128}$/.test(hook)) throw new ShopError('mp_invalid_webhook_secret');
    if (!token && !p.mercadopago) throw new ShopError('mp_invalid_token');
    p.mercadopago = {
      token: token ? seal(token) : p.mercadopago!.token,
      webhookSecret: hook ? seal(hook) : (p.mercadopago?.webhookSecret ?? ''),
      last4: token ? last4(token) : p.mercadopago!.last4,
      connectedAt: token ? ts : p.mercadopago!.connectedAt,
    };
  }
  if (patch.manual) {
    p.manual = {
      enabled: patch.manual.enabled ?? p.manual?.enabled ?? false,
      label: (patch.manual.label ?? p.manual?.label ?? '').trim().slice(0, 80),
      instructions: (patch.manual.instructions ?? p.manual?.instructions ?? '').trim().slice(0, 2000),
    };
  }
  await getDb().prepare('UPDATE shop_stores SET payments = ?, updated_at = ? WHERE workspace_id = ?').run(JSON.stringify(p), ts, actor.ws);
  return paymentsView((await ensureStore(actor.ws))!);
}

function stripeKeyOf(store: StoreRow): string {
  return openSecret(storedPayments(store).stripe?.secret);
}

function mpTokenOf(store: StoreRow): string {
  return openSecret(storedPayments(store).mercadopago?.token);
}

// ---------- Cobro ----------

function orderPage(store: StoreRow, o: Pick<OrderRow, 'status_token'>, origin: string): string {
  return `${origin.replace(/\/$/, '')}/store/${store.handle}/orders/${o.status_token}`;
}

/** Abre el cobro del pedido y devuelve a dónde mandar al cliente. */
export async function startPayment(store: StoreRow, o: OrderRow, items: OrderItemRow[], origin: string): Promise<string> {
  const page = orderPage(store, o, origin);
  const title = `${store.name} · #${o.number}`.slice(0, 250);
  const db = getDb();
  if (o.payment_method === 'manual') return page;
  if (o.payment_method === 'stripe') {
    if (paymentsFake()) {
      await db.prepare('UPDATE shop_orders SET payment_ref = ? WHERE id = ?').run(`fake_cs_${o.id}`, o.id);
      return `${page}?return=1`;
    }
    const key = stripeKeyOf(store);
    if (!key) throw new ShopError('payment_unavailable', 409);
    const form = new URLSearchParams();
    form.set('mode', 'payment');
    form.set('client_reference_id', o.id);
    form.set('customer_email', o.email);
    form.set('metadata[source]', 'zerosoft_shop');
    form.set('metadata[order_id]', o.id);
    form.set('metadata[order_number]', String(o.number));
    form.set('payment_intent_data[metadata][source]', 'zerosoft_shop');
    form.set('payment_intent_data[metadata][order_id]', o.id);
    // Un solo renglón con el total calculado en el servidor (descuento, envío e impuesto incluidos).
    form.set('line_items[0][quantity]', '1');
    form.set('line_items[0][price_data][currency]', o.currency.toLowerCase());
    form.set('line_items[0][price_data][unit_amount]', String(stripeAmount(o.total_cents, isZeroDecimalCurrency(o.currency))));
    form.set('line_items[0][price_data][product_data][name]', title);
    form.set('line_items[0][price_data][product_data][description]', items.map((i) => `${i.title}${i.variant_title ? ` (${i.variant_title})` : ''} x${i.quantity}`).join(', ').slice(0, 500) || title);
    form.set('success_url', `${page}?return=1&session_id={CHECKOUT_SESSION_ID}`);
    form.set('cancel_url', `${origin.replace(/\/$/, '')}/store/${store.handle}/cart`);
    form.set('locale', o.locale === 'pt' ? 'pt-BR' : o.locale === 'es' ? 'es' : 'en');
    if (o.expires_at) {
      // Stripe exige entre 30 min y 24 h; la sesión vence con la reserva.
      const exp = Math.floor(Date.parse(`${o.expires_at.replace(' ', 'T')}Z`) / 1000);
      const min = Math.floor(Date.now() / 1000) + 31 * 60;
      form.set('expires_at', String(Math.min(Math.max(exp, min), Math.floor(Date.now() / 1000) + 23 * 3600)));
    }
    const session = await stripeRequest(key, 'POST', '/checkout/sessions', form);
    const url = typeof session.url === 'string' ? session.url : '';
    const id = typeof session.id === 'string' ? session.id : '';
    if (!url || !id) throw new ShopError('stripe_error', 502);
    await db.prepare('UPDATE shop_orders SET payment_ref = ? WHERE id = ?').run(id, o.id);
    return url;
  }
  // Mercado Pago, Checkout Pro: preferencia con el total y aviso a nuestro webhook.
  if (paymentsFake()) {
    await db.prepare('UPDATE shop_orders SET payment_ref = ? WHERE id = ?').run(`fake_pref_${o.id}`, o.id);
    return `${page}?return=1`;
  }
  const token = mpTokenOf(store);
  if (!token) throw new ShopError('payment_unavailable', 409);
  const pref = await mpRequest(token, 'POST', '/checkout/preferences', {
    items: [{ id: o.id, title, quantity: 1, currency_id: o.currency, unit_price: o.total_cents / 100 }],
    payer: { email: o.email },
    external_reference: o.id,
    metadata: { source: 'zerosoft_shop', order_id: o.id },
    notification_url: `${appBase()}/api/shop/webhooks/mercadopago/${store.webhook_token}`,
    back_urls: { success: `${page}?return=1`, pending: `${page}?return=1`, failure: `${origin.replace(/\/$/, '')}/store/${store.handle}/cart` },
    auto_return: 'approved',
    ...(o.expires_at ? { expires: true, expiration_date_to: new Date(Date.parse(`${o.expires_at.replace(' ', 'T')}Z`)).toISOString() } : {}),
  });
  const url = typeof pref.init_point === 'string' ? pref.init_point : '';
  const id = typeof pref.id === 'string' ? pref.id : '';
  if (!url || !id) throw new ShopError('mp_error', 502);
  await db.prepare('UPDATE shop_orders SET payment_ref = ? WHERE id = ?').run(id, o.id);
  return url;
}

export async function refundPayment(store: StoreRow, o: OrderRow, amountCents: number): Promise<void> {
  if (o.payment_method === 'manual') return;
  if (paymentsFake() && (o.payment_ref ?? '').startsWith('fake_')) return;
  if (o.payment_method === 'stripe') {
    const key = stripeKeyOf(store);
    if (!key || !o.payment_id) throw new ShopError('refund_unavailable', 409);
    const form = new URLSearchParams();
    form.set('payment_intent', o.payment_id);
    form.set('amount', String(stripeAmount(amountCents, isZeroDecimalCurrency(o.currency))));
    form.set('metadata[order_id]', o.id);
    await stripeRequest(key, 'POST', '/refunds', form);
    return;
  }
  const token = mpTokenOf(store);
  if (!token || !o.payment_id) throw new ShopError('refund_unavailable', 409);
  await mpRequest(token, 'POST', `/v1/payments/${encodeURIComponent(o.payment_id)}/refunds`, { amount: amountCents / 100 }, `refund-${o.id}-${o.refunded_cents}-${amountCents}`);
}

// ---------- Webhooks ----------

export type WebhookOutcome = { kind: 'paid'; orderId: string } | { kind: 'duplicate' } | { kind: 'ignored'; reason: string };

async function seen(provider: string, eventId: string): Promise<boolean> {
  return Boolean(await getDb().prepare('SELECT 1 AS x FROM shop_webhook_events WHERE provider = ? AND event_id = ?').get(provider, eventId));
}

async function remember(provider: string, eventId: string, ws: string): Promise<void> {
  await getDb().prepare('INSERT OR IGNORE INTO shop_webhook_events (provider, event_id, workspace_id, created_at) VALUES (?, ?, ?, ?)').run(provider, eventId, ws, nowDb());
}

/**
 * Stripe: checkout.session.completed (pagada) y async_payment_succeeded.
 * Exige firma válida, que la sesión sea la que creamos para el pedido y que
 * cobre el total en la moneda del pedido.
 */
export async function handleStripeWebhook(token: string, rawBody: string, signature: string | null, nowSec?: number): Promise<WebhookOutcome> {
  const store = await getStoreByWebhookToken(token);
  if (!store) throw new ShopError('not_found', 404);
  const secret = openSecret(storedPayments(store).stripe?.webhookSecret);
  if (!secret) throw new ShopError('webhook_not_configured', 400);
  if (!verifyStripeSignature(rawBody, signature, secret, nowSec)) throw new ShopError('invalid_signature', 400);
  let event: { id?: string; type?: string; data?: { object?: Record<string, unknown> } };
  try {
    event = JSON.parse(rawBody);
  } catch {
    throw new ShopError('invalid_input', 400);
  }
  const eventId = String(event.id ?? '');
  if (!eventId) throw new ShopError('invalid_input', 400);
  if (await seen('stripe', eventId)) return { kind: 'duplicate' };
  const out = await processStripeEvent(store, event);
  await remember('stripe', eventId, store.workspace_id);
  return out;
}

async function processStripeEvent(store: StoreRow, event: { type?: string; data?: { object?: Record<string, unknown> } }): Promise<WebhookOutcome> {
  if (event.type !== 'checkout.session.completed' && event.type !== 'checkout.session.async_payment_succeeded') return { kind: 'ignored', reason: 'event_type' };
  const s = event.data?.object ?? {};
  const meta = (s.metadata ?? {}) as Record<string, string>;
  if (meta.source !== 'zerosoft_shop' || !meta.order_id) return { kind: 'ignored', reason: 'not_shop' };
  if (s.payment_status !== 'paid') return { kind: 'ignored', reason: 'unpaid' };
  const o = (await getDb().prepare('SELECT * FROM shop_orders WHERE id = ? AND workspace_id = ?').get(meta.order_id, store.workspace_id)) as OrderRow | undefined;
  if (!o || o.payment_method !== 'stripe' || !o.payment_ref || s.id !== o.payment_ref) return { kind: 'ignored', reason: 'unknown_session' };
  if (String(s.currency ?? '').toLowerCase() !== o.currency.toLowerCase()) return { kind: 'ignored', reason: 'currency' };
  if (Number(s.amount_total) !== stripeAmount(o.total_cents, isZeroDecimalCurrency(o.currency))) return { kind: 'ignored', reason: 'amount' };
  const paymentId = typeof s.payment_intent === 'string' ? s.payment_intent : null;
  const marked = await markOrderPaid(store.workspace_id, o.id, { paymentId, source: 'Stripe' });
  return marked ? { kind: 'paid', orderId: o.id } : { kind: 'duplicate' };
}

/** Al volver de Stripe: consulta la sesión por si el webhook no llegó (o no está configurado). */
export async function reconcileStripeReturn(store: StoreRow, o: OrderRow, sessionId: string): Promise<boolean> {
  if (o.status !== 'pending' || o.payment_method !== 'stripe' || !o.payment_ref || o.payment_ref !== sessionId || paymentsFake()) return false;
  const key = stripeKeyOf(store);
  if (!key) return false;
  const s = await stripeRequest(key, 'GET', `/checkout/sessions/${encodeURIComponent(sessionId)}`).catch(() => null);
  if (!s) return false;
  const out = await processStripeEvent(store, { type: 'checkout.session.completed', data: { object: s } });
  return out.kind === 'paid';
}

/**
 * Firma de Mercado Pago: x-signature "ts=<ts>,v1=<hmac>" sobre
 * "id:<data.id>;request-id:<x-request-id>;ts:<ts>;" con el secreto del
 * webhook. Se omiten las partes que no vienen, como documenta MP.
 */
export function verifyMercadoPagoSignature(
  header: string | null,
  requestId: string | null,
  dataId: string,
  secret: string,
  nowSec = Math.floor(Date.now() / 1000),
  toleranceSec = 600,
): boolean {
  if (!header || !secret) return false;
  const parts = Object.fromEntries(header.split(',').map((p) => p.trim().split('=') as [string, string]));
  const ts = parts.ts ?? '';
  const v1 = parts.v1 ?? '';
  if (!/^\d+$/.test(ts) || !/^[0-9a-f]{64}$/i.test(v1)) return false;
  // ts en milisegundos o segundos, según la versión de MP.
  const tsSec = ts.length > 11 ? Math.floor(Number(ts) / 1000) : Number(ts);
  if (Math.abs(nowSec - tsSec) > toleranceSec) return false;
  const id = /^[a-z0-9]+$/i.test(dataId) ? dataId.toLowerCase() : dataId;
  let manifest = '';
  if (id) manifest += `id:${id};`;
  if (requestId) manifest += `request-id:${requestId};`;
  manifest += `ts:${ts};`;
  const expected = createHmac('sha256', secret).update(manifest).digest();
  const got = Buffer.from(v1, 'hex');
  return got.length === expected.length && timingSafeEqual(got, expected);
}

export function signMercadoPago(dataId: string, requestId: string, secret: string, ts = Math.floor(Date.now() / 1000)): string {
  const id = /^[a-z0-9]+$/i.test(dataId) ? dataId.toLowerCase() : dataId;
  const v1 = createHmac('sha256', secret).update(`id:${id};request-id:${requestId};ts:${ts};`).digest('hex');
  return `ts=${ts},v1=${v1}`;
}

/**
 * Mercado Pago: aviso "payment" con el id del pago. Con la firma válida se
 * consulta el pago con el token del comercio (el aviso no trae el monto) y
 * se exige approved, el pedido de external_reference, el monto y la moneda.
 */
export async function handleMercadoPagoWebhook(
  token: string,
  input: { dataId: string; type: string; signature: string | null; requestId: string | null; nowSec?: number },
): Promise<WebhookOutcome> {
  const store = await getStoreByWebhookToken(token);
  if (!store) throw new ShopError('not_found', 404);
  const secret = openSecret(storedPayments(store).mercadopago?.webhookSecret);
  if (!secret) throw new ShopError('webhook_not_configured', 400);
  if (!input.dataId || input.dataId.length > 64) throw new ShopError('invalid_input', 400);
  if (!verifyMercadoPagoSignature(input.signature, input.requestId, input.dataId, secret, input.nowSec)) throw new ShopError('invalid_signature', 400);
  if (input.type !== 'payment') return { kind: 'ignored', reason: 'event_type' };
  const eventId = `payment:${input.dataId}`;
  if (await seen('mercadopago', eventId)) return { kind: 'duplicate' };
  let payment: Record<string, unknown>;
  if (paymentsFake() && input.dataId.startsWith('fake')) {
    // Modo de prueba: "fake<orderId>" es un pago aprobado por el total del pedido.
    const orderId = input.dataId.slice(4);
    const o = (await getDb().prepare('SELECT * FROM shop_orders WHERE id = ? AND workspace_id = ?').get(orderId, store.workspace_id)) as OrderRow | undefined;
    payment = o
      ? { id: input.dataId, status: 'approved', external_reference: o.id, transaction_amount: o.total_cents / 100, currency_id: o.currency }
      : { status: 'rejected' };
  } else {
    const mpToken = mpTokenOf(store);
    if (!mpToken) throw new ShopError('payment_unavailable', 409);
    payment = await mpRequest(mpToken, 'GET', `/v1/payments/${encodeURIComponent(input.dataId)}`);
  }
  let out: WebhookOutcome = { kind: 'ignored', reason: 'unpaid' };
  if (payment.status === 'approved') {
    const o = (await getDb().prepare('SELECT * FROM shop_orders WHERE id = ? AND workspace_id = ?').get(String(payment.external_reference ?? ''), store.workspace_id)) as
      | OrderRow
      | undefined;
    if (!o || o.payment_method !== 'mercadopago') out = { kind: 'ignored', reason: 'unknown_order' };
    else if (String(payment.currency_id ?? '').toUpperCase() !== o.currency.toUpperCase()) out = { kind: 'ignored', reason: 'currency' };
    else if (Math.round(Number(payment.transaction_amount) * 100) !== o.total_cents) out = { kind: 'ignored', reason: 'amount' };
    else {
      const marked = await markOrderPaid(store.workspace_id, o.id, { paymentId: String(payment.id ?? input.dataId), source: 'Mercado Pago' });
      out = marked ? { kind: 'paid', orderId: o.id } : { kind: 'duplicate' };
    }
  }
  // Un pago pendiente puede aprobarse después (otro aviso con el mismo id): solo se recuerda el aprobado.
  if (payment.status === 'approved') await remember('mercadopago', eventId, store.workspace_id);
  return out;
}
