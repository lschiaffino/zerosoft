/**
 * Cobro de cotizaciones con Stripe Checkout, con la cuenta de Stripe que el
 * workspace conectó en CRM › Ajustes › Integraciones (lib/crm-apps.ts).
 *
 * Flujo: el cliente firma → "Pagar" crea la sesión de Checkout → Stripe
 * redirige a /q/<token>?paid=1&session_id=… (la página consulta la sesión) y
 * además manda checkout.session.completed al webhook de la app. Cualquiera de
 * los dos marca la cotización pagada (compare-and-set, una sola vez), deja la
 * actividad en el deal, avisa al owner, emite quote.paid y pasa el deal a
 * ganado si estaba abierto. Con CRM_APPS_FAKE=1 la sesión es de prueba
 * (fake_<id>) y Checkout vuelve directo a la página.
 */
import { localized } from './notification-copy';
import { getDb, type CrmQuoteRow } from './db';
import { isZeroDecimal } from './calendar-price';
import { AppError, appsFake, markDealWon, stripeRequest, stripeSecretFor } from './crm-apps';

function nowDb(): string {
  return new Date().toISOString().slice(0, 19).replace('T', ' ');
}

/** Monto de Stripe (unidad mínima) para un total de la cotización. */
export function quoteStripeAmount(total: number, currency: string): number {
  return isZeroDecimal(currency) ? Math.round(total) : Math.round(total * 100);
}

async function quoteByToken(token: string): Promise<CrmQuoteRow | null> {
  if (!token || token.length > 100) return null;
  return ((await getDb().prepare("SELECT * FROM crm_quotes WHERE token = ? AND status != 'draft'").get(token)) as CrmQuoteRow | undefined) ?? null;
}

/** El cliente puede pagar: firmó, la cotización cobra, no está paga y el workspace tiene Stripe. */
export async function canPayQuote(q: Pick<CrmQuoteRow, 'user_id' | 'status' | 'collect_payment' | 'payment_status' | 'total'>): Promise<boolean> {
  if (q.status !== 'accepted' || q.collect_payment !== 1 || q.payment_status === 'paid' || !(q.total > 0)) return false;
  return !!(await stripeSecretFor(q.user_id));
}

/** Crea la sesión de Checkout y devuelve la URL de pago. */
export async function createQuoteCheckout(token: string, opts: { origin: string; locale: string }): Promise<string> {
  const q = await quoteByToken(token);
  if (!q) throw new AppError('not_found', 404);
  if (!(await canPayQuote(q))) throw new AppError(q.payment_status === 'paid' ? 'already_paid' : 'payment_unavailable', 409);
  const lang = ['es', 'pt'].includes(opts.locale) ? opts.locale : 'en';
  const page = `${opts.origin}/${lang}/q/${encodeURIComponent(token)}`;
  if (appsFake()) {
    const session = `fake_${q.id}`;
    await getDb()
      .prepare("UPDATE crm_quotes SET stripe_session_id = ?, payment_status = 'pending', updated_at = ? WHERE id = ?")
      .run(session, nowDb(), q.id);
    return `${page}?paid=1&session_id=${session}`;
  }
  const key = await stripeSecretFor(q.user_id);
  const sig = (await getDb().prepare('SELECT signer_email FROM crm_quote_signatures WHERE quote_id = ?').get(q.id)) as
    | { signer_email: string }
    | undefined;
  const email = sig?.signer_email || q.recipient_email;
  const form = new URLSearchParams();
  form.set('mode', 'payment');
  form.set('client_reference_id', q.id);
  if (email) form.set('customer_email', email);
  form.set('metadata[source]', 'zerosoft_crm_quote');
  form.set('metadata[quote_id]', q.id);
  form.set('metadata[quote_number]', q.number);
  form.set('metadata[deal_id]', q.deal_id);
  form.set('payment_intent_data[metadata][source]', 'zerosoft_crm_quote');
  form.set('payment_intent_data[metadata][quote_id]', q.id);
  form.set('line_items[0][quantity]', '1');
  form.set('line_items[0][price_data][currency]', q.currency.toLowerCase());
  form.set('line_items[0][price_data][unit_amount]', String(quoteStripeAmount(q.total, q.currency)));
  form.set('line_items[0][price_data][product_data][name]', `${q.number}${q.title ? ` · ${q.title}` : ''}`.slice(0, 250));
  form.set('success_url', `${page}?paid=1&session_id={CHECKOUT_SESSION_ID}`);
  form.set('cancel_url', page);
  form.set('locale', lang === 'pt' ? 'pt-BR' : lang);
  const session = await stripeRequest(key, 'POST', '/checkout/sessions', form);
  const url = typeof session.url === 'string' ? session.url : '';
  const id = typeof session.id === 'string' ? session.id : '';
  if (!url || !id) throw new AppError('stripe_error', 502);
  await getDb()
    .prepare("UPDATE crm_quotes SET stripe_session_id = ?, payment_status = 'pending', updated_at = ? WHERE id = ?")
    .run(id, nowDb(), q.id);
  return url;
}

/**
 * Marca pagada la cotización de una sesión de Checkout (webhook o regreso a la
 * página). Exige que sea la sesión que creamos y que cobre el total en la
 * moneda de la cotización. true si esta llamada la marcó.
 */
export async function markQuotePaidFromSession(userId: string, session: Record<string, unknown>): Promise<boolean> {
  const meta = (session.metadata ?? {}) as Record<string, string>;
  const quoteId = String(meta.quote_id ?? session.client_reference_id ?? '');
  const q = (await getDb().prepare('SELECT * FROM crm_quotes WHERE id = ? AND user_id = ?').get(quoteId, userId)) as CrmQuoteRow | undefined;
  if (!q || !q.stripe_session_id || session.id !== q.stripe_session_id) return false;
  const fake = appsFake() && q.stripe_session_id.startsWith('fake_');
  if (!fake) {
    if (String(session.currency ?? '').toLowerCase() !== q.currency.toLowerCase()) return false;
    if (Number(session.amount_total) !== quoteStripeAmount(q.total, q.currency)) return false;
  }
  const ts = nowDb();
  const res = await getDb()
    .prepare(
      "UPDATE crm_quotes SET payment_status = 'paid', paid_at = ?, amount_paid = ?, updated_at = ? WHERE id = ? AND payment_status != 'paid'",
    )
    .run(ts, q.total, ts, q.id);
  if (res.changes === 0) return false;
  await onQuotePaid({ ...q, paid_at: ts });
  return true;
}

/** Al volver de Checkout: consulta la sesión en Stripe por si el webhook no llegó (o no está configurado). */
export async function reconcileQuoteCheckout(token: string, sessionId: string): Promise<boolean> {
  const q = await quoteByToken(token);
  if (!q || q.payment_status === 'paid' || !q.stripe_session_id || q.stripe_session_id !== sessionId) return false;
  if (appsFake() && sessionId === `fake_${q.id}`) {
    return markQuotePaidFromSession(q.user_id, {
      id: sessionId,
      metadata: { quote_id: q.id, source: 'zerosoft_crm_quote' },
      payment_status: 'paid',
    });
  }
  const key = await stripeSecretFor(q.user_id);
  if (!key) return false;
  const session = await stripeRequest(key, 'GET', `/checkout/sessions/${encodeURIComponent(sessionId)}`).catch(() => null);
  if (!session || session.payment_status !== 'paid') return false;
  const meta = (session.metadata ?? {}) as Record<string, string>;
  if (meta.source !== 'zerosoft_crm_quote') return false;
  return markQuotePaidFromSession(q.user_id, session);
}

/** Efectos del pago. Nunca lanzan: el pago ya quedó guardado. */
async function onQuotePaid(q: CrmQuoteRow): Promise<void> {
  const userId = q.user_id;
  const money = (() => {
    try {
      return new Intl.NumberFormat('en', { style: 'currency', currency: q.currency || 'USD' }).format(q.total);
    } catch {
      return `${q.total} ${q.currency}`;
    }
  })();
  const deal = (await getDb().prepare('SELECT id, name, owner_id FROM crm_deals WHERE id = ?').get(q.deal_id)) as
    | { id: string; name: string; owner_id: string | null }
    | undefined;
  try {
    const { createActivity } = await import('./crm');
    await createActivity(userId, {
      type: 'note',
      subject: `Quote ${q.number} paid: ${money}`,
      body: `${q.title}. Paid online with Stripe Checkout on the quote page.`,
      dealId: q.deal_id,
    });
  } catch {
    /* sin actividad no se pierde el pago */
  }
  try {
    const { createNotification } = await import('./notifications');
    await createNotification({
      userId: deal?.owner_id ?? userId,
      type: 'crm_quote',
      title: localized('quotePaid', { number: q.number }),
      body: `${q.title} (${money})`,
      href: `/app/crm/quotes/${q.id}`,
      sourceType: 'crm_quote',
      sourceId: q.id,
    });
  } catch {
    /* idem */
  }
  try {
    const { emitCrmHook } = await import('./crm-hooks');
    await emitCrmHook(userId, 'quote.paid', {
      id: q.id,
      number: q.number,
      title: q.title,
      total: q.total,
      amount: q.total,
      currency: q.currency,
      dealId: q.deal_id,
      dealName: deal?.name ?? '',
      paidAt: q.paid_at,
    });
  } catch {
    /* idem */
  }
  if (deal) await markDealWon(userId, deal.id, `quote ${q.number} paid`).catch(() => false);
}
