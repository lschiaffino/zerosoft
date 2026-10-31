/**
 * Books: cobro online de facturas con Stripe Checkout y Mercado Pago
 * (Checkout Pro), con las credenciales del workspace cifradas con
 * lib/secret-box (el mismo esquema que Shop). Nunca se devuelven, se
 * loguean ni van a un modelo. Todo lo saliente pasa por safeFetch.
 *
 * Webhooks: /api/books/webhooks/stripe/<token> y
 * /api/books/webhooks/mercadopago/<token> (token propio de Books). Firma
 * verificada con el secreto del comercio; el cobro se registra una sola vez
 * (books_webhook_events + índice único por provider_ref) y el monto y la
 * moneda tienen que coincidir con el saldo de la factura.
 *
 * BOOKS_PAYMENTS_FAKE=1: sin salir a internet. El checkout vuelve directo a
 * la factura pública y el pago lo marca un webhook firmado.
 */
import { localized, type NotificationText } from './notification-copy';
import { getDb } from './db';
import { safeFetch } from './safe-fetch';
import { open as openSecret, seal } from './secret-box';
import { verifyStripeSignature } from './calendar-payments';
import { verifyMercadoPagoSignature } from './shop-payments';
import { audit, ensureBooks, type SettingsRow } from './books';
import { amountDue, getDocRow, publicUrl, recordPayment } from './books-docs';
import { BooksError, nowDb, parseJson, type BooksActor } from './books-schema';
import { currencyDecimals, toMajor } from './books-money';

const STRIPE_API = 'https://api.stripe.com/v1';
const MP_API = 'https://api.mercadopago.com';

export function booksPaymentsFake(): boolean {
  return process.env.BOOKS_PAYMENTS_FAKE === '1';
}

function appBase(): string {
  return (process.env.NEXTAUTH_URL ?? 'https://zerosoft.ai').replace(/\/$/, '');
}

interface StoredPayments {
  stripe?: { secret: string; webhookSecret: string; last4: string; connectedAt: string };
  mercadopago?: { token: string; webhookSecret: string; last4: string; connectedAt: string };
}

function stored(s: SettingsRow): StoredPayments {
  return parseJson<StoredPayments>(s.payments, {});
}

export interface BooksPaymentsView {
  stripe: { connected: boolean; last4: string | null; webhookSecretSet: boolean; webhookUrl: string };
  mercadopago: { connected: boolean; last4: string | null; webhookSecretSet: boolean; webhookUrl: string };
}

export function paymentsView(s: SettingsRow): BooksPaymentsView {
  const p = stored(s);
  return {
    stripe: { connected: Boolean(p.stripe?.secret), last4: p.stripe?.last4 ?? null, webhookSecretSet: Boolean(p.stripe?.webhookSecret), webhookUrl: `${appBase()}/api/books/webhooks/stripe/${s.webhook_token}` },
    mercadopago: {
      connected: Boolean(p.mercadopago?.token),
      last4: p.mercadopago?.last4 ?? null,
      webhookSecretSet: Boolean(p.mercadopago?.webhookSecret),
      webhookUrl: `${appBase()}/api/books/webhooks/mercadopago/${s.webhook_token}`,
    },
  };
}

/** Métodos online disponibles para una factura (con credenciales y, en Stripe, moneda soportada). */
export function onlineMethods(s: SettingsRow): Array<'stripe' | 'mercadopago'> {
  const p = stored(s);
  const out: Array<'stripe' | 'mercadopago'> = [];
  if (p.stripe?.secret) out.push('stripe');
  if (p.mercadopago?.token) out.push('mercadopago');
  return out;
}

async function stripeRequest(key: string, method: 'GET' | 'POST', path: string, form?: URLSearchParams): Promise<Record<string, unknown>> {
  const res = await safeFetch(
    `${STRIPE_API}${path}`,
    { method, headers: { authorization: `Bearer ${key}`, ...(form ? { 'content-type': 'application/x-www-form-urlencoded' } : {}) }, body: form?.toString() },
    10_000,
  );
  const data = (await res.json().catch(() => ({}))) as Record<string, unknown>;
  if (!res.ok) throw new BooksError(res.status === 401 ? 'stripe_invalid_key' : 'stripe_error', 502);
  return data;
}

async function mpRequest(token: string, method: 'GET' | 'POST', path: string, body?: unknown): Promise<Record<string, unknown>> {
  const res = await safeFetch(
    `${MP_API}${path}`,
    { method, headers: { authorization: `Bearer ${token}`, ...(body ? { 'content-type': 'application/json' } : {}) }, body: body ? JSON.stringify(body) : undefined },
    10_000,
  );
  const data = (await res.json().catch(() => ({}))) as Record<string, unknown>;
  if (!res.ok) throw new BooksError(res.status === 401 ? 'mp_invalid_token' : 'mp_error', 502);
  return data;
}

export interface PaymentsPatch {
  stripe?: { secretKey?: string; webhookSecret?: string } | null;
  mercadopago?: { accessToken?: string; webhookSecret?: string } | null;
}

/** Guarda credenciales (admins del workspace). Vacío deja el valor anterior; null desconecta. */
export async function savePayments(actor: BooksActor, patch: PaymentsPatch): Promise<BooksPaymentsView> {
  if (!actor.admin) throw new BooksError('forbidden', 403);
  const s = await ensureBooks(actor.ws);
  const p = stored(s);
  const ts = nowDb();
  if (patch.stripe === null) delete p.stripe;
  else if (patch.stripe) {
    const key = patch.stripe.secretKey?.trim() ?? '';
    const hook = patch.stripe.webhookSecret?.trim() ?? '';
    if (key) {
      if (!/^(sk|rk)_(test|live)_[A-Za-z0-9]{8,}$/.test(key)) throw new BooksError('stripe_invalid_key');
      if (!booksPaymentsFake()) await stripeRequest(key, 'GET', '/balance');
    }
    if (hook && !/^whsec_[A-Za-z0-9]{8,}$/.test(hook)) throw new BooksError('stripe_invalid_webhook_secret');
    if (!key && !p.stripe) throw new BooksError('stripe_invalid_key');
    p.stripe = {
      secret: key ? seal(key) : p.stripe!.secret,
      webhookSecret: hook ? seal(hook) : (p.stripe?.webhookSecret ?? ''),
      last4: key ? key.slice(-4) : p.stripe!.last4,
      connectedAt: key ? ts : p.stripe!.connectedAt,
    };
  }
  if (patch.mercadopago === null) delete p.mercadopago;
  else if (patch.mercadopago) {
    const token = patch.mercadopago.accessToken?.trim() ?? '';
    const hook = patch.mercadopago.webhookSecret?.trim() ?? '';
    if (token) {
      if (!/^(APP_USR|TEST)-[A-Za-z0-9-]{16,}$/.test(token)) throw new BooksError('mp_invalid_token');
      if (!booksPaymentsFake()) await mpRequest(token, 'GET', '/users/me');
    }
    if (hook && !/^[A-Za-z0-9]{16,128}$/.test(hook)) throw new BooksError('mp_invalid_webhook_secret');
    if (!token && !p.mercadopago) throw new BooksError('mp_invalid_token');
    p.mercadopago = {
      token: token ? seal(token) : p.mercadopago!.token,
      webhookSecret: hook ? seal(hook) : (p.mercadopago?.webhookSecret ?? ''),
      last4: token ? token.slice(-4) : p.mercadopago!.last4,
      connectedAt: token ? ts : p.mercadopago!.connectedAt,
    };
  }
  await getDb().prepare('UPDATE books_settings SET payments = ?, updated_at = ? WHERE workspace_id = ?').run(JSON.stringify(p), ts, actor.ws);
  await audit(actor, 'payments.update', 'settings', null, Object.keys(patch).join(','));
  return paymentsView((await ensureBooks(actor.ws))!);
}

/** Monto para Stripe: su unidad mínima coincide con la de la moneda (salvo las de 3 decimales, que Stripe pide redondeadas a 0 en el último). */
export function stripeAmountOf(minor: number, currency: string): number {
  return currencyDecimals(currency) === 3 ? Math.round(minor / 10) * 10 : minor;
}

/**
 * Abre el cobro por el saldo pendiente y devuelve la URL a la que va el
 * cliente. La sesión queda guardada en la factura: el webhook solo acepta
 * esa sesión y ese monto.
 */
export async function startInvoicePayment(token: string, method: 'stripe' | 'mercadopago', locale: string): Promise<string> {
  const { getPublicDocRow } = await import('./books-docs');
  const d = await getPublicDocRow(token);
  if (!d || d.doc_type !== 'invoice') throw new BooksError('not_found', 404);
  if (!['sent', 'partial', 'overdue'].includes(d.status)) throw new BooksError('not_payable', 409);
  const due = amountDue(d);
  if (due <= 0) throw new BooksError('not_payable', 409);
  const s = await ensureBooks(d.workspace_id);
  if (!onlineMethods(s).includes(method)) throw new BooksError('payment_unavailable', 409);
  const page = publicUrl(token, locale);
  const title = `${s.trade_name || s.legal_name || 'Invoice'} · ${d.number_label}`.slice(0, 250);
  const db = getDb();
  if (booksPaymentsFake()) {
    const ref = `fake_${method === 'stripe' ? 'cs' : 'pref'}_${d.id}_${due}`;
    await db.prepare('UPDATE books_documents SET payment_session = ?, updated_at = ? WHERE id = ?').run(ref, nowDb(), d.id);
    return `${page}?return=1`;
  }
  const p = stored(s);
  if (method === 'stripe') {
    const key = openSecret(p.stripe?.secret);
    if (!key) throw new BooksError('payment_unavailable', 409);
    // La sesión anterior de esta factura se vence: un cliente no puede pagar dos checkouts abiertos.
    // Si igual se pagó antes de vencer, el webhook la registra (la factura sale de la metadata firmada).
    if (d.payment_session?.startsWith('cs_')) await stripeRequest(key, 'POST', `/checkout/sessions/${encodeURIComponent(d.payment_session)}/expire`).catch(() => undefined);
    const form = new URLSearchParams();
    form.set('mode', 'payment');
    form.set('client_reference_id', d.id);
    form.set('metadata[source]', 'zerosoft_books');
    form.set('metadata[invoice_id]', d.id);
    form.set('metadata[amount]', String(due));
    form.set('payment_intent_data[metadata][source]', 'zerosoft_books');
    form.set('payment_intent_data[metadata][invoice_id]', d.id);
    form.set('line_items[0][quantity]', '1');
    form.set('line_items[0][price_data][currency]', d.currency.toLowerCase());
    form.set('line_items[0][price_data][unit_amount]', String(stripeAmountOf(due, d.currency)));
    form.set('line_items[0][price_data][product_data][name]', title);
    form.set('success_url', `${page}?return=1&session_id={CHECKOUT_SESSION_ID}`);
    form.set('cancel_url', page);
    form.set('locale', locale === 'pt' ? 'pt-BR' : locale === 'es' ? 'es' : 'en');
    const session = await stripeRequest(key, 'POST', '/checkout/sessions', form);
    const url = typeof session.url === 'string' ? session.url : '';
    const id = typeof session.id === 'string' ? session.id : '';
    if (!url || !id) throw new BooksError('stripe_error', 502);
    await db.prepare('UPDATE books_documents SET payment_session = ?, updated_at = ? WHERE id = ?').run(id, nowDb(), d.id);
    return url;
  }
  const mpToken = openSecret(p.mercadopago?.token);
  if (!mpToken) throw new BooksError('payment_unavailable', 409);
  const pref = await mpRequest(mpToken, 'POST', '/checkout/preferences', {
    items: [{ id: d.id, title, quantity: 1, currency_id: d.currency, unit_price: toMajor(due, d.currency) }],
    external_reference: d.id,
    metadata: { source: 'zerosoft_books', invoice_id: d.id },
    notification_url: `${appBase()}/api/books/webhooks/mercadopago/${s.webhook_token}`,
    back_urls: { success: `${page}?return=1`, pending: `${page}?return=1`, failure: page },
    auto_return: 'approved',
  });
  const url = typeof pref.init_point === 'string' ? pref.init_point : '';
  const id = typeof pref.id === 'string' ? pref.id : '';
  if (!url || !id) throw new BooksError('mp_error', 502);
  await db.prepare('UPDATE books_documents SET payment_session = ?, updated_at = ? WHERE id = ?').run(id, nowDb(), d.id);
  return url;
}

// ---------- Webhooks ----------

export type BooksWebhookOutcome =
  | { kind: 'paid'; invoiceId: string; excess?: number }
  | { kind: 'credited'; invoiceId: string; excess: number }
  | { kind: 'duplicate' }
  | { kind: 'ignored'; reason: string };

async function settingsByToken(token: string): Promise<SettingsRow | null> {
  if (!token || token.length > 80) return null;
  return ((await getDb().prepare('SELECT * FROM books_settings WHERE webhook_token = ?').get(token)) as SettingsRow | undefined) ?? null;
}

async function seen(provider: string, ws: string, eventId: string): Promise<boolean> {
  return Boolean(await getDb().prepare('SELECT 1 AS x FROM books_webhook_events WHERE provider = ? AND workspace_id = ? AND event_id = ?').get(provider, ws, eventId));
}

async function remember(provider: string, ws: string, eventId: string): Promise<void> {
  await getDb().prepare('INSERT OR IGNORE INTO books_webhook_events (provider, workspace_id, event_id, created_at) VALUES (?, ?, ?, ?)').run(provider, ws, eventId, nowDb());
}

const systemActor = (ws: string): BooksActor => ({ ws, person: ws, admin: true, role: 'accountant' });

async function warn(ws: string, title: NotificationText, body: NotificationText, href: string, sourceId: string): Promise<void> {
  const { notifyStaff } = await import('./books-integrations');
  await notifyStaff(ws, title, body, href, sourceId);
}

/**
 * Un cobro verificado por el proveedor nunca se descarta en silencio: se
 * aplica a la factura hasta su saldo y lo que sobra (pagó dos veces, pagó
 * una sesión vieja después de un cobro manual, la factura ya estaba pagada
 * o anulada) queda como saldo a favor del cliente (cuenta de anticipos), con
 * aviso al owner y los admins. Si no se puede registrar (otra moneda,
 * factura que no existe) también avisa.
 */
export async function applyProviderPayment(
  ws: string,
  invoiceId: string,
  input: { amount: number; currency: string; method: 'stripe' | 'mercadopago'; providerRef: string; date?: string },
): Promise<BooksWebhookOutcome> {
  const d = await getDocRow(ws, invoiceId);
  const label = d?.number_label || invoiceId;
  if (!d || d.doc_type !== 'invoice') {
    await warn(ws, localized('paymentUnknown'), localized('paymentUnknownBody', { method: input.method, ref: input.providerRef, amount: input.amount, currency: input.currency }), '/app/books/invoices', input.providerRef);
    return { kind: 'ignored', reason: 'unknown_invoice' };
  }
  if (input.currency.toUpperCase() !== d.currency) {
    await warn(ws, localized('paymentCurrency', { label }), localized('paymentCurrencyBody', { method: input.method, amount: input.amount, currency: input.currency, invoiceCurrency: d.currency }), `/app/books/invoices/${d.id}`, d.id);
    return { kind: 'ignored', reason: 'currency' };
  }
  if (!(input.amount > 0)) return { kind: 'ignored', reason: 'amount' };
  // El mismo cobro (misma referencia del proveedor) ya registrado, aplicado o como saldo a favor: nada nuevo.
  const seenPay = await getDb().prepare('SELECT 1 AS x FROM books_payments WHERE workspace_id = ? AND provider_ref = ?').get(ws, input.providerRef);
  const seenExcess = await getDb().prepare("SELECT 1 AS x FROM books_webhook_events WHERE provider = 'excess' AND workspace_id = ? AND event_id = ?").get(ws, input.providerRef);
  if (seenPay || seenExcess) return { kind: 'duplicate' };
  const open = ['sent', 'partial', 'overdue'].includes(d.status);
  const apply = open ? Math.min(input.amount, amountDue(d)) : 0;
  let duplicate = false;
  if (apply > 0) {
    const res = await recordPayment(systemActor(ws), d.id, { amount: apply, date: input.date, method: input.method, reference: input.providerRef, providerRef: input.providerRef }, { system: true });
    duplicate = Boolean(res.duplicate);
    if (duplicate) return { kind: 'duplicate' };
  }
  const excess = input.amount - apply;
  if (excess > 0) {
    const s = await ensureBooks(ws);
    const { inTransaction, isLocked, keyAccounts, postJournal } = await import('./books-ledger');
    const k = await keyAccounts(ws, ['clearing', 'customer_credit'] as const);
    const { convert } = await import('./books-money');
    const base = convert(excess, d.currency, d.fx_rate, s.base_currency);
    const date = input.date ?? new Date().toISOString().slice(0, 10);
    // Claim por referencia y asiento en la misma transacción: si el asiento falla, el claim no queda y el
    // reintento del proveedor lo vuelve a intentar; si dos avisos llegan a la vez, uno solo lo registra.
    const claimed = await inTransaction(async (tdb) => {
      const claim = await tdb
        .prepare('INSERT OR IGNORE INTO books_webhook_events (provider, workspace_id, event_id, created_at) VALUES (?, ?, ?, ?)')
        .run('excess', ws, input.providerRef, nowDb());
      if (!claim.changes) return false;
      await postJournal(
        ws,
        null,
        {
          date: isLocked(date, s.lock_date) ? new Date().toISOString().slice(0, 10) : date,
          memo: `Unapplied ${input.method} payment for ${label}`,
          sourceType: 'payment',
          sourceId: `${input.providerRef}:excess`,
          lines: [
            { accountId: k.clearing, debit: base, contactId: d.contact_id },
            { accountId: k.customer_credit, credit: base, contactId: d.contact_id, description: `Credit from ${input.providerRef}` },
          ],
        },
        { db: tdb },
      );
      return true;
    });
    if (!claimed) return { kind: 'duplicate' };
    const { formatMoney } = await import('./books-money');
    await audit({ ws, person: null }, 'payment.unapplied', 'invoice', d.id, `${excess} ${d.currency} ${input.providerRef}`);
    await warn(
      ws,
      localized('paymentOver', { label }),
      localized('paymentOverBody', { method: input.method, amount: formatMoney(input.amount, d.currency), applied: formatMoney(apply, d.currency), excess: formatMoney(excess, d.currency) }),
      `/app/books/invoices/${d.id}`,
      d.id,
    );
    return apply > 0 ? { kind: 'paid', invoiceId: d.id, excess } : { kind: 'credited', invoiceId: d.id, excess };
  }
  return { kind: 'paid', invoiceId: d.id };
}

/**
 * Stripe: checkout.session.completed / async_payment_succeeded. Exige firma
 * con el secreto del workspace; la factura sale de metadata.invoice_id (la
 * puso nuestro servidor al abrir la sesión, y el evento está firmado), así
 * que cualquier sesión que se haya abierto para la factura se registra. Lo
 * cobrado es amount_total.
 */
export async function handleStripeWebhook(token: string, rawBody: string, signature: string | null, nowSec?: number): Promise<BooksWebhookOutcome> {
  const s = await settingsByToken(token);
  if (!s) throw new BooksError('not_found', 404);
  const secret = openSecret(stored(s).stripe?.webhookSecret);
  if (!secret) throw new BooksError('webhook_not_configured', 400);
  if (!verifyStripeSignature(rawBody, signature, secret, nowSec)) throw new BooksError('invalid_signature', 400);
  let event: { id?: string; type?: string; data?: { object?: Record<string, unknown> } };
  try {
    event = JSON.parse(rawBody);
  } catch {
    throw new BooksError('invalid_input', 400);
  }
  const eventId = String(event.id ?? '');
  if (!eventId) throw new BooksError('invalid_input', 400);
  if (await seen('stripe', s.workspace_id, eventId)) return { kind: 'duplicate' };
  const out = await processStripe(s, event);
  await remember('stripe', s.workspace_id, eventId);
  return out;
}

async function processStripe(s: SettingsRow, event: { type?: string; data?: { object?: Record<string, unknown> } }): Promise<BooksWebhookOutcome> {
  if (event.type !== 'checkout.session.completed' && event.type !== 'checkout.session.async_payment_succeeded') return { kind: 'ignored', reason: 'event_type' };
  const o = event.data?.object ?? {};
  const meta = (o.metadata ?? {}) as Record<string, string>;
  if (meta.source !== 'zerosoft_books' || !meta.invoice_id) return { kind: 'ignored', reason: 'not_books' };
  if (o.payment_status !== 'paid') return { kind: 'ignored', reason: 'unpaid' };
  const amount = Number(o.amount_total);
  if (!Number.isSafeInteger(amount) || amount <= 0) return { kind: 'ignored', reason: 'amount' };
  const ref = typeof o.payment_intent === 'string' ? o.payment_intent : String(o.id);
  return applyProviderPayment(s.workspace_id, meta.invoice_id, { amount, currency: String(o.currency ?? ''), method: 'stripe', providerRef: `stripe:${ref}` });
}

/** Vuelta del checkout de Stripe: consulta la sesión por si el webhook no llegó. */
export async function reconcileStripeReturn(token: string, sessionId: string): Promise<boolean> {
  if (booksPaymentsFake() || !sessionId || sessionId.length > 200) return false;
  const { getPublicDocRow } = await import('./books-docs');
  const d = await getPublicDocRow(token);
  if (!d) return false;
  const s = await ensureBooks(d.workspace_id);
  const key = openSecret(stored(s).stripe?.secret);
  if (!key) return false;
  const session = await stripeRequest(key, 'GET', `/checkout/sessions/${encodeURIComponent(sessionId)}`).catch(() => null);
  if (!session) return false;
  const out = await processStripe(s, { type: 'checkout.session.completed', data: { object: session } });
  return out.kind === 'paid';
}

/**
 * Mercado Pago: aviso "payment" firmado. Con la firma válida se consulta el
 * pago con el token del comercio (el aviso no trae monto) y se exige
 * approved, la factura de external_reference, la moneda y el monto.
 */
export async function handleMercadoPagoWebhook(
  token: string,
  input: { dataId: string; type: string; signature: string | null; requestId: string | null; nowSec?: number },
): Promise<BooksWebhookOutcome> {
  const s = await settingsByToken(token);
  if (!s) throw new BooksError('not_found', 404);
  const secret = openSecret(stored(s).mercadopago?.webhookSecret);
  if (!secret) throw new BooksError('webhook_not_configured', 400);
  if (!input.dataId || input.dataId.length > 64) throw new BooksError('invalid_input', 400);
  // El manifiesto lleva el id tal cual o en minúsculas según la versión de MP: se aceptan los dos (los dos exigen el secreto).
  const signed =
    verifyMercadoPagoSignature(input.signature, input.requestId, input.dataId, secret, input.nowSec) ||
    verifyMercadoPagoSignature(input.signature, input.requestId, input.dataId.toLowerCase(), secret, input.nowSec);
  if (!signed) throw new BooksError('invalid_signature', 400);
  if (input.type !== 'payment') return { kind: 'ignored', reason: 'event_type' };
  const eventId = `payment:${input.dataId}`;
  if (await seen('mercadopago', s.workspace_id, eventId)) return { kind: 'duplicate' };
  let payment: Record<string, unknown>;
  if (booksPaymentsFake() && input.dataId.startsWith('fake')) {
    // Modo de prueba: "fake<invoiceId>" es un pago aprobado por el saldo de la factura.
    const d = await getDocRow(s.workspace_id, input.dataId.slice(4));
    payment = d ? { id: input.dataId, status: 'approved', external_reference: d.id, transaction_amount: toMajor(amountDue(d), d.currency), currency_id: d.currency } : { status: 'rejected' };
  } else {
    const mpToken = openSecret(stored(s).mercadopago?.token);
    if (!mpToken) throw new BooksError('payment_unavailable', 409);
    payment = await mpRequest(mpToken, 'GET', `/v1/payments/${encodeURIComponent(input.dataId)}`);
  }
  let out: BooksWebhookOutcome = { kind: 'ignored', reason: 'unpaid' };
  if (payment.status === 'approved') {
    const currency = String(payment.currency_id ?? '').toUpperCase();
    const amount = Math.round(Number(payment.transaction_amount) * 10 ** currencyDecimals(currency || 'USD'));
    out = await applyProviderPayment(s.workspace_id, String(payment.external_reference ?? ''), { amount, currency, method: 'mercadopago', providerRef: `mp:${String(payment.id ?? input.dataId)}` });
  }
  await remember('mercadopago', s.workspace_id, eventId);
  return out;
}
