/**
 * Chat — campañas por email a las personas de un widget. Borrador, envío (foto
 * de destinatarios, sin repetir email ni dados de baja) y cron que reclama cada
 * destinatario con compare-and-set para que dos corridas no manden dos veces.
 * Cada email lleva su link de baja firmado. Solo llega a quien dio su
 * consentimiento: lo marca un admin o lo manda el sitio con identidad firmada.
 * Server-only.
 */
import { createHmac, timingSafeEqual } from 'crypto';
import { getDb } from './db';
import { ChatCollabError } from './chat-collab';
import { escapeHtml, renderBrandedHtml, sendEmail } from './email';

export const CAMPAIGN_AUDIENCES = ['all', 'verified'] as const;
export const CAMPAIGN_MAX_RECIPIENTS = 5000;

export interface ChatCampaign {
  id: string;
  workspace_id: string;
  widget_id: string;
  name: string;
  subject: string;
  body: string;
  audience: string;
  status: 'draft' | 'preparing' | 'sending' | 'sent';
  total: number;
  sent: number;
  failed: number;
  sent_at: string | null;
  created_at: string;
  updated_at: string;
}

/** Audiencia válida: all, verified o company:<id>. */
export function cleanAudience(raw: unknown): string {
  if (typeof raw === 'string' && ((CAMPAIGN_AUDIENCES as readonly string[]).includes(raw) || /^company:[\w-]{1,64}$/.test(raw))) return raw;
  throw new ChatCollabError('invalid_input');
}

interface Input {
  name?: unknown;
  subject?: unknown;
  body?: unknown;
  audience?: unknown;
  widget_id?: unknown;
}

const str = (v: unknown, max: number) => (typeof v === 'string' ? v.trim().slice(0, max) : '');

/** Pendientes de una campaña en curso (para mostrar cuántos esperan cupo). */
export async function campaignPending(campaignId: string): Promise<number> {
  const row = (await getDb().prepare("SELECT COUNT(*) AS n FROM chat_campaign_recipients WHERE campaign_id = ? AND status IN ('pending', 'claimed')").get(campaignId)) as { n: number };
  return Number(row.n);
}

export async function listCampaigns(workspaceId: string, widgetIds: string[]): Promise<ChatCampaign[]> {
  if (widgetIds.length === 0) return [];
  return (await getDb()
    .prepare(`SELECT * FROM chat_campaigns WHERE workspace_id = ? AND widget_id IN (${widgetIds.map(() => '?').join(', ')}) ORDER BY created_at DESC LIMIT 200`)
    .all(workspaceId, ...widgetIds)) as ChatCampaign[];
}

export async function getCampaign(workspaceId: string, id: string): Promise<ChatCampaign | null> {
  return ((await getDb().prepare('SELECT * FROM chat_campaigns WHERE workspace_id = ? AND id = ?').get(workspaceId, id)) as ChatCampaign | undefined) ?? null;
}

export async function createCampaign(workspaceId: string, userId: string, input: Input): Promise<ChatCampaign> {
  const name = str(input.name, 80);
  const widgetId = str(input.widget_id, 64);
  if (!name) throw new ChatCollabError('missing_name');
  if (!widgetId) throw new ChatCollabError('invalid_input');
  const id = crypto.randomUUID();
  const now = new Date().toISOString();
  await getDb()
    .prepare('INSERT INTO chat_campaigns (id, workspace_id, widget_id, name, subject, body, audience, created_by, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)')
    .run(id, workspaceId, widgetId, name, str(input.subject, 200), str(input.body, 20000), input.audience ? cleanAudience(input.audience) : 'all', userId, now, now);
  return (await getCampaign(workspaceId, id))!;
}

/** Una campaña enviada solo se renombra. */
export async function updateCampaign(workspaceId: string, id: string, input: Input): Promise<ChatCampaign | null> {
  const c = await getCampaign(workspaceId, id);
  if (!c) return null;
  const name = input.name !== undefined ? str(input.name, 80) : c.name;
  if (!name) throw new ChatCollabError('missing_name');
  if (c.status !== 'draft') {
    await getDb().prepare('UPDATE chat_campaigns SET name = ?, updated_at = ? WHERE id = ?').run(name, new Date().toISOString(), id);
    return getCampaign(workspaceId, id);
  }
  await getDb()
    .prepare('UPDATE chat_campaigns SET name = ?, subject = ?, body = ?, audience = ?, widget_id = ?, updated_at = ? WHERE id = ?')
    .run(
      name,
      input.subject !== undefined ? str(input.subject, 200) : c.subject,
      input.body !== undefined ? str(input.body, 20000) : c.body,
      input.audience !== undefined ? cleanAudience(input.audience) : c.audience,
      input.widget_id ? str(input.widget_id, 64) : c.widget_id,
      new Date().toISOString(),
      id,
    );
  return getCampaign(workspaceId, id);
}

export async function deleteCampaign(workspaceId: string, id: string): Promise<boolean> {
  return (await getDb().prepare('DELETE FROM chat_campaigns WHERE workspace_id = ? AND id = ?').run(workspaceId, id)).changes > 0;
}

function audienceSql(audience: string): { sql: string; args: string[] } {
  if (audience === 'verified') return { sql: ' AND email_verified = 1', args: [] };
  if (audience.startsWith('company:')) return { sql: ' AND company_id = ?', args: [audience.slice(8)] };
  return { sql: '', args: [] };
}

/** Un email con forma de email. */
const VALID_EMAIL_SQL = `email LIKE '%_@_%._%' AND email NOT LIKE '% %' AND email NOT LIKE '%<%' AND email NOT LIKE '%>%'`;
/** Solo con consentimiento explícito: un email escrito en el chat no suma a nadie a la audiencia. */
const OPTED_IN_SQL = `campaign_opt_in_at IS NOT NULL`;

function eligibleWhere(audience: string): { sql: string; args: string[] } {
  const a = audienceSql(audience);
  return {
    sql: `widget_id = ? AND email IS NOT NULL AND ${VALID_EMAIL_SQL} AND ${OPTED_IN_SQL}
      AND LOWER(email) NOT IN (SELECT LOWER(email) FROM chat_visitors u WHERE u.widget_id = chat_visitors.widget_id AND u.unsubscribed_at IS NOT NULL AND u.email IS NOT NULL)${a.sql}`,
    args: a.args,
  };
}

export interface AudienceInfo {
  /** A cuántas direcciones les llegaría. */
  size: number;
  /** Con email pero sin consentimiento. */
  excludedNoOptIn: number;
  excludedUnsubscribed: number;
}

export async function describeAudience(widgetId: string, audience: string): Promise<AudienceInfo> {
  const db = getDb();
  const w = eligibleWhere(audience);
  const a = audienceSql(audience);
  const row = (await db.prepare(`SELECT COUNT(DISTINCT LOWER(email)) AS n FROM chat_visitors WHERE ${w.sql}`).get(widgetId, ...w.args)) as { n: number };
  const imported = (await db
    .prepare(`SELECT COUNT(DISTINCT LOWER(email)) AS n FROM chat_visitors WHERE widget_id = ? AND email IS NOT NULL AND campaign_opt_in_at IS NULL${a.sql}`)
    .get(widgetId, ...a.args)) as { n: number };
  const unsub = (await db
    .prepare(`SELECT COUNT(DISTINCT LOWER(email)) AS n FROM chat_visitors WHERE widget_id = ? AND email IS NOT NULL AND unsubscribed_at IS NOT NULL${a.sql}`)
    .get(widgetId, ...a.args)) as { n: number };
  return { size: Number(row.n), excludedNoOptIn: Number(imported.n), excludedUnsubscribed: Number(unsub.n) };
}

// ---------- Tope por workspace ----------

export const CAMPAIGN_DAILY_CAP = 500;
/** Cuentas de menos de 7 días: menos margen para mandar spam con una cuenta recién creada. */
export const CAMPAIGN_DAILY_CAP_NEW = 50;
const NEW_ACCOUNT_MS = 7 * 86_400_000;

export interface CampaignCap {
  limit: number;
  used: number;
  remaining: number;
}

const usageDay = (now: Date) => now.toISOString().slice(0, 10);

export function parseUserDate(raw: string | null | undefined): number {
  if (!raw) return NaN;
  return Date.parse(raw.includes('T') ? raw : `${raw.replace(' ', 'T')}Z`);
}

async function capLimit(workspaceId: string, now: Date): Promise<number> {
  const owner = (await getDb().prepare('SELECT created_at FROM users WHERE id = ?').get(workspaceId)) as { created_at: string | null } | undefined;
  const created = parseUserDate(owner?.created_at);
  return !Number.isFinite(created) || now.getTime() - created < NEW_ACCOUNT_MS ? CAMPAIGN_DAILY_CAP_NEW : CAMPAIGN_DAILY_CAP;
}

/**
 * Cupo del día (UTC). Vive en su propia tabla, no en las campañas: borrar una
 * campaña no devuelve lo que ya se usó.
 */
export async function campaignCap(workspaceId: string, now = new Date()): Promise<CampaignCap> {
  const limit = await capLimit(workspaceId, now);
  const row = (await getDb().prepare('SELECT used FROM chat_campaign_usage WHERE workspace_id = ? AND day = ?').get(workspaceId, usageDay(now))) as { used: number } | undefined;
  const used = Number(row?.used ?? 0);
  return { limit, used, remaining: Math.max(0, limit - used) };
}

/** Toma un lugar del cupo de hoy; false si no queda. Atómico: dos corridas no lo pasan. */
async function reserveCap(workspaceId: string, limit: number, now: Date): Promise<boolean> {
  const res = await getDb()
    .prepare(
      `INSERT INTO chat_campaign_usage (workspace_id, day, used) VALUES (?, ?, 1)
       ON CONFLICT (workspace_id, day) DO UPDATE SET used = used + 1 WHERE used < ?`,
    )
    .run(workspaceId, usageDay(now), limit);
  return res.changes > 0;
}

/**
 * Pasa de borrador a preparando con compare-and-set. La foto de destinatarios
 * es un solo INSERT ... SELECT y recién después queda "enviando": el cron no ve
 * la campaña a medio armar. El tope no corta el envío: sale hasta el cupo y el
 * resto queda pendiente para cuando se libere al día siguiente.
 */
export async function startCampaign(workspaceId: string, id: string, now = new Date()): Promise<ChatCampaign> {
  const db = getDb();
  const c = await getCampaign(workspaceId, id);
  if (!c) throw new ChatCollabError('not_found', 404);
  if (!c.subject.trim() || !c.body.trim()) throw new ChatCollabError('missing_body');
  if (c.status !== 'draft') throw new ChatCollabError('already_sent', 409);
  const info = await describeAudience(c.widget_id, c.audience);
  if (info.size === 0) throw new ChatCollabError('no_recipients');
  const iso = now.toISOString();
  const res = await db
    .prepare(`UPDATE chat_campaigns SET status = 'preparing', total = ?, sent_at = ?, updated_at = ? WHERE id = ? AND status = 'draft'`)
    .run(info.size, iso, iso, id);
  if (res.changes === 0) throw new ChatCollabError('already_sent', 409);
  await prepareRecipients(c, info.size);
  return (await getCampaign(workspaceId, id))!;
}

async function prepareRecipients(c: Pick<ChatCampaign, 'id' | 'widget_id' | 'audience'>, cap: number): Promise<void> {
  const db = getDb();
  const w = eligibleWhere(c.audience);
  await db
    .prepare(
      `INSERT OR IGNORE INTO chat_campaign_recipients (campaign_id, visitor_id, email)
       SELECT ?, MIN(id), LOWER(email) FROM chat_visitors WHERE ${w.sql} GROUP BY LOWER(email) LIMIT ?`,
    )
    .run(c.id, c.widget_id, ...w.args, Math.min(cap, CAMPAIGN_MAX_RECIPIENTS));
  const n = (await db.prepare('SELECT COUNT(*) AS n FROM chat_campaign_recipients WHERE campaign_id = ?').get(c.id)) as { n: number };
  const total = Number(n.n);
  await db
    .prepare(`UPDATE chat_campaigns SET total = ?, status = ?, updated_at = ? WHERE id = ? AND status = 'preparing'`)
    .run(total, total === 0 ? 'sent' : 'sending', new Date().toISOString(), c.id);
}

// ---------- Baja ----------

function secret(): string {
  return process.env.CHAT_VISITOR_SECRET || process.env.NEXTAUTH_SECRET || 'zerosoft-chat-visitor';
}

export function unsubscribeToken(visitorId: string): string {
  const sig = createHmac('sha256', secret()).update(`unsub:${visitorId}`).digest('base64url').slice(0, 32);
  return `${visitorId}.${sig}`;
}

export function verifyUnsubscribeToken(token: string): string | null {
  const dot = token.lastIndexOf('.');
  if (dot <= 0) return null;
  const id = token.slice(0, dot);
  const expected = Buffer.from(unsubscribeToken(id));
  const given = Buffer.from(token);
  return expected.length === given.length && timingSafeEqual(expected, given) ? id : null;
}

/** Da de baja a la persona y a sus otros visitantes con el mismo email en ese widget. */
export async function unsubscribeVisitor(visitorId: string): Promise<boolean> {
  const db = getDb();
  const v = (await db.prepare('SELECT widget_id, email FROM chat_visitors WHERE id = ?').get(visitorId)) as { widget_id: string; email: string | null } | undefined;
  if (!v) return false;
  const now = new Date().toISOString();
  await db.prepare('UPDATE chat_visitors SET unsubscribed_at = ? WHERE id = ? AND unsubscribed_at IS NULL').run(now, visitorId);
  if (v.email) await db.prepare('UPDATE chat_visitors SET unsubscribed_at = ? WHERE widget_id = ? AND LOWER(email) = LOWER(?) AND unsubscribed_at IS NULL').run(now, v.widget_id, v.email);
  return true;
}

// ---------- Envío (cron) ----------

/** {{first_name|fallback}}, {{name}} y {{email}}. Lo demás queda como vino para que se note. */
export function fillCampaignText(text: string, v: { name: string | null; email: string }): string {
  const first = (v.name ?? '').trim().split(/\s+/)[0] ?? '';
  return text.replace(/\{\{\s*(first_name|name|email)\s*(?:\|([^}]*))?\}\}/g, (_m, key: string, fb: string | undefined) => {
    const val = key === 'email' ? v.email : key === 'name' ? (v.name ?? '').trim() : first;
    return val || (fb ?? '').trim();
  });
}

/** Reintentos con espera: 2 min, 10 min, 1 h y 6 h; después queda como error. */
export const RETRY_DELAYS_MS = [120_000, 600_000, 3_600_000, 21_600_000];
/** Entre un envío y otro: el límite por defecto de Resend es de 2 por segundo. */
const SEND_GAP_MS = 550;

/** Pura: 429 y 5xx (o sin respuesta del proveedor) se reintentan; lo demás no se va a arreglar solo. */
export function isRetryableSend(res: { status?: number; error?: string }): boolean {
  if (res.status === undefined) return true;
  return res.status === 429 || res.status >= 500;
}

export async function processChatCampaigns(opts: { limit?: number; origin?: string; campaignId?: string; gapMs?: number } = {}): Promise<{ sent: number; failed: number; retried: number }> {
  const db = getDb();
  const limit = opts.limit ?? 90;
  const origin = opts.origin ?? process.env.NEXT_PUBLIC_APP_URL ?? process.env.APP_URL ?? 'https://zerosoft.ai';
  const gap = opts.gapMs ?? (process.env.RESEND_API_KEY ? SEND_GAP_MS : 0);
  const nowIso = new Date().toISOString();
  // Preparación que murió a la mitad: se retoma (el INSERT es idempotente).
  const staleAt = new Date(Date.now() - 600_000).toISOString();
  const stuck = (await db.prepare(`SELECT id, widget_id, audience, total FROM chat_campaigns WHERE status = 'preparing' AND updated_at < ?`).all(staleAt)) as Array<{ id: string; widget_id: string; audience: string; total: number }>;
  for (const c of stuck) await prepareRecipients(c, Number(c.total));
  // Un reclamo colgado: la corrida murió sin saber si salió. Cuenta como error, no se reintenta para no duplicar.
  const staleRes = await db.prepare("UPDATE chat_campaign_recipients SET status = 'failed' WHERE status = 'claimed' AND claimed_at < ?").run(staleAt);
  // Workspaces sin cupo hoy: afuera de la consulta, así no le ocupan el lote a los demás.
  const now = new Date();
  const blocked: string[] = [];
  const limits = new Map<string, number>();
  for (const w of (await db.prepare("SELECT DISTINCT workspace_id FROM chat_campaigns WHERE status = 'sending'").all()) as Array<{ workspace_id: string }>) {
    const cap = await campaignCap(w.workspace_id, now);
    limits.set(w.workspace_id, cap.limit);
    if (cap.remaining === 0) blocked.push(w.workspace_id);
  }
  const pending = (await db
    .prepare(
      `SELECT r.campaign_id, c.workspace_id, r.visitor_id, r.email, r.attempts, c.subject, c.body, w.name AS widget_name, w.color AS color, v.name AS visitor_name, v.unsubscribed_at
       FROM chat_campaign_recipients r
       JOIN chat_campaigns c ON c.id = r.campaign_id
       JOIN chat_widgets w ON w.id = c.widget_id
       JOIN chat_visitors v ON v.id = r.visitor_id
       WHERE r.status = 'pending' AND c.status = 'sending' AND (r.next_attempt_at IS NULL OR r.next_attempt_at <= ?)${opts.campaignId ? ' AND c.id = ?' : ''}${blocked.length ? ` AND c.workspace_id NOT IN (${blocked.map(() => '?').join(', ')})` : ''}
       LIMIT ?`,
    )
    .all(nowIso, ...(opts.campaignId ? [opts.campaignId] : []), ...blocked, limit)) as Array<{
    campaign_id: string;
    workspace_id: string;
    visitor_id: string;
    email: string;
    attempts: number;
    subject: string;
    body: string;
    widget_name: string;
    color: string;
    visitor_name: string | null;
    unsubscribed_at: string | null;
  }>;
  let sent = 0;
  let failed = 0;
  let retried = 0;
  const touched = new Set<string>(pending.map((p) => p.campaign_id));
  for (const r of pending) {
    const claim = await db
      .prepare("UPDATE chat_campaign_recipients SET status = 'claimed', claimed_at = ? WHERE campaign_id = ? AND visitor_id = ? AND status = 'pending'")
      .run(new Date().toISOString(), r.campaign_id, r.visitor_id);
    if (claim.changes === 0) continue;
    if (r.unsubscribed_at) {
      await db.prepare("UPDATE chat_campaign_recipients SET status = 'skipped' WHERE campaign_id = ? AND visitor_id = ?").run(r.campaign_id, r.visitor_id);
      continue;
    }
    // El primer intento toma cupo; un reintento ya lo tiene. Sin cupo vuelve a pendiente.
    if (Number(r.attempts) === 0 && !(await reserveCap(r.workspace_id, limits.get(r.workspace_id) ?? CAMPAIGN_DAILY_CAP_NEW, now))) {
      await db.prepare("UPDATE chat_campaign_recipients SET status = 'pending', claimed_at = NULL WHERE campaign_id = ? AND visitor_id = ?").run(r.campaign_id, r.visitor_id);
      continue;
    }
    const subject = fillCampaignText(r.subject, { name: r.visitor_name, email: r.email });
    const body = fillCampaignText(r.body, { name: r.visitor_name, email: r.email });
    const link = `${origin}/api/chat/unsubscribe?t=${encodeURIComponent(unsubscribeToken(r.visitor_id))}`;
    const res = await sendEmail({
      to: r.email,
      subject,
      text: `${body}\n\n--\n${r.widget_name}\nUnsubscribe: ${link}`,
      html: renderBrandedHtml({
        heading: subject,
        paragraphs: [...body.split(/\n{2,}/).map((p) => escapeHtml(p).replace(/\n/g, '<br>')), `<a href="${escapeHtml(link)}">Unsubscribe</a>`],
        brandColor: r.color,
        eyebrow: r.widget_name,
      }),
      headers: { 'List-Unsubscribe': `<${link}>`, 'List-Unsubscribe-Post': 'List-Unsubscribe=One-Click' },
      // Misma clave en cada reintento: si se perdió la respuesta, Resend no lo manda de nuevo.
      idempotencyKey: `chat-campaign/${r.campaign_id}/${r.visitor_id}`,
    }).catch((): { ok: false; status?: number; retryAfter?: number } => ({ ok: false }));
    if (res.ok) {
      await db.prepare("UPDATE chat_campaign_recipients SET status = 'sent', sent_at = ? WHERE campaign_id = ? AND visitor_id = ?").run(new Date().toISOString(), r.campaign_id, r.visitor_id);
      sent += 1;
    } else if (isRetryableSend(res) && Number(r.attempts) < RETRY_DELAYS_MS.length) {
      const wait = Math.max(RETRY_DELAYS_MS[Number(r.attempts)], (res.retryAfter ?? 0) * 1000);
      await db
        .prepare("UPDATE chat_campaign_recipients SET status = 'pending', attempts = attempts + 1, next_attempt_at = ?, claimed_at = NULL WHERE campaign_id = ? AND visitor_id = ?")
        .run(new Date(Date.now() + wait).toISOString(), r.campaign_id, r.visitor_id);
      retried += 1;
      // El proveedor pidió frenar: el resto queda para la próxima corrida.
      if (res.status === 429) break;
    } else {
      await db.prepare("UPDATE chat_campaign_recipients SET status = 'failed' WHERE campaign_id = ? AND visitor_id = ?").run(r.campaign_id, r.visitor_id);
      failed += 1;
    }
    if (gap > 0) await new Promise((done) => setTimeout(done, gap));
  }
  if (staleRes.changes > 0 || stuck.length > 0) {
    for (const c of (await db.prepare("SELECT id FROM chat_campaigns WHERE status = 'sending'").all()) as Array<{ id: string }>) touched.add(c.id);
  }
  // Totales y cierre.
  for (const id of touched) {
    await db
      .prepare(
        `UPDATE chat_campaigns SET
           sent = (SELECT COUNT(*) FROM chat_campaign_recipients r WHERE r.campaign_id = chat_campaigns.id AND r.status = 'sent'),
           failed = (SELECT COUNT(*) FROM chat_campaign_recipients r WHERE r.campaign_id = chat_campaigns.id AND r.status = 'failed'),
           status = CASE WHEN EXISTS (SELECT 1 FROM chat_campaign_recipients r WHERE r.campaign_id = chat_campaigns.id AND r.status IN ('pending', 'claimed')) THEN status ELSE 'sent' END,
           updated_at = ?
         WHERE id = ? AND status = 'sending'`,
      )
      .run(new Date().toISOString(), id);
  }
  return { sent, failed, retried };
}
