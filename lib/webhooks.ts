import { createHmac, randomBytes } from 'crypto';
import { getDb } from './db';
import { safeFetch, UnsafeUrlError, assertPublicUrl } from './safe-fetch';
import { open, seal } from './secret-box';

/**
 * Webhooks salientes por workspace. Cada evento se guarda como entrega
 * (webhook_deliveries) y se intenta al instante; si falla, el cron reintenta con
 * backoff (1m, 5m, 30m, 2h, 12h) y después queda como `failed`.
 *
 * Firma (estilo Stripe): header `Zerosoft-Signature: t=<unix>,v1=<hex>` donde
 * v1 = HMAC-SHA256(secret, `${t}.${body}`). Verificar con el secret `whsec_…`.
 */

export const WEBHOOK_EVENTS = [
  'booking.created',
  'booking.rescheduled',
  'booking.cancelled',
  'link.created',
  'link.clicked',
] as const;
export type WebhookEvent = (typeof WEBHOOK_EVENTS)[number];

export interface WebhookRow {
  id: string;
  user_id: string;
  url: string;
  events: string;
  secret: string;
  active: number;
  created_by: string | null;
  created_at: string;
}

export interface WebhookDto {
  id: string;
  url: string;
  events: WebhookEvent[];
  active: boolean;
  createdAt: string;
  lastDelivery: { status: string; responseCode: number | null; at: string } | null;
}

const BACKOFF_MS = [60_000, 5 * 60_000, 30 * 60_000, 2 * 3_600_000, 12 * 3_600_000];

function parseEvents(raw: string): WebhookEvent[] {
  try {
    const v = JSON.parse(raw) as unknown;
    return Array.isArray(v) ? (v.filter((e) => WEBHOOK_EVENTS.includes(e as WebhookEvent)) as WebhookEvent[]) : [];
  } catch {
    return [];
  }
}

export function signPayload(secret: string, body: string, timestamp = Math.floor(Date.now() / 1000)): string {
  const v1 = createHmac('sha256', secret).update(`${timestamp}.${body}`).digest('hex');
  return `t=${timestamp},v1=${v1}`;
}

// ---------- CRUD ----------

export async function listWebhooks(userId: string): Promise<WebhookDto[]> {
  const rows = (await getDb()
    .prepare('SELECT * FROM webhooks WHERE user_id = ? ORDER BY created_at DESC')
    .all(userId)) as WebhookRow[];
  const out: WebhookDto[] = [];
  for (const r of rows) {
    const last = (await getDb()
      .prepare(
        'SELECT status, response_code, created_at FROM webhook_deliveries WHERE webhook_id = ? ORDER BY created_at DESC LIMIT 1',
      )
      .get(r.id)) as { status: string; response_code: number | null; created_at: string } | undefined;
    out.push({
      id: r.id,
      url: r.url,
      events: parseEvents(r.events),
      active: r.active === 1,
      createdAt: r.created_at,
      lastDelivery: last ? { status: last.status, responseCode: last.response_code, at: last.created_at } : null,
    });
  }
  return out;
}

/** Crea el webhook y devuelve el secret en claro (se muestra una sola vez). */
export async function createWebhook(
  userId: string,
  input: { url: string; events: WebhookEvent[]; createdBy?: string },
): Promise<{ id: string; secret: string }> {
  await assertPublicUrl(input.url);
  const id = crypto.randomUUID();
  const secret = `whsec_${randomBytes(24).toString('base64url')}`;
  await getDb()
    .prepare('INSERT INTO webhooks (id, user_id, url, events, secret, created_by) VALUES (?, ?, ?, ?, ?, ?)')
    .run(id, userId, input.url, JSON.stringify(input.events), seal(secret), input.createdBy ?? userId);
  return { id, secret };
}

export async function deleteWebhook(userId: string, id: string): Promise<boolean> {
  const res = await getDb().prepare('DELETE FROM webhooks WHERE id = ? AND user_id = ?').run(id, userId);
  return res.changes > 0;
}

// ---------- Delivery ----------

async function attempt(deliveryId: string): Promise<void> {
  const db = getDb();
  const row = (await db
    .prepare(
      `SELECT d.*, w.url, w.secret, w.active FROM webhook_deliveries d
       JOIN webhooks w ON w.id = d.webhook_id WHERE d.id = ?`,
    )
    .get(deliveryId)) as
    | { id: string; payload: string; attempts: number; url: string; secret: string; active: number; event: string }
    | undefined;
  if (!row || row.active !== 1) return;

  const attempts = row.attempts + 1;
  let code: number | null = null;
  let error: string | null = null;
  try {
    const res = await safeFetch(row.url, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'user-agent': 'Zerosoft-Webhooks/1',
        'zerosoft-event': row.event,
        'zerosoft-delivery': row.id,
        'zerosoft-signature': signPayload(open(row.secret), row.payload),
      },
      body: row.payload,
    });
    code = res.status;
    if (!res.ok) error = `http_${res.status}`;
  } catch (err) {
    error = err instanceof UnsafeUrlError ? err.message : err instanceof Error ? err.name : 'error';
  }

  if (!error) {
    await db
      .prepare(
        "UPDATE webhook_deliveries SET status = 'delivered', attempts = ?, response_code = ?, last_error = NULL, delivered_at = ?, next_attempt_at = NULL WHERE id = ?",
      )
      .run(attempts, code, new Date().toISOString(), row.id);
    return;
  }
  const delay = BACKOFF_MS[attempts - 1];
  await db
    .prepare(
      'UPDATE webhook_deliveries SET status = ?, attempts = ?, response_code = ?, last_error = ?, next_attempt_at = ? WHERE id = ?',
    )
    .run(
      delay === undefined ? 'failed' : 'pending',
      attempts,
      code,
      error,
      delay === undefined ? null : new Date(Date.now() + delay).toISOString(),
      row.id,
    );
}

/**
 * Emite un evento a los webhooks activos del workspace suscriptos a él. Intenta
 * la entrega en el momento (con timeout); nunca lanza.
 */
export async function emitWebhook(userId: string, event: WebhookEvent, data: unknown): Promise<void> {
  try {
    const hooks = (await getDb()
      .prepare('SELECT id, events FROM webhooks WHERE user_id = ? AND active = 1')
      .all(userId)) as Array<{ id: string; events: string }>;
    const targets = hooks.filter((h) => parseEvents(h.events).includes(event));
    if (targets.length === 0) return;
    const payload = JSON.stringify({ id: crypto.randomUUID(), type: event, createdAt: new Date().toISOString(), data });
    const ids: string[] = [];
    for (const h of targets) {
      const id = crypto.randomUUID();
      ids.push(id);
      await getDb()
        .prepare('INSERT INTO webhook_deliveries (id, webhook_id, event, payload) VALUES (?, ?, ?, ?)')
        .run(id, h.id, event, payload);
    }
    await Promise.all(ids.map((id) => attempt(id).catch(() => {})));
  } catch (err) {
    // eslint-disable-next-line no-console
    console.error('[webhooks] emit failed', err);
  }
}

/** Reintentos vencidos (lo llama el cron). */
export async function retryDueWebhooks(limit = 50): Promise<number> {
  const due = (await getDb()
    .prepare(
      `SELECT id FROM webhook_deliveries
       WHERE status = 'pending'
         AND ((attempts > 0 AND next_attempt_at <= ?) OR (attempts = 0 AND created_at <= datetime('now', '-2 minutes')))
       ORDER BY created_at LIMIT ?`,
    )
    .all(new Date().toISOString(), limit)) as Array<{ id: string }>;
  for (const d of due) await attempt(d.id).catch(() => {});
  return due.length;
}

/** Entrega de prueba para el botón "Enviar prueba" del panel. */
export async function sendTestWebhook(userId: string, id: string): Promise<boolean> {
  const hook = (await getDb().prepare('SELECT * FROM webhooks WHERE id = ? AND user_id = ?').get(id, userId)) as
    | WebhookRow
    | undefined;
  if (!hook) return false;
  const deliveryId = crypto.randomUUID();
  const payload = JSON.stringify({ id: crypto.randomUUID(), type: 'ping', createdAt: new Date().toISOString(), data: {} });
  await getDb()
    .prepare('INSERT INTO webhook_deliveries (id, webhook_id, event, payload) VALUES (?, ?, ?, ?)')
    .run(deliveryId, hook.id, 'ping', payload);
  await attempt(deliveryId);
  return true;
}
