import { createHmac, randomBytes } from 'crypto';
import { getDb } from './db';
import { safeFetch, UnsafeUrlError, assertPublicUrl } from './safe-fetch';
import { open, seal } from './secret-box';
import {
  linkScopeOf,
  matchesLinkFilter,
  parseLinkFilter,
  WEBHOOK_EVENTS,
  type LinkWebhookFilter,
  type WebhookEvent,
} from './webhooks-events';

export { WEBHOOK_EVENTS, type WebhookEvent };

/**
 * Webhooks salientes por workspace. Cada evento se guarda como entrega
 * (webhook_deliveries) y se intenta al instante; si falla, el cron reintenta con
 * backoff (1m, 5m, 30m, 2h, 12h) y después queda como `failed`.
 *
 * Firma (estilo Stripe): header `Zerosoft-Signature: t=<unix>,v1=<hex>` donde
 * v1 = HMAC-SHA256(secret, `${t}.${body}`). Verificar con el secret `whsec_…`.
 */

export interface WebhookRow {
  id: string;
  user_id: string;
  url: string;
  events: string;
  secret: string;
  active: number;
  created_by: string | null;
  /** JSON LinkWebhookFilter para los eventos link.* (null = todos los links). */
  filters?: string | null;
  created_at: string;
}

export interface WebhookDto {
  id: string;
  url: string;
  events: WebhookEvent[];
  active: boolean;
  /** Filtro de los eventos link.*, con el slug de cada link para mostrarlo. */
  linkFilter: { links: Array<{ id: string; slug: string | null }>; tags: string[]; domains: string[] } | null;
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
    const filter = parseLinkFilter(r.filters);
    let linkFilter: WebhookDto['linkFilter'] = null;
    if (filter) {
      const slugs = new Map<string, string>();
      if (filter.linkIds.length) {
        const ph = filter.linkIds.map(() => '?').join(',');
        const found = (await getDb()
          .prepare(`SELECT id, slug FROM links WHERE user_id = ? AND id IN (${ph})`)
          .all(userId, ...filter.linkIds)) as Array<{ id: string; slug: string }>;
        for (const l of found) slugs.set(l.id, l.slug);
      }
      linkFilter = {
        // Un link borrado queda en el filtro (slug null): el webhook no vuelve a "todos".
        links: filter.linkIds.map((id) => ({ id, slug: slugs.get(id) ?? null })),
        tags: filter.tags,
        domains: filter.domains,
      };
    }
    out.push({
      id: r.id,
      url: r.url,
      events: parseEvents(r.events),
      active: r.active === 1,
      linkFilter,
      createdAt: r.created_at,
      lastDelivery: last ? { status: last.status, responseCode: last.response_code, at: last.created_at } : null,
    });
  }
  return out;
}

/** Crea el webhook y devuelve el secret en claro (se muestra una sola vez). */
export async function createWebhook(
  userId: string,
  input: { url: string; events: WebhookEvent[]; createdBy?: string; linkFilter?: LinkWebhookFilter | null },
): Promise<{ id: string; secret: string }> {
  await assertPublicUrl(input.url);
  const id = crypto.randomUUID();
  const secret = `whsec_${randomBytes(24).toString('base64url')}`;
  await getDb()
    .prepare('INSERT INTO webhooks (id, user_id, url, events, secret, created_by, filters) VALUES (?, ?, ?, ?, ?, ?, ?)')
    .run(
      id,
      userId,
      input.url,
      JSON.stringify(input.events),
      seal(secret),
      input.createdBy ?? userId,
      input.linkFilter ? JSON.stringify(input.linkFilter) : null,
    );
  return { id, secret };
}

export async function deleteWebhook(userId: string, id: string): Promise<boolean> {
  const res = await getDb().prepare('DELETE FROM webhooks WHERE id = ? AND user_id = ?').run(id, userId);
  return res.changes > 0;
}

// ---------- Delivery ----------

/**
 * Reclama la entrega (compare-and-set de locked_until) para que el cron de
 * cada minuto y un emit en curso no la manden dos veces a la vez.
 */
async function claimDelivery(deliveryId: string): Promise<boolean> {
  const now = new Date();
  const res = await getDb()
    .prepare(
      `UPDATE webhook_deliveries SET locked_until = ?
       WHERE id = ? AND status = 'pending' AND (locked_until IS NULL OR locked_until < ?)`,
    )
    .run(new Date(now.getTime() + 60_000).toISOString(), deliveryId, now.toISOString());
  return res.changes > 0;
}

async function attempt(deliveryId: string): Promise<void> {
  const db = getDb();
  if (!(await claimDelivery(deliveryId))) return;
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
        "UPDATE webhook_deliveries SET status = 'delivered', attempts = ?, response_code = ?, last_error = NULL, delivered_at = ?, next_attempt_at = NULL, locked_until = NULL WHERE id = ?",
      )
      .run(attempts, code, new Date().toISOString(), row.id);
    return;
  }
  const delay = BACKOFF_MS[attempts - 1];
  await db
    .prepare(
      'UPDATE webhook_deliveries SET status = ?, attempts = ?, response_code = ?, last_error = ?, next_attempt_at = ?, locked_until = NULL WHERE id = ?',
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
 * Emite un evento a los webhooks activos del workspace suscriptos a él. En los
 * eventos link.* respeta el filtro de links de cada webhook. Intenta la
 * entrega en el momento (con timeout); nunca lanza.
 */
export async function emitWebhook(userId: string, event: WebhookEvent, data: unknown): Promise<void> {
  try {
    const hooks = (await getDb()
      .prepare('SELECT id, events, filters FROM webhooks WHERE user_id = ? AND active = 1')
      .all(userId)) as Array<{ id: string; events: string; filters: string | null }>;
    const scope = event.startsWith('link.') ? linkScopeOf(data) : null;
    const targets = hooks.filter(
      (h) =>
        parseEvents(h.events).includes(event) && (!event.startsWith('link.') || matchesLinkFilter(parseLinkFilter(h.filters), scope)),
    );
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

// ---------- Log de entregas ----------

export interface WebhookDeliveryDto {
  id: string;
  event: string;
  status: string;
  attempts: number;
  responseCode: number | null;
  error: string | null;
  createdAt: string;
  deliveredAt: string | null;
  nextAttemptAt: string | null;
}

/** Últimas entregas de un webhook del workspace (null si el webhook no es suyo). */
export async function listWebhookDeliveries(userId: string, webhookId: string, limit = 25): Promise<WebhookDeliveryDto[] | null> {
  const hook = await getDb().prepare('SELECT id FROM webhooks WHERE id = ? AND user_id = ?').get(webhookId, userId);
  if (!hook) return null;
  const rows = (await getDb()
    .prepare(
      `SELECT id, event, status, attempts, response_code, last_error, created_at, delivered_at, next_attempt_at
       FROM webhook_deliveries WHERE webhook_id = ? ORDER BY created_at DESC LIMIT ?`,
    )
    .all(webhookId, Math.min(Math.max(limit, 1), 100))) as Array<{
    id: string;
    event: string;
    status: string;
    attempts: number;
    response_code: number | null;
    last_error: string | null;
    created_at: string;
    delivered_at: string | null;
    next_attempt_at: string | null;
  }>;
  return rows.map((r) => ({
    id: r.id,
    event: r.event,
    status: r.status,
    attempts: r.attempts,
    responseCode: r.response_code,
    error: r.last_error,
    createdAt: r.created_at,
    deliveredAt: r.delivered_at,
    nextAttemptAt: r.next_attempt_at,
  }));
}

/** Reenvía una entrega (fallida o entregada) como una nueva, con el mismo payload. */
export async function redeliverWebhook(userId: string, webhookId: string, deliveryId: string): Promise<boolean> {
  const row = (await getDb()
    .prepare(
      `SELECT d.event, d.payload FROM webhook_deliveries d JOIN webhooks w ON w.id = d.webhook_id
       WHERE d.id = ? AND d.webhook_id = ? AND w.user_id = ?`,
    )
    .get(deliveryId, webhookId, userId)) as { event: string; payload: string } | undefined;
  if (!row) return false;
  const id = crypto.randomUUID();
  await getDb()
    .prepare('INSERT INTO webhook_deliveries (id, webhook_id, event, payload) VALUES (?, ?, ?, ?)')
    .run(id, webhookId, row.event, row.payload);
  await attempt(id);
  return true;
}
