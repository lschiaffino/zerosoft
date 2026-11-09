/**
 * Suscripciones de Analytics: un insight o un tablero por email, según un
 * calendario. Cada entrega se reclama por fila (compare-and-set) para que dos
 * corridas del cron no manden dos veces. Solo sale lo que se podría publicar en
 * un link abierto. Server-only.
 */
import { createHmac, timingSafeEqual } from 'crypto';
import { nanoid } from 'nanoid';
import { listBoardMembers } from '../board-comments';
import { getDb } from '../db';
import { rateLimit } from '../rate-limit';
import { appSender, escapeHtml, sendEmail } from '../email';
import { applyDashboard } from './dashboard-core';
import { getProjectById, type ProjectRow } from './projects';
import { runInsight } from './query';
import { getDashboard, getInsight } from './records';
import { publicResult } from './share-view';
import { nextDelivery, subscriptionScheduleSchema, summarize, type SubscriptionSchedule } from './subscriptions-core';
import { projectTz } from './tz';
import { shareableQuery, type InsightDto } from './types';

const CLAIM_MS = 15 * 60_000;
const DAY = 86_400_000;
/** Emails por hora y workspace: menos los primeros días, que es cuando se abusa de un envío gratis. */
const EMAILS_PER_HOUR = 300;
const EMAILS_PER_HOUR_NEW = 30;
const NEW_WORKSPACE_DAYS = 7;
const CONFIRM_DAYS = 14;
export const SUBSCRIPTION_MAX_INSIGHTS = 20;
export const SUBSCRIPTION_MAX_RECIPIENTS = 20;

export type RecipientState = 'confirmed' | 'pending' | 'unsubscribed';

export interface SubscriptionDto {
  id: string;
  name: string;
  insightId: string | null;
  dashboardId: string | null;
  insightIds: string[];
  recipients: string[];
  /** Por destinatario: quienes no son del workspace confirman antes de recibir nada. */
  recipientState: Record<string, RecipientState>;
  recipientCount: number;
  locale: string;
  message: string;
  schedule: SubscriptionSchedule;
  enabled: boolean;
  nextAt: number | null;
  lastSentAt: number | null;
  lastError: string | null;
  createdBy: string | null;
  createdAt: string;
}

interface Row {
  id: string;
  project_id: string;
  name: string;
  insight_id: string | null;
  dashboard_id: string | null;
  insight_ids: string;
  recipients: string;
  recipient_state?: string | null;
  locale?: string | null;
  message: string;
  schedule: string;
  enabled: number;
  next_at: number | null;
  last_sent_at: number | null;
  last_error: string | null;
  created_by: string | null;
  created_at: string;
}

function parseList(raw: string): string[] {
  try {
    const v = JSON.parse(raw);
    return Array.isArray(v) ? v.map(String) : [];
  } catch {
    return [];
  }
}

function parseState(raw: string | null | undefined): Record<string, RecipientState> {
  try {
    const v = JSON.parse(raw || '{}');
    return v && typeof v === 'object' ? (v as Record<string, RecipientState>) : {};
  } catch {
    return {};
  }
}

/** Lo que va en un asunto o un nombre: sin saltos de línea ni caracteres de control. */
const oneLine = (v: string) => v.replace(/[\u0000-\u001f\u007f]+/g, ' ').trim();

function toDto(r: Row): SubscriptionDto {
  const parsed = subscriptionScheduleSchema.safeParse(JSON.parse(r.schedule || '{}'));
  const recipients = parseList(r.recipients);
  return {
    id: r.id,
    name: r.name,
    insightId: r.insight_id,
    dashboardId: r.dashboard_id,
    insightIds: parseList(r.insight_ids),
    recipients,
    recipientState: parseState(r.recipient_state),
    recipientCount: recipients.length,
    locale: r.locale || 'en',
    message: r.message,
    schedule: parsed.success ? parsed.data : { frequency: 'weekly', interval: 1, hour: 9 },
    enabled: r.enabled === 1,
    nextAt: r.next_at === null ? null : Number(r.next_at),
    lastSentAt: r.last_sent_at === null ? null : Number(r.last_sent_at),
    lastError: r.last_error,
    createdBy: r.created_by,
    createdAt: r.created_at,
  };
}

export async function listSubscriptions(projectId: string): Promise<SubscriptionDto[]> {
  const rows = (await getDb().prepare('SELECT * FROM analytics_subscriptions WHERE project_id = ? ORDER BY created_at DESC LIMIT 500').all(projectId)) as unknown as Row[];
  return rows.map(toDto);
}

export async function getSubscription(projectId: string, id: string): Promise<SubscriptionDto | null> {
  const r = (await getDb().prepare('SELECT * FROM analytics_subscriptions WHERE id = ? AND project_id = ?').get(id, projectId)) as Row | undefined;
  return r ? toDto(r) : null;
}

export interface SubscriptionInput {
  name: string;
  insightId?: string | null;
  dashboardId?: string | null;
  insightIds?: string[];
  recipients: string[];
  message?: string;
  schedule: SubscriptionSchedule;
  enabled?: boolean;
}

const cleanRecipients = (list: string[]) => [...new Set(list.map((x) => x.trim().toLowerCase()).filter(Boolean))].slice(0, SUBSCRIPTION_MAX_RECIPIENTS);

/** Gasta un email del cupo del workspace. false: no quedan por esta hora. */
async function takeEmail(workspaceId: string): Promise<boolean> {
  if (process.env.RATE_LIMIT_DISABLED === 'true') return true;
  const owner = (await getDb().prepare('SELECT created_at FROM users WHERE id = ?').get(workspaceId)) as { created_at?: string | number | null } | undefined;
  const age = owner?.created_at ? Date.now() - new Date(owner.created_at).getTime() : 0;
  const limit = age > NEW_WORKSPACE_DAYS * DAY ? EMAILS_PER_HOUR : EMAILS_PER_HOUR_NEW;
  return (await rateLimit(`asub-mail:${workspaceId}`, limit, 3600)).ok;
}

async function workspaceEmails(workspaceId: string): Promise<Set<string>> {
  return new Set((await listBoardMembers(workspaceId)).map((m) => m.email.toLowerCase()));
}

async function optedOut(workspaceId: string, emails: string[]): Promise<Set<string>> {
  if (!emails.length) return new Set();
  const rows = (await getDb()
    .prepare(`SELECT email FROM analytics_email_optouts WHERE workspace_id = ? AND email IN (${emails.map(() => '?').join(',')})`)
    .all(workspaceId, ...emails)) as unknown as Array<{ email: string }>;
  return new Set(rows.map((r) => r.email));
}

/** Estado de cada destinatario: quien se dio de baja no vuelve; del workspace entra directo; el resto confirma. */
async function nextStates(workspaceId: string, recipients: string[], prev: Record<string, RecipientState>): Promise<Record<string, RecipientState>> {
  const inside = await workspaceEmails(workspaceId);
  const out = await optedOut(workspaceId, recipients);
  const state: Record<string, RecipientState> = {};
  for (const r of recipients) state[r] = out.has(r) ? 'unsubscribed' : prev[r] === 'confirmed' || inside.has(r) ? 'confirmed' : 'pending';
  return state;
}

async function validTarget(projectId: string, input: Pick<SubscriptionInput, 'insightId' | 'dashboardId' | 'insightIds'>): Promise<{ insightIds: string[] } | null> {
  if (input.insightId) {
    const i = await getInsight(projectId, input.insightId);
    return i ? { insightIds: [] } : null;
  }
  if (input.dashboardId) {
    const d = await getDashboard(projectId, input.dashboardId);
    if (!d) return null;
    // Por defecto los primeros 20, en el orden del tablero.
    const picked = input.insightIds?.length ? d.insightIds.filter((x) => input.insightIds!.includes(x)) : d.insightIds;
    return { insightIds: picked.slice(0, SUBSCRIPTION_MAX_INSIGHTS) };
  }
  return null;
}

export async function createSubscription(project: ProjectRow, personId: string, input: SubscriptionInput, now = Date.now(), locale = 'en'): Promise<SubscriptionDto | 'email_limit' | null> {
  const target = await validTarget(project.id, input);
  if (!target) return null;
  const recipients = cleanRecipients(input.recipients);
  const state = await nextStates(project.workspace_id, recipients, {});
  const toNotify = recipients.filter((r) => state[r] !== 'unsubscribed');
  // Antes de crear nada: si no alcanza el cupo para los avisos, no se crea.
  for (let i = 0; i < toNotify.length; i++) if (!(await takeEmail(project.workspace_id))) return 'email_limit';
  const id = `asb_${nanoid(12)}`;
  const enabled = input.enabled !== false;
  await getDb()
    .prepare(
      `INSERT INTO analytics_subscriptions (id, project_id, name, insight_id, dashboard_id, insight_ids, recipients, recipient_state, locale, message, schedule, enabled, next_at, created_by, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(
      id,
      project.id,
      oneLine(input.name).slice(0, 200),
      input.insightId ?? null,
      input.insightId ? null : (input.dashboardId ?? null),
      JSON.stringify(target.insightIds),
      JSON.stringify(recipients),
      JSON.stringify(state),
      locale,
      (input.message ?? '').slice(0, 1000),
      JSON.stringify(input.schedule),
      enabled ? 1 : 0,
      enabled ? nextDelivery(input.schedule, now, now, projectTz(project)) : null,
      personId,
      new Date(now).toISOString(),
      new Date(now).toISOString(),
    );
  const dto = (await getSubscription(project.id, id))!;
  await notifyRecipients(dto, toNotify, locale);
  return dto;
}

export async function updateSubscription(project: ProjectRow, id: string, patch: Partial<SubscriptionInput>, now = Date.now(), locale?: string): Promise<SubscriptionDto | 'email_limit' | null> {
  const cur = await getSubscription(project.id, id);
  if (!cur) return null;
  const target = await validTarget(project.id, { insightId: cur.insightId, dashboardId: cur.dashboardId, insightIds: patch.insightIds ?? cur.insightIds });
  if (!target) return null;
  const recipients = patch.recipients ? cleanRecipients(patch.recipients) : cur.recipients;
  const state = await nextStates(project.workspace_id, recipients, cur.recipientState);
  // Solo a quienes recién se suman, y nunca a quien se dio de baja.
  const toNotify = recipients.filter((r) => !cur.recipients.includes(r) && state[r] !== 'unsubscribed');
  for (let i = 0; i < toNotify.length; i++) if (!(await takeEmail(project.workspace_id))) return 'email_limit';
  const schedule = patch.schedule ?? cur.schedule;
  const enabled = patch.enabled ?? cur.enabled;
  const nextAt = enabled ? (patch.schedule || !cur.enabled || cur.nextAt === null ? nextDelivery(schedule, now, Date.parse(cur.createdAt), projectTz(project)) : cur.nextAt) : null;
  await getDb()
    .prepare('UPDATE analytics_subscriptions SET name = ?, insight_ids = ?, recipients = ?, recipient_state = ?, locale = ?, message = ?, schedule = ?, enabled = ?, next_at = ?, last_error = CASE WHEN ? = 1 THEN NULL ELSE last_error END, updated_at = ? WHERE id = ? AND project_id = ?')
    .run(oneLine(patch.name ?? cur.name).slice(0, 200), JSON.stringify(target.insightIds), JSON.stringify(recipients), JSON.stringify(state), locale ?? cur.locale, (patch.message ?? cur.message).slice(0, 1000), JSON.stringify(schedule), enabled ? 1 : 0, nextAt, enabled ? 1 : 0, new Date(now).toISOString(), id, project.id);
  const dto = (await getSubscription(project.id, id))!;
  await notifyRecipients(dto, toNotify, locale ?? cur.locale);
  return dto;
}

export async function deleteSubscription(projectId: string, id: string): Promise<boolean> {
  const res = await getDb().prepare('DELETE FROM analytics_subscriptions WHERE id = ? AND project_id = ?').run(id, projectId);
  return res.changes > 0;
}

// ---------- Darse de baja ----------

const secret = () => process.env.NEXTAUTH_SECRET || process.env.AUTH_SECRET || process.env.ENCRYPTION_KEY || '';
const signUnsub = (id: string, email: string) => createHmac('sha256', `analytics-sub:${secret()}`).update(`${id}\n${email}`).digest('base64url').slice(0, 32);

export function unsubscribeToken(id: string, email: string): string {
  return `${id}.${Buffer.from(email).toString('base64url')}.${signUnsub(id, email)}`;
}

export function parseUnsubscribeToken(token: string): { id: string; email: string } | null {
  const [id, enc, sig] = token.split('.');
  if (!id || !enc || !sig) return null;
  const email = Buffer.from(enc, 'base64url').toString();
  const want = Buffer.from(signUnsub(id, email));
  const got = Buffer.from(sig);
  if (want.length !== got.length || !timingSafeEqual(want, got)) return null;
  return { id, email };
}

const signConfirm = (id: string, email: string, exp: number) => createHmac('sha256', `analytics-sub-confirm:${secret()}`).update(`${id}\n${email}\n${exp}`).digest('base64url').slice(0, 32);

export function confirmToken(id: string, email: string, now = Date.now()): string {
  const exp = now + CONFIRM_DAYS * DAY;
  return `${id}.${Buffer.from(email).toString('base64url')}.${exp}.${signConfirm(id, email, exp)}`;
}

/** Quien recibió el aviso confirma que quiere los reportes. El token vence y solo sirve para su dirección. */
export async function confirmRecipient(token: string, now = Date.now()): Promise<boolean> {
  const [id, enc, expRaw, sig] = token.split('.');
  if (!id || !enc || !expRaw || !sig) return false;
  const email = Buffer.from(enc, 'base64url').toString();
  const exp = Number(expRaw);
  if (!Number.isFinite(exp) || exp < now) return false;
  const want = Buffer.from(signConfirm(id, email, exp));
  const got = Buffer.from(sig);
  if (want.length !== got.length || !timingSafeEqual(want, got)) return false;
  const row = (await getDb().prepare('SELECT s.recipients, s.recipient_state, p.workspace_id FROM analytics_subscriptions s JOIN analytics_projects p ON p.id = s.project_id WHERE s.id = ?').get(id)) as { recipients: string; recipient_state: string; workspace_id: string } | undefined;
  if (!row || !parseList(row.recipients).includes(email)) return false;
  const state = parseState(row.recipient_state);
  state[email] = 'confirmed';
  await getDb().prepare('DELETE FROM analytics_email_optouts WHERE workspace_id = ? AND email = ?').run(row.workspace_id, email);
  await getDb().prepare('UPDATE analytics_subscriptions SET recipient_state = ? WHERE id = ?').run(JSON.stringify(state), id);
  return true;
}

/** Saca a una persona de una suscripción, con el token de su email, y el workspace no la vuelve a avisar. Sin nadie más, queda apagada. */
export async function unsubscribe(token: string): Promise<boolean> {
  const parsed = parseUnsubscribeToken(token);
  if (!parsed) return false;
  const row = (await getDb().prepare('SELECT s.*, p.workspace_id FROM analytics_subscriptions s JOIN analytics_projects p ON p.id = s.project_id WHERE s.id = ?').get(parsed.id)) as (Row & { workspace_id: string }) | undefined;
  if (!row) return true;
  await getDb().prepare('INSERT OR IGNORE INTO analytics_email_optouts (workspace_id, email, created_at) VALUES (?, ?, ?)').run(row.workspace_id, parsed.email, new Date().toISOString());
  const left = parseList(row.recipients).filter((r) => r !== parsed.email);
  const state = parseState(row.recipient_state);
  delete state[parsed.email];
  await getDb()
    .prepare('UPDATE analytics_subscriptions SET recipients = ?, recipient_state = ?, enabled = CASE WHEN ? = 0 THEN 0 ELSE enabled END, next_at = CASE WHEN ? = 0 THEN NULL ELSE next_at END WHERE id = ?')
    .run(JSON.stringify(left), JSON.stringify(state), left.length, left.length, parsed.id);
  return true;
}

// ---------- Entrega ----------

const siteUrl = () => (process.env.NEXT_PUBLIC_SITE_URL || process.env.NEXTAUTH_URL || 'https://zerosoft.ai').replace(/\/$/, '');

const COPY: Record<string, { noticeSubject: string; notice: string; confirmSubject: string; confirmBody: string; confirm: string; unsub: string; open: string; notPublic: string; failed: string; empty: string }> = {
  en: { noticeSubject: 'You were added to an analytics report', notice: 'A zerosoft workspace you belong to added you to a report by email.', confirmSubject: 'Do you want to receive this analytics report?', confirmBody: 'Someone using zerosoft wants to send you an analytics report by email. You will get nothing unless you confirm. If you were not expecting this, ignore this message.', confirm: 'Confirm', unsub: 'Unsubscribe', open: 'Open in zerosoft', notPublic: 'This one is only visible inside the app.', failed: 'Could not calculate this one.', empty: 'No data for this period.' },
  es: { noticeSubject: 'Te sumaron a un reporte de analítica', notice: 'Un workspace de zerosoft del que sos parte te sumó a un reporte por email.', confirmSubject: '¿Querés recibir este reporte de analítica?', confirmBody: 'Alguien que usa zerosoft quiere mandarte un reporte de analítica por email. No vas a recibir nada si no confirmás. Si no lo esperabas, ignorá este mensaje.', confirm: 'Confirmar', unsub: 'Darme de baja', open: 'Abrir en zerosoft', notPublic: 'Este solo se puede ver dentro de la app.', failed: 'No se pudo calcular.', empty: 'Sin datos en este período.' },
  pt: { noticeSubject: 'Você foi adicionado a um relatório de analytics', notice: 'Um workspace do zerosoft do qual você faz parte adicionou você a um relatório por email.', confirmSubject: 'Quer receber este relatório de analytics?', confirmBody: 'Alguém que usa o zerosoft quer enviar um relatório de analytics por email. Você não recebe nada se não confirmar. Se não esperava isto, ignore esta mensagem.', confirm: 'Confirmar', unsub: 'Cancelar inscrição', open: 'Abrir no zerosoft', notPublic: 'Este só pode ser visto dentro do app.', failed: 'Não foi possível calcular.', empty: 'Sem dados neste período.' },
};
const copy = (locale: string) => COPY[locale] ?? COPY.en;

const unsubLink = (id: string, email: string, locale: string) => `${siteUrl()}/${locale}/stats/unsubscribe?t=${encodeURIComponent(unsubscribeToken(id, email))}`;
const unsubHeaders = (id: string, email: string) => ({
  'List-Unsubscribe': `<${siteUrl()}/api/analytics/sub-unsubscribe?t=${encodeURIComponent(unsubscribeToken(id, email))}>`,
  'List-Unsubscribe-Post': 'List-Unsubscribe=One-Click',
});

/** El primer email no lleva nada escrito por quien suscribe: ni nombre ni mensaje. Quien no es del workspace confirma. */
async function notifyRecipients(s: SubscriptionDto, recipients: string[], locale: string): Promise<void> {
  const c = copy(locale);
  for (const to of recipients) {
    const unsub = unsubLink(s.id, to, locale);
    if (s.recipientState[to] === 'confirmed') {
      await sendEmail({ to, subject: c.noticeSubject, text: `${c.notice}\n\n${c.unsub}: ${unsub}`, html: `<p>${escapeHtml(c.notice)}</p><p><a href="${escapeHtml(unsub)}">${escapeHtml(c.unsub)}</a></p>`, from: appSender(), headers: unsubHeaders(s.id, to) }).catch(() => null);
      continue;
    }
    const link = `${siteUrl()}/${locale}/stats/unsubscribe?confirm=${encodeURIComponent(confirmToken(s.id, to))}`;
    await sendEmail({
      to,
      subject: c.confirmSubject,
      text: `${c.confirmBody}\n\n${c.confirm}: ${link}\n\n${c.unsub}: ${unsub}`,
      html: `<p>${escapeHtml(c.confirmBody)}</p><p><a href="${escapeHtml(link)}">${escapeHtml(c.confirm)}</a></p><p style="font-size:12px;color:#666"><a href="${escapeHtml(unsub)}">${escapeHtml(c.unsub)}</a></p>`,
      from: appSender(),
      headers: unsubHeaders(s.id, to),
    }).catch(() => null);
  }
}

/** Arma el cuerpo: cada insight con su tabla corta. */
export async function buildReport(project: ProjectRow, s: SubscriptionDto, locale: string): Promise<{ text: string[]; html: string[] }> {
  const c = copy(locale);
  const insights: InsightDto[] = [];
  let board: Awaited<ReturnType<typeof getDashboard>> = null;
  if (s.insightId) {
    const i = await getInsight(project.id, s.insightId);
    if (i) insights.push(i);
  } else if (s.dashboardId) {
    board = await getDashboard(project.id, s.dashboardId);
    for (const id of s.insightIds) {
      const i = await getInsight(project.id, id);
      if (i) insights.push(i);
    }
  }
  const text: string[] = [];
  const html: string[] = [];
  for (const i of insights) {
    text.push(i.name);
    html.push(`<h3 style="margin:16px 0 6px;font-size:15px">${escapeHtml(i.name)}</h3>`);
    // Un email puede ir a cualquiera: lo que no se publicaría en un link abierto no sale.
    if (!shareableQuery(i.query)) {
      text.push(c.notPublic, '');
      html.push(`<p>${escapeHtml(c.notPublic)}</p>`);
      continue;
    }
    try {
      const q = board ? applyDashboard(i.query, board.settings, board.settings.tiles[i.id]) : i.query;
      const table = summarize(publicResult(await runInsight(project, q)), locale);
      if (!table || !table.rows.length) {
        text.push(c.empty, '');
        html.push(`<p>${escapeHtml(c.empty)}</p>`);
        continue;
      }
      text.push(table.head.join(' | '), ...table.rows.map((r) => r.join(' | ')), '');
      const cell = 'padding:4px 10px;border-bottom:1px solid #ddd;text-align:left';
      html.push(
        `<table style="border-collapse:collapse;font-size:13px"><thead><tr>${table.head.map((h) => `<th style="${cell}">${escapeHtml(h)}</th>`).join('')}</tr></thead><tbody>${table.rows
          .map((r) => `<tr>${r.map((v) => `<td style="${cell}">${escapeHtml(v)}</td>`).join('')}</tr>`)
          .join('')}</tbody></table>`,
      );
    } catch {
      text.push(c.failed, '');
      html.push(`<p>${escapeHtml(c.failed)}</p>`);
    }
  }
  return { text, html };
}

/** Manda una suscripción ahora a quienes confirmaron. Devuelve el error, si hubo. */
export async function deliverSubscription(project: ProjectRow, s: SubscriptionDto, localeArg?: string): Promise<string | null> {
  const locale = localeArg ?? s.locale;
  const c = copy(locale);
  const body = await buildReport(project, s, locale);
  const path = s.insightId ? `/${locale}/app/pulse/insights/${s.insightId}` : `/${locale}/app/pulse/dashboards/${s.dashboardId}`;
  let error: string | null = null;
  for (const to of s.recipients) {
    if (s.recipientState[to] !== 'confirmed') continue;
    if (!(await takeEmail(project.workspace_id))) return 'email_limit';
    const link = unsubLink(s.id, to, locale);
    const res = await sendEmail({
      to,
      subject: s.name,
      from: appSender(),
      headers: unsubHeaders(s.id, to),
      text: [...(s.message ? [s.message, ''] : []), ...body.text, `${c.open}: ${siteUrl()}${path}`, '', `${c.unsub}: ${link}`].join('\n'),
      html: `${s.message ? `<p>${escapeHtml(s.message)}</p>` : ''}${body.html.join('')}<p style="margin-top:20px"><a href="${escapeHtml(`${siteUrl()}${path}`)}">${escapeHtml(c.open)}</a></p><p style="font-size:12px;color:#666"><a href="${escapeHtml(link)}">${escapeHtml(c.unsub)}</a></p>`,
    }).catch(() => ({ ok: false, error: 'send_failed' }));
    if (!res.ok) error = 'send_failed';
  }
  return error;
}

/** Cron: entrega lo vencido. Cada fila se reclama antes de mandar. */
export async function runSubscriptionsCron(opts: { budgetMs?: number; now?: number } = {}): Promise<{ sent: number; failed: number }> {
  const now = opts.now ?? Date.now();
  const until = Date.now() + (opts.budgetMs ?? 8000);
  const db = getDb();
  const due = (await db
    .prepare('SELECT * FROM analytics_subscriptions WHERE enabled = 1 AND next_at IS NOT NULL AND next_at <= ? AND (claimed_at IS NULL OR claimed_at < ?) ORDER BY next_at LIMIT 50')
    .all(now, now - CLAIM_MS)) as unknown as Row[];
  const out = { sent: 0, failed: 0 };
  for (const row of due) {
    if (Date.now() > until) break;
    const claim = await db.prepare('UPDATE analytics_subscriptions SET claimed_at = ? WHERE id = ? AND enabled = 1 AND next_at = ? AND (claimed_at IS NULL OR claimed_at < ?)').run(now, row.id, row.next_at, now - CLAIM_MS);
    if (!claim.changes) continue;
    const s = toDto(row);
    const project = await getProjectById(row.project_id);
    if (!project) continue;
    const error = await deliverSubscription(project, s).catch(() => 'send_failed');
    const next = nextDelivery(s.schedule, now, Date.parse(s.createdAt), projectTz(project));
    await db
      .prepare('UPDATE analytics_subscriptions SET claimed_at = NULL, next_at = ?, last_sent_at = CASE WHEN ? IS NULL THEN ? ELSE last_sent_at END, last_error = ? WHERE id = ?')
      .run(next, error, now, error, row.id);
    if (error) out.failed++;
    else out.sent++;
  }
  return out;
}
