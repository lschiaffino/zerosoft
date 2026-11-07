/**
 * Shop: checkouts abandonados. Cuando alguien escribe su email en el checkout
 * queda una fila con el carrito (sin dirección ni nada de pago). El comercio
 * ve la lista y copia el link para recuperarlo; si activó el recordatorio, el
 * cron manda un solo email pasadas las horas elegidas. Topes en
 * lib/shop-email-guard.ts. Las filas se borran a los 30 días. Server-only.
 */
import { randomBytes } from 'crypto';
import { getDb } from './db';
import { escapeHtml, namedSender, renderBrandedHtml, sendEmail } from './email';
import { getStore, newId, nowDb, type StoreRow } from './shop';
import { formatMoney } from './shop-money';
import { claimShopEmail, optOut, releaseEmailClaim } from './shop-email-guard';
import { DEFAULT_BRAND, ShopError, normalizeBrand, normalizeSettings, parseJson, type ShopActor } from './shop-schema';

export interface CheckoutLine {
  variantId: string;
  quantity: number;
}

export interface AbandonedDto {
  id: string;
  email: string;
  name: string;
  subtotalCents: number;
  currency: string;
  status: 'open' | 'recovered';
  emailState: string;
  emailedAt: string | null;
  orderId: string | null;
  url: string;
  items: number;
  updatedAt: string;
}

function appUrl(): string {
  return (process.env.NEXTAUTH_URL ?? 'https://zerosoft.ai').replace(/\/$/, '');
}

function recoverUrl(handle: string, token: string): string {
  return `${appUrl()}/store/${handle}/recover/${token}`;
}

const LINES_MAX = 50;

/** Guarda el avance del checkout: una fila por tienda y email, se pisa con el último carrito. */
export async function saveCheckoutProgress(store: StoreRow, input: { email: string; name?: string; lines: CheckoutLine[]; subtotalCents: number }): Promise<void> {
  const email = input.email.trim().toLowerCase();
  const ts = nowDb();
  const lines = JSON.stringify(input.lines.slice(0, LINES_MAX));
  await getDb()
    .prepare(
      `INSERT INTO shop_checkouts (id, workspace_id, token, email, name, lines, subtotal_cents, currency, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT (workspace_id, email) DO UPDATE SET name = excluded.name, lines = excluded.lines, subtotal_cents = excluded.subtotal_cents, currency = excluded.currency, updated_at = excluded.updated_at,
         status = 'open', order_id = NULL`,
    )
    .run(newId('chk'), store.workspace_id, randomBytes(18).toString('base64url'), email, (input.name ?? '').slice(0, 120), lines, input.subtotalCents, store.currency, ts, ts);
}

export async function markCheckoutRecovered(ws: string, email: string, orderId: string): Promise<void> {
  await getDb()
    .prepare("UPDATE shop_checkouts SET status = 'recovered', order_id = ?, updated_at = ? WHERE workspace_id = ? AND email = ? AND status = 'open'")
    .run(orderId, nowDb(), ws, email.trim().toLowerCase());
}

/** Abandonado recién cuando pasó una hora sin cambios: antes puede estar comprando. */
export async function listAbandoned(store: StoreRow, opts: { limit?: number; now?: Date } = {}): Promise<AbandonedDto[]> {
  const cutoff = nowDb(new Date((opts.now ?? new Date()).getTime() - 3_600_000));
  const rows = (await getDb()
    .prepare("SELECT * FROM shop_checkouts WHERE workspace_id = ? AND (status = 'recovered' OR updated_at <= ?) ORDER BY updated_at DESC LIMIT ?")
    .all(store.workspace_id, cutoff, Math.min(500, opts.limit ?? 200))) as Array<Record<string, unknown>>;
  return rows.map((r) => {
    const lines = parseJson<CheckoutLine[]>(r.lines, []);
    return {
      id: String(r.id),
      email: String(r.email),
      name: String(r.name ?? ''),
      subtotalCents: Number(r.subtotal_cents),
      currency: String(r.currency),
      status: r.status === 'recovered' ? 'recovered' : 'open',
      emailState: String(r.email_state),
      emailedAt: (r.emailed_at as string | null) ?? null,
      orderId: (r.order_id as string | null) ?? null,
      url: recoverUrl(store.handle, String(r.token)),
      items: lines.reduce((s, l) => s + l.quantity, 0),
      updatedAt: String(r.updated_at),
    };
  });
}

export async function checkoutByToken(ws: string, token: string): Promise<{ lines: CheckoutLine[]; email: string } | null> {
  if (!/^[A-Za-z0-9_-]{16,64}$/.test(token)) return null;
  const r = (await getDb().prepare("SELECT lines, email FROM shop_checkouts WHERE workspace_id = ? AND token = ? AND status = 'open'").get(ws, token)) as { lines: string; email: string } | undefined;
  return r ? { lines: parseJson<CheckoutLine[]>(r.lines, []), email: r.email } : null;
}

const COPY = {
  en: { subject: 'You left something in your cart', heading: 'Your cart is still here', lead: 'You started an order and did not finish it. It is saved if you want to come back.', cta: 'Finish your order', total: 'Subtotal', stop: 'Stop these reminders' },
  es: { subject: 'Dejaste algo en tu carrito', heading: 'Tu carrito sigue acá', lead: 'Empezaste un pedido y no lo terminaste. Quedó guardado por si querés volver.', cta: 'Terminar tu pedido', total: 'Subtotal', stop: 'No recibir más recordatorios' },
  pt: { subject: 'Você deixou algo no carrinho', heading: 'Seu carrinho continua aqui', lead: 'Você começou um pedido e não terminou. Ele ficou salvo se quiser voltar.', cta: 'Terminar seu pedido', total: 'Subtotal', stop: 'Não receber mais lembretes' },
} as const;

async function sendReminder(store: StoreRow, row: Record<string, unknown>): Promise<'sent' | 'skipped' | 'failed'> {
  const id = String(row.id);
  const email = String(row.email);
  // Una sola vez por checkout, sin importar cuántas veces cambie el carrito.
  const claim = await claimShopEmail(store.workspace_id, email, 'abandoned', id);
  if (!claim.ok) return claim.reason === 'duplicate' ? 'skipped' : 'skipped';
  const c = COPY[(store.locale in COPY ? store.locale : 'en') as keyof typeof COPY];
  const brand = normalizeBrand(parseJson(store.brand, DEFAULT_BRAND));
  const token = String(row.token);
  const url = recoverUrl(store.handle, token);
  const stop = `${appUrl()}/api/shop/public/${store.handle}/unsubscribe?token=${encodeURIComponent(token)}`;
  const amount = formatMoney(Number(row.subtotal_cents), String(row.currency), store.locale);
  const logo = brand.logoUrl ? (brand.logoUrl.startsWith('/') ? `${appUrl()}${brand.logoUrl}` : brand.logoUrl) : null;
  // Texto fijo: el comercio no escribe nada de este email (sale con el remitente de la app).
  const html = renderBrandedHtml({
    heading: c.heading,
    paragraphs: [escapeHtml(c.lead), `<strong>${escapeHtml(c.total)}: ${escapeHtml(amount)}</strong>`, `<a href="${escapeHtml(url)}">${escapeHtml(c.cta)}</a>`, `<a href="${escapeHtml(stop)}">${escapeHtml(c.stop)}</a>`],
    brandColor: brand.accent,
    logoUrl: logo,
    eyebrow: store.name,
  });
  const res = await sendEmail({
    to: email,
    subject: c.subject,
    text: [c.lead, `${c.total}: ${amount}`, url, '', `${c.stop}: ${stop}`].join('\n'),
    html,
    from: namedSender(store.name),
    idempotencyKey: `shop:abandoned:${id}`,
    headers: { 'List-Unsubscribe': `<${stop}>`, 'List-Unsubscribe-Post': 'List-Unsubscribe=One-Click' },
    ...(store.contact_email ? { replyTo: store.contact_email } : {}),
  });
  if (!res.ok) {
    await releaseEmailClaim(claim.id);
    return 'failed';
  }
  return 'sent';
}

/** Recordatorio a mano desde la lista (mismos topes que el automático). */
export async function sendAbandonedReminder(actor: ShopActor, id: string): Promise<void> {
  const store = await getStore(actor.ws);
  if (!store) throw new ShopError('not_found', 404);
  const row = (await getDb().prepare("SELECT * FROM shop_checkouts WHERE id = ? AND workspace_id = ? AND status = 'open'").get(id, actor.ws)) as Record<string, unknown> | undefined;
  if (!row) throw new ShopError('not_found', 404);
  const claimed = await getDb().prepare("UPDATE shop_checkouts SET email_state = 'claimed' WHERE id = ? AND email_state != 'sent' AND email_state != 'claimed'").run(id);
  if (!claimed.changes) throw new ShopError('already_sent', 409);
  const outcome = await sendReminder(store, row);
  await getDb().prepare('UPDATE shop_checkouts SET email_state = ?, emailed_at = ? WHERE id = ?').run(outcome === 'sent' ? 'sent' : 'none', outcome === 'sent' ? nowDb() : null, id);
  if (outcome === 'skipped') throw new ShopError('email_limit', 429);
  if (outcome === 'failed') throw new ShopError('email_failed', 502);
}

export async function unsubscribeByToken(ws: string, token: string): Promise<boolean> {
  if (!/^[A-Za-z0-9_-]{16,64}$/.test(token)) return false;
  const r = (await getDb().prepare('SELECT email FROM shop_checkouts WHERE workspace_id = ? AND token = ?').get(ws, token)) as { email: string } | undefined;
  if (!r) return false;
  await optOut(ws, r.email);
  await getDb().prepare("UPDATE shop_checkouts SET email_state = 'optout' WHERE workspace_id = ? AND token = ? AND email_state != 'sent'").run(ws, token);
  return true;
}

/**
 * Cron: recordatorios vencidos, reclamando cada fila. Con tope por corrida,
 * por tienda (ninguna se come la corrida de las otras) y de tiempo, para no
 * quitarle su turno al resto del cron.
 */
export async function sendAbandonedEmails(now: Date = new Date(), opts: { perRun?: number; perStore?: number; budgetMs?: number } = {}): Promise<{ sent: number; purged: number }> {
  const db = getDb();
  const started = Date.now();
  const budget = opts.budgetMs ?? 20_000;
  const perStore = opts.perStore ?? 20;
  const perRun = opts.perRun ?? 100;
  const purge = await db.prepare('DELETE FROM shop_checkouts WHERE updated_at < ?').run(nowDb(new Date(now.getTime() - 30 * 86_400_000)));
  // Lo más viejo primero; 1 hora es el mínimo que admite la tienda, la de cada una se mira abajo.
  const rows = (await db
    .prepare("SELECT * FROM shop_checkouts WHERE status = 'open' AND email_state = 'none' AND updated_at <= ? ORDER BY updated_at ASC LIMIT ?")
    .all(nowDb(new Date(now.getTime() - 3_600_000)), perRun * 5)) as Array<Record<string, unknown>>;
  const perWs = new Map<string, number>();
  const stores = new Map<string, StoreRow | null>();
  let sent = 0;
  for (const row of rows) {
    if (sent >= perRun || Date.now() - started > budget) break;
    const ws = String(row.workspace_id);
    if ((perWs.get(ws) ?? 0) >= perStore) continue;
    if (!stores.has(ws)) stores.set(ws, await getStore(ws));
    const store = stores.get(ws);
    if (!store || store.published !== 1) continue;
    const settings = normalizeSettings(parseJson(store.settings, {}));
    if (!settings.emailAbandoned) continue;
    const due = Date.parse(`${String(row.updated_at).replace(' ', 'T')}Z`) + settings.abandonedHours * 3_600_000;
    if (due > now.getTime()) continue;
    const id = String(row.id);
    const claimed = await db.prepare("UPDATE shop_checkouts SET email_state = 'claimed' WHERE id = ? AND email_state = 'none'").run(id);
    if (!claimed.changes) continue;
    perWs.set(ws, (perWs.get(ws) ?? 0) + 1);
    const outcome = await sendReminder(store, row).catch(() => 'failed' as const);
    // Topado o fallado no se reintenta en loop: un recordatorio tarde ya no sirve.
    await db.prepare('UPDATE shop_checkouts SET email_state = ?, emailed_at = ? WHERE id = ?').run(outcome === 'sent' ? 'sent' : 'skipped', outcome === 'sent' ? nowDb(now) : null, id);
    if (outcome === 'sent') sent++;
  }
  return { sent, purged: purge.changes };
}
