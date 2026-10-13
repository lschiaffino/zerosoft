/**
 * Cal — cobro de reservas con Stripe Checkout, con la cuenta de Stripe del
 * propio workspace (su clave secreta, cifrada con lib/secret-box.ts).
 *
 * Flujo: el invitado elige horario → la reserva queda 'pending' con un hold
 * de HOLD_MINUTES que ocupa el horario → Checkout → el webhook
 * (checkout.session.completed) la confirma. Si no paga, Stripe expira la
 * sesión (checkout.session.expired) o el cron vence el hold y libera el
 * horario. Al volver de Checkout, la página de gestión también consulta la
 * sesión por si el webhook todavía no llegó.
 */
import { createHmac, timingSafeEqual } from 'crypto';
import { getDb, type CalendarBookingRow, type CalendarPaymentSettingsRow } from './db';
import { open, seal } from './secret-box';
import { safeFetch } from './safe-fetch';
import { confirmPendingBooking, expirePendingBooking, type EventTypeWithRules } from './calendar';

const STRIPE_API = 'https://api.stripe.com/v1';

/** Minutos que un horario queda retenido esperando el pago. Stripe exige que Checkout dure al menos 30. */
export const HOLD_MINUTES = 35;
const CHECKOUT_TTL_MINUTES = 31;

/** Monedas sin decimales en Stripe: unit_amount va en unidades, no en centavos. */
const ZERO_DECIMAL = new Set(['clp']);

export function stripeUnitAmount(priceCents: number, currency: string): number {
  return ZERO_DECIMAL.has(currency.toLowerCase()) ? Math.round(priceCents / 100) : priceCents;
}

export class PaymentError extends Error {
  constructor(
    public code: string,
    public status = 400,
  ) {
    super(code);
  }
}

// ---------- Configuración del workspace ----------

export interface PaymentSettingsView {
  configured: boolean;
  keyHint: string | null;
  mode: 'test' | 'live' | null;
  hasWebhookSecret: boolean;
  webhookPath: string;
}

async function settingsRow(userId: string): Promise<CalendarPaymentSettingsRow | undefined> {
  return (await getDb().prepare('SELECT * FROM calendar_payment_settings WHERE user_id = ?').get(userId)) as
    | CalendarPaymentSettingsRow
    | undefined;
}

async function ensureSettingsRow(userId: string): Promise<CalendarPaymentSettingsRow> {
  const existing = await settingsRow(userId);
  if (existing) return existing;
  const token = crypto.randomUUID().replace(/-/g, '');
  await getDb()
    .prepare('INSERT OR IGNORE INTO calendar_payment_settings (user_id, webhook_token) VALUES (?, ?)')
    .run(userId, token);
  return (await settingsRow(userId)) as CalendarPaymentSettingsRow;
}

/** Vista sin secretos para la UI: solo los últimos 4 caracteres de la clave. */
export async function getPaymentSettings(userId: string): Promise<PaymentSettingsView> {
  const row = await ensureSettingsRow(userId);
  const key = open(row.stripe_secret_key);
  return {
    configured: !!key,
    keyHint: key ? `${key.slice(0, 8)}…${key.slice(-4)}` : null,
    mode: key ? (key.includes('_live_') ? 'live' : 'test') : null,
    hasWebhookSecret: !!open(row.stripe_webhook_secret),
    webhookPath: `/api/calendar/payments/webhook/${row.webhook_token}`,
  };
}

export async function savePaymentSettings(
  userId: string,
  input: { stripeSecretKey?: string; stripeWebhookSecret?: string },
): Promise<PaymentSettingsView> {
  await ensureSettingsRow(userId);
  const sets: string[] = [];
  const values: string[] = [];
  if (input.stripeSecretKey !== undefined) {
    sets.push('stripe_secret_key = ?');
    values.push(input.stripeSecretKey ? seal(input.stripeSecretKey) : '');
  }
  if (input.stripeWebhookSecret !== undefined) {
    sets.push('stripe_webhook_secret = ?');
    values.push(input.stripeWebhookSecret ? seal(input.stripeWebhookSecret) : '');
  }
  if (sets.length > 0) {
    await getDb()
      .prepare(`UPDATE calendar_payment_settings SET ${sets.join(', ')}, updated_at = datetime('now') WHERE user_id = ?`)
      .run(...values, userId);
  }
  return getPaymentSettings(userId);
}

async function stripeKeyFor(userId: string): Promise<string> {
  const row = await settingsRow(userId);
  return open(row?.stripe_secret_key);
}

export async function paymentsEnabled(userId: string): Promise<boolean> {
  return !!(await stripeKeyFor(userId));
}

// ---------- Firma del webhook ----------

/**
 * Verifica `Stripe-Signature` (t=<unix>,v1=<hex>[,v1=…]): HMAC-SHA256 de
 * "<t>.<cuerpo crudo>" con el signing secret del endpoint, en tiempo
 * constante y con tolerancia de 5 minutos contra replays.
 */
export function verifyStripeSignature(
  rawBody: string,
  header: string | null,
  secret: string,
  nowSec = Math.floor(Date.now() / 1000),
  toleranceSec = 300,
): boolean {
  if (!header || !secret) return false;
  const parts = header.split(',').map((p) => p.trim().split('='));
  const t = Number(parts.find(([k]) => k === 't')?.[1]);
  const sigs = parts.filter(([k]) => k === 'v1').map(([, v]) => v ?? '');
  if (!Number.isFinite(t) || sigs.length === 0) return false;
  if (Math.abs(nowSec - t) > toleranceSec) return false;
  const expected = createHmac('sha256', secret).update(`${t}.${rawBody}`, 'utf8').digest();
  return sigs.some((s) => {
    if (!/^[0-9a-f]+$/i.test(s)) return false;
    const got = Buffer.from(s, 'hex');
    return got.length === expected.length && timingSafeEqual(got, expected);
  });
}

/** Header firmado como lo manda Stripe (para tests y herramientas). */
export function signStripePayload(rawBody: string, secret: string, t = Math.floor(Date.now() / 1000)): string {
  const v1 = createHmac('sha256', secret).update(`${t}.${rawBody}`, 'utf8').digest('hex');
  return `t=${t},v1=${v1}`;
}

// ---------- Checkout ----------

async function stripeRequest(
  key: string,
  method: 'GET' | 'POST',
  path: string,
  form?: URLSearchParams,
): Promise<Record<string, unknown>> {
  const res = await safeFetch(
    `${STRIPE_API}${path}`,
    {
      method,
      headers: {
        authorization: `Bearer ${key}`,
        ...(form ? { 'content-type': 'application/x-www-form-urlencoded' } : {}),
      },
      body: form?.toString(),
    },
    10_000,
  );
  const data = (await res.json().catch(() => ({}))) as Record<string, unknown>;
  if (!res.ok) {
    const err = (data.error as { message?: string } | undefined)?.message ?? `stripe_${res.status}`;
    throw new PaymentError(`stripe_error: ${err}`, 502);
  }
  return data;
}

/**
 * Crea la sesión de Checkout de una reserva 'pending' y guarda su id.
 * Devuelve la URL de pago. `origin` = base pública (NEXTAUTH_URL).
 */
export async function createCheckoutForBooking(
  booking: CalendarBookingRow,
  eventType: Pick<EventTypeWithRules, 'id' | 'user_id' | 'title' | 'price_cents' | 'currency' | 'slug'>,
  opts: { origin: string; locale: string; cancelPath: string; now?: Date },
): Promise<string> {
  const key = await stripeKeyFor(eventType.user_id);
  if (!key) throw new PaymentError('payments_not_configured', 409);
  const now = opts.now ?? new Date();
  const lang = ['es', 'pt'].includes(opts.locale) ? opts.locale : 'en';
  const manage = `${opts.origin}/${lang}/book/manage/${booking.manage_token}`;
  const form = new URLSearchParams();
  form.set('mode', 'payment');
  form.set('client_reference_id', booking.id);
  form.set('customer_email', booking.invitee_email);
  form.set('metadata[booking_id]', booking.id);
  form.set('metadata[source]', 'zerosoft_cal');
  form.set('line_items[0][quantity]', '1');
  form.set('line_items[0][price_data][currency]', eventType.currency);
  form.set('line_items[0][price_data][unit_amount]', String(stripeUnitAmount(eventType.price_cents, eventType.currency)));
  form.set('line_items[0][price_data][product_data][name]', eventType.title);
  form.set('success_url', `${manage}?paid=1&session_id={CHECKOUT_SESSION_ID}`);
  form.set('cancel_url', `${opts.origin}${opts.cancelPath}`);
  form.set('expires_at', String(Math.floor(now.getTime() / 1000) + CHECKOUT_TTL_MINUTES * 60));
  form.set('locale', lang === 'pt' ? 'pt-BR' : lang);
  const session = await stripeRequest(key, 'POST', '/checkout/sessions', form);
  const url = typeof session.url === 'string' ? session.url : '';
  const id = typeof session.id === 'string' ? session.id : '';
  if (!url || !id) throw new PaymentError('stripe_error: no session url', 502);
  await getDb().prepare('UPDATE calendar_bookings SET stripe_session_id = ? WHERE id = ?').run(id, booking.id);
  return url;
}

// ---------- Confirmación ----------

async function bookingInWorkspace(bookingId: string, userId: string): Promise<CalendarBookingRow | undefined> {
  return (await getDb()
    .prepare(
      `SELECT b.* FROM calendar_bookings b JOIN calendar_event_types e ON e.id = b.event_type_id
       WHERE b.id = ? AND e.user_id = ?`,
    )
    .get(bookingId, userId)) as CalendarBookingRow | undefined;
}

export type WebhookOutcome =
  | { kind: 'confirmed'; booking: CalendarBookingRow }
  | { kind: 'expired'; bookingId: string }
  | { kind: 'ignored' };

/**
 * Procesa un webhook de Stripe para el workspace dueño de `token`. Lanza
 * PaymentError (404 token desconocido, 400 firma inválida). Idempotente:
 * un evento repetido devuelve 'ignored'.
 */
export async function handleStripeWebhook(
  token: string,
  rawBody: string,
  signature: string | null,
  nowSec?: number,
): Promise<WebhookOutcome> {
  const row = (await getDb()
    .prepare('SELECT * FROM calendar_payment_settings WHERE webhook_token = ?')
    .get(token)) as CalendarPaymentSettingsRow | undefined;
  if (!row) throw new PaymentError('not_found', 404);
  const secret = open(row.stripe_webhook_secret);
  if (!secret) throw new PaymentError('webhook_not_configured', 409);
  if (!verifyStripeSignature(rawBody, signature, secret, nowSec)) throw new PaymentError('invalid_signature', 400);

  let event: { type?: string; data?: { object?: Record<string, unknown> } };
  try {
    event = JSON.parse(rawBody);
  } catch {
    throw new PaymentError('invalid_input', 400);
  }
  const session = event.data?.object ?? {};
  const meta = (session.metadata ?? {}) as Record<string, string>;
  const bookingId = String(meta.booking_id ?? session.client_reference_id ?? '');
  if (!bookingId) return { kind: 'ignored' };
  const booking = await bookingInWorkspace(bookingId, row.user_id);
  if (!booking) return { kind: 'ignored' };

  if (
    (event.type === 'checkout.session.completed' && session.payment_status === 'paid') ||
    event.type === 'checkout.session.async_payment_succeeded'
  ) {
    const confirmed = await confirmPendingBooking(booking.id, { sessionId: String(session.id ?? '') || null });
    return confirmed ? { kind: 'confirmed', booking: confirmed } : { kind: 'ignored' };
  }
  if (event.type === 'checkout.session.expired' || event.type === 'checkout.session.async_payment_failed') {
    return (await expirePendingBooking(booking.id)) ? { kind: 'expired', bookingId: booking.id } : { kind: 'ignored' };
  }
  return { kind: 'ignored' };
}

/**
 * Al volver de Checkout: consulta la sesión en Stripe y confirma si está
 * pagada (por si el webhook no llegó o no está configurado).
 */
export async function reconcileCheckout(booking: CalendarBookingRow, sessionId: string): Promise<CalendarBookingRow | null> {
  if (booking.status !== 'pending' || !booking.stripe_session_id || booking.stripe_session_id !== sessionId) return null;
  const owner = (await getDb()
    .prepare('SELECT e.user_id FROM calendar_event_types e WHERE e.id = ?')
    .get(booking.event_type_id)) as { user_id: string } | undefined;
  if (!owner) return null;
  const key = await stripeKeyFor(owner.user_id);
  if (!key) return null;
  const session = await stripeRequest(key, 'GET', `/checkout/sessions/${encodeURIComponent(sessionId)}`);
  if (session.payment_status !== 'paid') return null;
  return confirmPendingBooking(booking.id, { sessionId });
}
