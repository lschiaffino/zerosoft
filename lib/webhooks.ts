import { createHmac, randomBytes } from 'crypto';
import { getDb } from './db';
import { safeFetch, UnsafeUrlError, assertPublicUrl } from './safe-fetch';
import { open, seal } from './secret-box';
import {
  linkScopeOf,
  matchesCrmFilter,
  matchesLinkFilter,
  parseCrmFilter,
  parseLinkFilter,
  WEBHOOK_EVENTS,
  type CrmWebhookFilter,
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
  /** JSON CrmWebhookFilter para los eventos *.property_changed (null = todas las propiedades). */
  crm_filter?: string | null;
  created_at: string;
}

export interface WebhookDto {
  id: string;
  url: string;
  events: WebhookEvent[];
  active: boolean;
  /** Filtro de los eventos link.*, con el slug de cada link para mostrarlo. */
  linkFilter: { links: Array<{ id: string; slug: string | null }>; tags: string[]; domains: string[] } | null;
  /** Propiedades a las que se limita *.property_changed (vacío = todas). */
  properties: string[];
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
      properties: parseCrmFilter(r.crm_filter)?.properties ?? [],
      createdAt: r.created_at,
      lastDelivery: last ? { status: last.status, responseCode: last.response_code, at: last.created_at } : null,
    });
  }
  return out;
}

/** Crea el webhook y devuelve el secret en claro (se muestra una sola vez). */
export async function createWebhook(
  userId: string,
  input: {
    url: string;
    events: WebhookEvent[];
    createdBy?: string;
    linkFilter?: LinkWebhookFilter | null;
    crmFilter?: CrmWebhookFilter | null;
  },
): Promise<{ id: string; secret: string }> {
  await assertPublicUrl(input.url);
  const id = crypto.randomUUID();
  const secret = `whsec_${randomBytes(24).toString('base64url')}`;
  await getDb()
    .prepare(
      'INSERT INTO webhooks (id, user_id, url, events, secret, created_by, filters, crm_filter) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
    )
    .run(
      id,
      userId,
      input.url,
      JSON.stringify(input.events),
      seal(secret),
      input.createdBy ?? userId,
      input.linkFilter ? JSON.stringify(input.linkFilter) : null,
      input.crmFilter ? JSON.stringify(input.crmFilter) : null,
    );
  return { id, secret };
}

/** Pausa/reanuda o cambia URL, eventos o filtro de propiedades. false si no es del workspace. */
export async function updateWebhook(
  userId: string,
  id: string,
  patch: { active?: boolean; url?: string; events?: WebhookEvent[]; crmFilter?: CrmWebhookFilter | null },
  /** Persona que cambia: si cambia URL o eventos de un webhook de otra, pasa a ser suyo (los filtros usan su acceso). */
  actorId?: string,
): Promise<boolean> {
  const sets: string[] = [];
  const args: Array<string | number | null> = [];
  if (actorId && (patch.url !== undefined || patch.events !== undefined)) {
    const cur = (await getDb().prepare('SELECT created_by, url, events FROM webhooks WHERE id = ? AND user_id = ?').get(id, userId)) as
      | { created_by: string | null; url: string; events: string }
      | undefined;
    const changes = cur && ((patch.url !== undefined && patch.url !== cur.url) || (patch.events !== undefined && JSON.stringify(patch.events) !== cur.events));
    if (cur && changes && cur.created_by !== actorId) {
      sets.push('created_by = ?');
      args.push(actorId);
    }
  }
  if (patch.url !== undefined) {
    await assertPublicUrl(patch.url);
    sets.push('url = ?');
    args.push(patch.url);
  }
  if (patch.active !== undefined) {
    sets.push('active = ?');
    args.push(patch.active ? 1 : 0);
  }
  if (patch.events !== undefined) {
    sets.push('events = ?');
    args.push(JSON.stringify(patch.events));
  }
  if (patch.crmFilter !== undefined) {
    sets.push('crm_filter = ?');
    args.push(patch.crmFilter ? JSON.stringify(patch.crmFilter) : null);
  }
  if (!sets.length) {
    return !!(await getDb().prepare('SELECT 1 FROM webhooks WHERE id = ? AND user_id = ?').get(id, userId));
  }
  const res = await getDb()
    .prepare(`UPDATE webhooks SET ${sets.join(', ')} WHERE id = ? AND user_id = ?`)
    .run(...args, id, userId);
  return res.changes > 0;
}

// ---------- Log de entregas ----------

export interface WebhookDeliveryDto {
  id: string;
  event: string;
  status: 'pending' | 'delivered' | 'failed';
  attempts: number;
  responseCode: number | null;
  responseBody: string;
  error: string | null;
  durationMs: number | null;
  nextAttemptAt: string | null;
  createdAt: string;
  deliveredAt: string | null;
  payload: string;
  /** El cuerpo se armó con el acceso de quien creó el webhook: solo lo ve esa persona. */
  payloadHidden?: boolean;
}

/** Últimas entregas de un webhook del workspace (más nueva primero). null si el webhook no es suyo. */
/**
 * Eventos cuyo contenido se arma con el acceso de quien creó el webhook
 * (Docs con teamspaces privados, canales privados): su cuerpo solo lo ve esa persona.
 */
export function isRestrictedEvent(event: string): boolean {
  return event.startsWith('page.') || event.startsWith('database.') || event.startsWith('talk.');
}

export async function listDeliveries(userId: string, webhookId: string, limit = 50, viewerId?: string): Promise<WebhookDeliveryDto[] | null> {
  const owns = (await getDb().prepare('SELECT created_by FROM webhooks WHERE id = ? AND user_id = ?').get(webhookId, userId)) as
    | { created_by: string | null }
    | undefined;
  if (!owns) return null;
  const hide = (event: string) => viewerId !== undefined && isRestrictedEvent(event) && owns.created_by !== viewerId;
  const rows = (await getDb()
    .prepare(
      `SELECT id, event, status, attempts, response_code, response_body, last_error, duration_ms, next_attempt_at,
              created_at, delivered_at, payload
       FROM webhook_deliveries WHERE webhook_id = ? ORDER BY created_at DESC, rowid DESC LIMIT ?`,
    )
    .all(webhookId, Math.min(Math.max(limit, 1), 200))) as Array<Record<string, unknown>>;
  return rows.map((r) => ({
    id: String(r.id),
    event: String(r.event),
    status: r.status as WebhookDeliveryDto['status'],
    attempts: Number(r.attempts),
    responseCode: r.response_code == null ? null : Number(r.response_code),
    // El endpoint puede devolver el cuerpo: también se oculta.
    responseBody: hide(String(r.event)) ? '' : String(r.response_body ?? ''),
    error: (r.last_error as string | null) ?? null,
    durationMs: r.duration_ms == null ? null : Number(r.duration_ms),
    nextAttemptAt: (r.next_attempt_at as string | null) ?? null,
    createdAt: String(r.created_at),
    deliveredAt: (r.delivered_at as string | null) ?? null,
    payload: hide(String(r.event)) ? '' : String(r.payload),
    ...(hide(String(r.event)) ? { payloadHidden: true } : {}),
  }));
}

/**
 * Reenvía una entrega (como "Resend" en HubSpot o Stripe): una entrega nueva
 * con el mismo cuerpo, que se intenta en el momento. Devuelve su id, o null si
 * la entrega no es de un webhook del workspace.
 */
export async function resendDelivery(userId: string, deliveryId: string): Promise<string | null> {
  const row = (await getDb()
    .prepare(
      `SELECT d.webhook_id, d.event, d.payload FROM webhook_deliveries d JOIN webhooks w ON w.id = d.webhook_id
       WHERE d.id = ? AND w.user_id = ?`,
    )
    .get(deliveryId, userId)) as { webhook_id: string; event: string; payload: string } | undefined;
  if (!row) return null;
  const id = crypto.randomUUID();
  await insertDelivery(id, row.webhook_id, row.event, row.payload);
  await attempt(id, { force: true });
  return id;
}

export async function deleteWebhook(userId: string, id: string): Promise<boolean> {
  const res = await getDb().prepare('DELETE FROM webhooks WHERE id = ? AND user_id = ?').run(id, userId);
  return res.changes > 0;
}

// ---------- Delivery ----------

/** Mientras una entrega se intenta, el cron no la toma (claim por fila). */
const CLAIM_MS = 2 * 60_000;

async function insertDelivery(id: string, webhookId: string, event: string, payload: string): Promise<void> {
  // Nace reclamada: la tiene el intento inmediato; si el proceso muere, el claim vence y la toma el cron.
  await getDb()
    .prepare('INSERT INTO webhook_deliveries (id, webhook_id, event, payload, claimed_until) VALUES (?, ?, ?, ?, ?)')
    .run(id, webhookId, event, payload, new Date(Date.now() + CLAIM_MS).toISOString());
}

/**
 * Compare-and-set del claim: solo una corrida del cron intenta cada entrega
 * pendiente y todavía vencida (si otra corrida ya la intentó, su próximo
 * intento quedó en el futuro y acá no se toma). true si esta corrida la tomó.
 */
export async function claimDelivery(deliveryId: string, now = new Date()): Promise<boolean> {
  const res = await getDb()
    .prepare(
      `UPDATE webhook_deliveries SET claimed_until = ?
       WHERE id = ? AND status = 'pending' AND (claimed_until IS NULL OR claimed_until < ?)
         AND (next_attempt_at IS NULL OR next_attempt_at <= ?)`,
    )
    .run(new Date(now.getTime() + CLAIM_MS).toISOString(), deliveryId, now.toISOString(), now.toISOString());
  return res.changes > 0;
}

/** Recorta la respuesta del endpoint para el log (texto, 1 KB). */
export function responseSnippet(text: string): string {
  return text.replace(/\s+/g, ' ').trim().slice(0, 1000);
}

async function attempt(deliveryId: string, opts: { force?: boolean } = {}): Promise<void> {
  const db = getDb();
  const row = (await db
    .prepare(
      `SELECT d.*, w.url, w.secret, w.active, w.user_id AS w_user, w.created_by AS w_creator FROM webhook_deliveries d
       JOIN webhooks w ON w.id = d.webhook_id WHERE d.id = ?`,
    )
    .get(deliveryId)) as
    | { id: string; payload: string; attempts: number; url: string; secret: string; active: number; event: string; w_user: string; w_creator: string | null }
    | undefined;
  // Un webhook pausado no envía (salvo prueba o reenvío manual): la entrega queda pendiente.
  if (!row || (row.active !== 1 && !opts.force)) {
    await db.prepare('UPDATE webhook_deliveries SET claimed_until = NULL WHERE id = ?').run(deliveryId);
    return;
  }

  // Contenido restringido (Docs, Talk): se capturó con el acceso de una
  // persona. Al reintentar o reenviar se vuelve a chequear que quien creó el
  // webhook todavía pueda verlo, y que sea la misma persona con cuyo acceso
  // se capturó (si el webhook pasó a otra, no se le manda lo de antes).
  if (isRestrictedEvent(row.event)) {
    let data: unknown = null;
    try {
      data = (JSON.parse(row.payload) as { data?: unknown }).data;
    } catch {
      /* sin datos */
    }
    const capturedBy = (row as { captured_by?: string | null }).captured_by;
    let allowed = !capturedBy || capturedBy === row.w_creator;
    if (allowed && row.event.startsWith('talk.')) {
      const { talkDeliveryAllowed } = await import('./talk');
      allowed = await talkDeliveryAllowed(row.w_user, row.w_creator, data);
    } else if (allowed) {
      const pageId = String((data as { page?: { id?: string } } | null)?.page?.id ?? '');
      const { docsDeliveryAllowed } = await import('./docs-events');
      allowed = await docsDeliveryAllowed(row.w_user, row.w_creator, pageId);
    }
    if (!allowed) {
      await db
        .prepare("UPDATE webhook_deliveries SET status = 'failed', last_error = 'audience_revoked', next_attempt_at = NULL, claimed_until = NULL WHERE id = ?")
        .run(row.id);
      return;
    }
  }

  const attempts = row.attempts + 1;
  let code: number | null = null;
  let error: string | null = null;
  let body = '';
  const started = Date.now();
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
    body = responseSnippet(await res.text().catch(() => ''));
    if (!res.ok) error = `http_${res.status}`;
  } catch (err) {
    error = deliveryErrorCode(err);
  }
  const duration = Date.now() - started;

  if (!error) {
    await db
      .prepare(
        `UPDATE webhook_deliveries SET status = 'delivered', attempts = ?, response_code = ?, response_body = ?, duration_ms = ?,
           last_error = NULL, delivered_at = ?, next_attempt_at = NULL, claimed_until = NULL WHERE id = ?`,
      )
      .run(attempts, code, body, duration, new Date().toISOString(), row.id);
    return;
  }
  const delay = BACKOFF_MS[attempts - 1];
  await db
    .prepare(
      `UPDATE webhook_deliveries SET status = ?, attempts = ?, response_code = ?, response_body = ?, duration_ms = ?,
         last_error = ?, next_attempt_at = ?, claimed_until = NULL WHERE id = ?`,
    )
    .run(
      delay === undefined ? 'failed' : 'pending',
      attempts,
      code,
      body,
      duration,
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
export async function emitWebhook(
  userId: string,
  event: WebhookEvent,
  data: unknown,
  audience?: (creatorId: string | null) => Promise<boolean>,
  personalize?: (creatorId: string | null) => Promise<{ data: Record<string, unknown> } | null>,
): Promise<void> {
  try {
    let hooks = (await getDb()
      .prepare('SELECT id, events, filters, crm_filter, created_by FROM webhooks WHERE user_id = ? AND active = 1')
      .all(userId)) as Array<{ id: string; events: string; filters: string | null; crm_filter: string | null; created_by: string | null }>;
    // Contenido restringido: solo los webhooks de quien puede verlo.
    if (audience) {
      const allowed: typeof hooks = [];
      for (const h of hooks) if (parseEvents(h.events).includes(event) && (await audience(h.created_by))) allowed.push(h);
      hooks = allowed;
    }
    const scope = event.startsWith('link.') ? linkScopeOf(data) : null;
    const targets = hooks.filter(
      (h) =>
        parseEvents(h.events).includes(event) &&
        (!event.startsWith('link.') || matchesLinkFilter(parseLinkFilter(h.filters), scope)) &&
        matchesCrmFilter(parseCrmFilter(h.crm_filter), event, data),
    );
    if (targets.length === 0) return;
    const eventId = crypto.randomUUID();
    const createdAt = new Date().toISOString();
    const shared = personalize ? null : JSON.stringify({ id: eventId, type: event, createdAt, data });
    const ids: string[] = [];
    for (const h of targets) {
      let payload = shared;
      if (personalize) {
        // Cada webhook recibe solo lo que ve la persona que lo creó (o nada).
        const own = await personalize(h.created_by);
        if (!own) continue;
        payload = JSON.stringify({ id: eventId, type: event, createdAt, data: own.data });
      }
      const id = crypto.randomUUID();
      ids.push(id);
      await insertDelivery(id, h.id, event, payload!);
    }
    await Promise.all(ids.map((id) => attempt(id).catch(() => {})));
  } catch (err) {
    // eslint-disable-next-line no-console
    console.error('[webhooks] emit failed', err);
  }
}

/**
 * Reintentos vencidos (cron de cada minuto y tick horario). Cada entrega se
 * reclama con compare-and-set antes de intentarla: dos corridas a la vez no
 * mandan la misma entrega dos veces.
 */
export async function retryDueWebhooks(limit = 50, now = new Date()): Promise<number> {
  const iso = now.toISOString();
  const due = (await getDb()
    .prepare(
      `SELECT id FROM webhook_deliveries
       WHERE status = 'pending' AND (claimed_until IS NULL OR claimed_until < ?)
         AND ((attempts > 0 AND next_attempt_at <= ?) OR (attempts = 0 AND created_at <= datetime('now', '-2 minutes')))
       ORDER BY created_at LIMIT ?`,
    )
    .all(iso, iso, limit)) as Array<{ id: string }>;
  let sent = 0;
  for (const d of due) {
    if (!(await claimDelivery(d.id, now))) continue;
    sent++;
    await attempt(d.id).catch(() => {});
  }
  return sent;
}

/** Entrega de prueba para el botón "Enviar prueba" del panel. */
export async function sendTestWebhook(userId: string, id: string): Promise<boolean> {
  const hook = (await getDb().prepare('SELECT * FROM webhooks WHERE id = ? AND user_id = ?').get(id, userId)) as
    | WebhookRow
    | undefined;
  if (!hook) return false;
  const deliveryId = crypto.randomUUID();
  const payload = JSON.stringify({ id: crypto.randomUUID(), type: 'ping', createdAt: new Date().toISOString(), data: {} });
  await insertDelivery(deliveryId, hook.id, 'ping', payload);
  await attempt(deliveryId, { force: true });
  return true;
}

/**
 * Código legible de por qué falló una entrega (sin "TypeError"): el log lo
 * traduce (webhookErrors.<código>) y la API lo devuelve tal cual.
 */
export function deliveryErrorCode(err: unknown): string {
  if (err instanceof UnsafeUrlError) return err.message;
  if (!(err instanceof Error)) return 'network_error';
  if (err.name === 'TimeoutError' || err.name === 'AbortError') return 'timeout';
  const cause = (err as Error & { cause?: { code?: string } }).cause;
  const code = String(cause?.code ?? (err as Error & { code?: string }).code ?? '');
  if (code === 'ECONNREFUSED') return 'connection_refused';
  if (code === 'ENOTFOUND' || code === 'EAI_AGAIN') return 'unresolvable_host';
  if (code === 'ECONNRESET' || code === 'UND_ERR_SOCKET' || code === 'EPIPE') return 'connection_reset';
  if (code === 'ETIMEDOUT' || code === 'UND_ERR_CONNECT_TIMEOUT' || code === 'UND_ERR_HEADERS_TIMEOUT') return 'timeout';
  if (/CERT|SSL|TLS/i.test(code)) return 'tls_error';
  return 'network_error';
}
