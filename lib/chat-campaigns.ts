/**
 * Chat — campañas por email a las personas de un widget. Borrador, envío (foto
 * de destinatarios, sin repetir email ni dados de baja) y cron que reclama cada
 * destinatario con compare-and-set para que dos corridas no manden dos veces.
 * Cada email lleva su link de baja firmado. Server-only.
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
  status: 'draft' | 'sending' | 'sent';
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

export async function countAudience(widgetId: string, audience: string): Promise<number> {
  const a = audienceSql(audience);
  const row = (await getDb()
    .prepare(`SELECT COUNT(DISTINCT LOWER(email)) AS n FROM chat_visitors WHERE widget_id = ? AND email IS NOT NULL AND email != '' AND unsubscribed_at IS NULL${a.sql}`)
    .get(widgetId, ...a.args)) as { n: number };
  return Number(row.n);
}

/** Pasa de borrador a enviando (compare-and-set) y toma la foto de destinatarios. */
export async function startCampaign(workspaceId: string, id: string): Promise<ChatCampaign> {
  const db = getDb();
  const c = await getCampaign(workspaceId, id);
  if (!c) throw new ChatCollabError('not_found', 404);
  if (!c.subject.trim() || !c.body.trim()) throw new ChatCollabError('missing_body');
  const res = await db
    .prepare("UPDATE chat_campaigns SET status = 'sending', sent_at = ?, updated_at = ? WHERE id = ? AND status = 'draft'")
    .run(new Date().toISOString(), new Date().toISOString(), id);
  if (res.changes === 0) throw new ChatCollabError('already_sent', 409);
  const a = audienceSql(c.audience);
  const rows = (await db
    .prepare(
      `SELECT MIN(id) AS id, LOWER(email) AS email FROM chat_visitors
       WHERE widget_id = ? AND email IS NOT NULL AND email != '' AND unsubscribed_at IS NULL${a.sql}
       GROUP BY LOWER(email) LIMIT ?`,
    )
    .all(c.widget_id, ...a.args, CAMPAIGN_MAX_RECIPIENTS)) as Array<{ id: string; email: string }>;
  // Quien se dio de baja con otro visitante del mismo email tampoco recibe.
  const out = new Set(
    ((await db.prepare("SELECT LOWER(email) AS email FROM chat_visitors WHERE widget_id = ? AND unsubscribed_at IS NOT NULL AND email IS NOT NULL").all(c.widget_id)) as Array<{ email: string }>).map((r) => r.email),
  );
  const list = rows.filter((r) => !out.has(r.email));
  for (const r of list) {
    await db.prepare('INSERT OR IGNORE INTO chat_campaign_recipients (campaign_id, visitor_id, email) VALUES (?, ?, ?)').run(id, r.id, r.email);
  }
  await db
    .prepare("UPDATE chat_campaigns SET total = ?, status = CASE WHEN ? = 0 THEN 'sent' ELSE status END WHERE id = ?")
    .run(list.length, list.length, id);
  return (await getCampaign(workspaceId, id))!;
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

export async function processChatCampaigns(opts: { limit?: number; origin?: string; campaignId?: string } = {}): Promise<{ sent: number; failed: number }> {
  const db = getDb();
  const limit = opts.limit ?? 200;
  const origin = opts.origin ?? process.env.NEXT_PUBLIC_APP_URL ?? process.env.APP_URL ?? 'https://zerosoftware.ai';
  const now = new Date().toISOString();
  // Un reclamo de hace más de 10 minutos quedó colgado (la corrida murió sin marcarlo): cuenta como fallido, no se reintenta para no duplicar.
  const stale = new Date(Date.now() - 600_000).toISOString();
  const staleRes = await db.prepare("UPDATE chat_campaign_recipients SET status = 'failed' WHERE status = 'claimed' AND claimed_at < ?").run(stale);
  const pending = (await db
    .prepare(
      `SELECT r.campaign_id, r.visitor_id, r.email, c.subject, c.body, w.name AS widget_name, w.color AS color, v.name AS visitor_name, v.unsubscribed_at
       FROM chat_campaign_recipients r
       JOIN chat_campaigns c ON c.id = r.campaign_id
       JOIN chat_widgets w ON w.id = c.widget_id
       JOIN chat_visitors v ON v.id = r.visitor_id
       WHERE r.status = 'pending' AND c.status = 'sending'${opts.campaignId ? ' AND c.id = ?' : ''}
       LIMIT ?`,
    )
    .all(...(opts.campaignId ? [opts.campaignId] : []), limit)) as Array<{
    campaign_id: string;
    visitor_id: string;
    email: string;
    subject: string;
    body: string;
    widget_name: string;
    color: string;
    visitor_name: string | null;
    unsubscribed_at: string | null;
  }>;
  let sent = 0;
  let failed = 0;
  const touched = new Set<string>(pending.map((p) => p.campaign_id));
  for (const r of pending) {
    const claim = await db
      .prepare("UPDATE chat_campaign_recipients SET status = 'claimed', claimed_at = ? WHERE campaign_id = ? AND visitor_id = ? AND status = 'pending'")
      .run(now, r.campaign_id, r.visitor_id);
    if (claim.changes === 0) continue;
    if (r.unsubscribed_at) {
      await db.prepare("UPDATE chat_campaign_recipients SET status = 'skipped' WHERE campaign_id = ? AND visitor_id = ?").run(r.campaign_id, r.visitor_id);
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
    }).catch(() => ({ ok: false }));
    await db
      .prepare('UPDATE chat_campaign_recipients SET status = ?, sent_at = ? WHERE campaign_id = ? AND visitor_id = ?')
      .run(res.ok ? 'sent' : 'failed', new Date().toISOString(), r.campaign_id, r.visitor_id);
    if (res.ok) sent += 1;
    else failed += 1;
  }
  if (staleRes.changes > 0) {
    for (const c of (await db.prepare("SELECT id FROM chat_campaigns WHERE status = 'sending'").all()) as Array<{ id: string }>) touched.add(c.id);
  }
  // Totales y cierre, también para campañas que terminaron en una corrida anterior.
  for (const id of touched) {
    await db
      .prepare(
        `UPDATE chat_campaigns SET
           sent = (SELECT COUNT(*) FROM chat_campaign_recipients r WHERE r.campaign_id = chat_campaigns.id AND r.status = 'sent'),
           failed = (SELECT COUNT(*) FROM chat_campaign_recipients r WHERE r.campaign_id = chat_campaigns.id AND r.status = 'failed'),
           status = CASE WHEN EXISTS (SELECT 1 FROM chat_campaign_recipients r WHERE r.campaign_id = chat_campaigns.id AND r.status IN ('pending', 'claimed')) THEN status ELSE 'sent' END,
           updated_at = ?
         WHERE id = ?`,
      )
      .run(new Date().toISOString(), id);
  }
  return { sent, failed };
}
