/**
 * Track — avisos por email y recordatorios de issues.
 *
 * Cada persona elige cómo le llegan por email los avisos de la bandeja de
 * Track (track_notify_prefs.email_mode):
 *  - immediate: el cron de cada minuto manda lo que siga sin leer después de
 *    un minuto (si ya lo vio en la app, no llega). Se reclama moviendo
 *    cursor_at con compare-and-set.
 *  - digest (por defecto): un resumen por día con lo sin leer, desde el tick
 *    horario entre las 8 y las 11 de su zona horaria (la de sus ajustes de
 *    Track, si no la de Cal, si no UTC). digest_day reclama el día.
 *  - off: nada por email; la bandeja sigue igual.
 * Los avisos pospuestos no se mandan. También salen así las @menciones y
 * asignaciones de chats de Groups (source_type 'groups_chat').
 *
 * Recordatorios: "Recordarme" en un issue crea un aviso en la bandeja a esa
 * hora (track_issue_reminders, claim por sent_at); el email sigue la
 * preferencia de la persona como cualquier otro aviso.
 */
import { ownerSpaceSql } from './workspace';
import { getDb } from './db';
import { escapeHtml, renderBrandedHtml, sendEmail } from './email';
import { createNotification } from './notifications';
import { siteUrl } from './board-urls';
import { localDayIn, localHourIn, safeTimeZone } from './track-recurrence';
import en from '@/messages/en/track.json';
import es from '@/messages/es/track.json';
import pt from '@/messages/pt/track.json';

export type TrackEmailMode = 'immediate' | 'digest' | 'off';
export type TrackMailLocale = 'en' | 'es' | 'pt';

export const DEFAULT_EMAIL_MODE: TrackEmailMode = 'off';
/** Hora local desde la que sale el resumen (y hasta cuándo se reintenta ese día). */
export const DIGEST_HOUR = 8;
const DIGEST_LAST_HOUR = 11;
/** Cuánto espera un aviso sin leer antes de salir por email inmediato. */
export const IMMEDIATE_DELAY_MS = 60_000;
const DIGEST_LOOKBACK_MS = 48 * 3_600_000;
const DIGEST_MAX_ITEMS = 50;
const IMMEDIATE_MAX_ITEMS = 20;

type MailStrings = typeof en.notifyEmail;
type ActivityStrings = typeof en.activity;

const MAIL: Record<TrackMailLocale, MailStrings> = {
  en: en.notifyEmail,
  es: { ...en.notifyEmail, ...es.notifyEmail },
  pt: { ...en.notifyEmail, ...pt.notifyEmail },
};
const ACTIVITY: Record<TrackMailLocale, ActivityStrings> = {
  en: en.activity,
  es: { ...en.activity, ...es.activity },
  pt: { ...en.activity, ...pt.activity },
};
type NotificationStrings = typeof en.notifications;
const NOTIFICATION: Record<TrackMailLocale, NotificationStrings> = {
  en: en.notifications,
  es: { ...en.notifications, ...es.notifications },
  pt: { ...en.notifications, ...pt.notifications },
};

export function mailLocale(raw: string | null | undefined): TrackMailLocale {
  return raw === 'es' || raw === 'pt' ? raw : 'en';
}

function fill(tpl: string, vars: Record<string, string>): string {
  return tpl.replace(/\{(\w+)\}/g, (_, k: string) => vars[k] ?? '');
}

// ---------- Preferencias ----------

export interface TrackNotifyPrefs {
  emailMode: TrackEmailMode;
  timezone: string | null;
  locale: TrackMailLocale | null;
}

export async function getNotifyPrefs(userId: string): Promise<TrackNotifyPrefs> {
  const row = (await getDb()
    .prepare('SELECT email_mode, timezone, locale FROM track_notify_prefs WHERE user_id = ?')
    .get(userId)) as { email_mode: TrackEmailMode; timezone: string | null; locale: string | null } | undefined;
  return {
    emailMode: row?.email_mode ?? DEFAULT_EMAIL_MODE,
    timezone: row?.timezone ?? null,
    locale: row?.locale ? mailLocale(row.locale) : null,
  };
}

export async function setNotifyPrefs(
  userId: string,
  input: { emailMode: TrackEmailMode; timezone?: string | null; locale?: string | null },
  now = new Date(),
): Promise<TrackNotifyPrefs> {
  const ts = now.toISOString();
  const tz = input.timezone ? safeTimeZone(input.timezone) : null;
  const locale = input.locale ? mailLocale(input.locale) : null;
  // cursor_at arranca ahora al pasar a inmediato: no manda de golpe lo viejo
  // (el resumen mira las últimas 48 h si no tiene cursor).
  await getDb()
    .prepare(
      `INSERT INTO track_notify_prefs (user_id, email_mode, timezone, locale, cursor_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?)
       ON CONFLICT(user_id) DO UPDATE SET
         email_mode = excluded.email_mode,
         timezone = COALESCE(excluded.timezone, track_notify_prefs.timezone),
         locale = COALESCE(excluded.locale, track_notify_prefs.locale),
         cursor_at = CASE WHEN excluded.email_mode = 'immediate' AND track_notify_prefs.email_mode != 'immediate'
           THEN excluded.cursor_at ELSE COALESCE(track_notify_prefs.cursor_at, excluded.cursor_at) END,
         updated_at = excluded.updated_at`,
    )
    .run(userId, input.emailMode, tz, locale, input.emailMode === 'immediate' ? ts : null, ts);
  return getNotifyPrefs(userId);
}

// ---------- Contenido del email ----------

export interface TrackMailItem {
  id: string;
  type: string;
  title: string;
  body: string | null;
  href: string | null;
  meta: string;
  created_at: string;
}

function parseMeta(raw: string): Record<string, string> {
  try {
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === 'object' ? (parsed as Record<string, string>) : {};
  } catch {
    return {};
  }
}

/** Una línea por aviso, en el idioma de la persona (como la bandeja). */
export function describeItem(item: TrackMailItem, locale: TrackMailLocale): string {
  const meta = parseMeta(item.meta);
  const a = ACTIVITY[locale];
  const m = MAIL[locale];
  const vars = { actor: String(meta.actorName || m.someone), identifier: String(meta.issueIdentifier ?? '') };
  if (meta.chatName) {
    // Groups: mención en una nota o chat asignado.
    const n = NOTIFICATION[locale];
    const g = { actor: vars.actor, title: String(meta.chatName) };
    if (item.type === 'mention') return fill(n.groupsMention, g);
    if (item.type === 'assigned') return fill(meta.rule ? n.groupsAutoAssigned : n.groupsAssigned, g);
    return item.title;
  }
  switch (item.type) {
    case 'mention':
      return fill(a.mentionedYou, vars);
    case 'assigned':
      return fill(a.assignedYou, vars);
    case 'comment':
      return fill(a.commentedOn, vars);
    case 'status_change':
      return fill(a.changedStatus, vars);
    case 'issue_update':
      return fill(a.updatedIssue, vars);
    case 'track_reminder':
      return fill(m.reminder, vars);
    default:
      return item.title;
  }
}

function itemUrl(item: TrackMailItem, locale: TrackMailLocale): string {
  const href = item.href && item.href.startsWith('/') ? item.href : '/app/track/inbox';
  return `${siteUrl()}/${locale}${href}`;
}

export function buildTrackEmail(
  items: TrackMailItem[],
  locale: TrackMailLocale,
  kind: 'immediate' | 'digest',
  total = items.length,
): { subject: string; text: string; html: string } {
  const m = MAIL[locale];
  const lines = items.map((i) => ({ text: describeItem(i, locale), detail: i.body ?? '', url: itemUrl(i, locale) }));
  const count = String(total);
  const subject =
    kind === 'digest'
      ? fill(m.digestSubject, { count })
      : items.length === 1
        ? lines[0].text
        : fill(m.immediateSubject, { count });
  const heading = kind === 'digest' ? m.digestHeading : m.immediateHeading;
  const settings = `${siteUrl()}/${locale}/app/track/settings?tab=notifications`;
  const inbox = `${siteUrl()}/${locale}/app/track/inbox`;
  const more = total > items.length ? fill(m.more, { count: String(total - items.length) }) : '';
  const why = kind === 'digest' ? m.whyDigest : m.whyImmediate;
  const text = [
    ...lines.flatMap((l) => [l.detail ? `${l.text}: ${l.detail}` : l.text, l.url, '']),
    ...(more ? [more, ''] : []),
    `${m.openInbox}: ${inbox}`,
    '',
    `${why} ${m.manage}: ${settings}`,
  ].join('\n');
  const html = renderBrandedHtml({
    heading,
    eyebrow: 'zerosoft · track',
    paragraphs: [
      ...lines.map(
        (l) =>
          `<a href="${escapeHtml(l.url)}" style="color:#111111;">${escapeHtml(l.text)}</a>` +
          (l.detail ? `<br /><span style="color:#666666;">${escapeHtml(l.detail)}</span>` : ''),
      ),
      ...(more ? [escapeHtml(more)] : []),
      `<a href="${escapeHtml(inbox)}">${escapeHtml(m.openInbox)}</a>`,
      `<span style="color:#888888;font-size:12px;">${escapeHtml(why)} <a href="${escapeHtml(settings)}" style="color:#888888;">${escapeHtml(m.manage)}</a></span>`,
    ],
  });
  return { subject, text, html };
}

// ---------- Envíos ----------

const ITEM_COLUMNS = 'n.id, n.type, n.title, n.body, n.href, n.meta, n.created_at';
const VISIBLE = `n.source_type IN ('track_issue', 'groups_chat') AND n.read_at IS NULL AND (n.snoozed_until IS NULL OR n.snoozed_until <= ?)`;

/** Emails inmediatos (cron de cada minuto). Devuelve cuántos emails salieron. */
export async function sendImmediateTrackEmails(opts: { now?: Date; limit?: number } = {}): Promise<number> {
  const now = opts.now ?? new Date();
  const nowTs = now.toISOString();
  const cutoff = new Date(now.getTime() - IMMEDIATE_DELAY_MS).toISOString();
  const db = getDb();
  const users = (await db
    .prepare(
      `SELECT p.user_id, p.cursor_at, p.locale, u.email
       FROM track_notify_prefs p JOIN users u ON u.id = p.user_id
       WHERE p.email_mode = 'immediate' AND EXISTS (
         SELECT 1 FROM notifications n
         WHERE n.user_id = p.user_id AND ${VISIBLE} AND n.created_at > COALESCE(p.cursor_at, '') AND n.created_at <= ?
       )
       LIMIT ?`,
    )
    .all(nowTs, cutoff, Math.min(Math.max(opts.limit ?? 200, 1), 1000))) as Array<{
    user_id: string;
    cursor_at: string | null;
    locale: string | null;
    email: string;
  }>;
  let sent = 0;
  for (const u of users) {
    const claimed = await db
      .prepare("UPDATE track_notify_prefs SET cursor_at = ? WHERE user_id = ? AND COALESCE(cursor_at, '') = ?")
      .run(cutoff, u.user_id, u.cursor_at ?? '');
    if (!claimed.changes) continue;
    const where = `n.user_id = ? AND ${VISIBLE} AND n.created_at > ? AND n.created_at <= ?`;
    const args = [u.user_id, nowTs, u.cursor_at ?? '', cutoff];
    const items = (await db
      .prepare(`SELECT ${ITEM_COLUMNS} FROM notifications n WHERE ${where} ORDER BY n.created_at DESC LIMIT ?`)
      .all(...args, IMMEDIATE_MAX_ITEMS)) as TrackMailItem[];
    if (items.length === 0) continue;
    const total = ((await db.prepare(`SELECT COUNT(*) AS c FROM notifications n WHERE ${where}`).get(...args)) as { c: number }).c;
    const mail = buildTrackEmail(items, mailLocale(u.locale), 'immediate', total);
    const res = await sendEmail({ to: u.email, ...mail }).catch(() => null);
    if (res?.ok) sent++;
  }
  return sent;
}

interface DigestCandidate {
  user_id: string;
  email: string;
  timezone: string | null;
  cal_timezone: string | null;
  locale: string | null;
  cursor_at: string | null;
  digest_day: string | null;
}

/** Zona horaria del resumen: la de Track, si no la de Cal, si no UTC. */
export function digestTimeZone(c: Pick<DigestCandidate, 'timezone' | 'cal_timezone'>): string {
  return safeTimeZone(c.timezone || c.cal_timezone || 'UTC');
}

/** ¿Le toca el resumen ahora? Entre las 8 y las 11 locales, una vez por día. */
export function digestDue(c: Pick<DigestCandidate, 'timezone' | 'cal_timezone' | 'digest_day'>, now: Date): string | null {
  const tz = digestTimeZone(c);
  const hour = localHourIn(tz, now);
  if (hour < DIGEST_HOUR || hour > DIGEST_LAST_HOUR) return null;
  const day = localDayIn(tz, now);
  return c.digest_day === day ? null : day;
}

/** Resúmenes diarios (tick horario). Devuelve cuántos emails salieron. */
export async function sendTrackDigests(opts: { now?: Date; limit?: number } = {}): Promise<number> {
  const now = opts.now ?? new Date();
  const nowTs = now.toISOString();
  const since = new Date(now.getTime() - DIGEST_LOOKBACK_MS).toISOString();
  const db = getDb();
  const candidates = (await db
    .prepare(
      `SELECT r.user_id, u.email, p.timezone, cu.timezone AS cal_timezone, p.locale, p.cursor_at, p.digest_day
       FROM (
         SELECT DISTINCT n.user_id FROM notifications n
         WHERE ${VISIBLE} AND n.created_at > ?
       ) r
       JOIN users u ON u.id = r.user_id
       LEFT JOIN track_notify_prefs p ON p.user_id = r.user_id
       LEFT JOIN calendar_users cu ON cu.user_id = r.user_id
       WHERE COALESCE(p.email_mode, '${DEFAULT_EMAIL_MODE}') = 'digest'
       LIMIT ?`,
    )
    .all(nowTs, since, Math.min(Math.max(opts.limit ?? 500, 1), 2000))) as DigestCandidate[];
  let sent = 0;
  for (const c of candidates) {
    const day = digestDue(c, now);
    if (!day) continue;
    await db
      .prepare('INSERT OR IGNORE INTO track_notify_prefs (user_id, email_mode, updated_at) VALUES (?, ?, ?)')
      .run(c.user_id, DEFAULT_EMAIL_MODE, nowTs);
    const claimed = await db
      .prepare(
        "UPDATE track_notify_prefs SET digest_day = ? WHERE user_id = ? AND email_mode = 'digest' AND (digest_day IS NULL OR digest_day != ?)",
      )
      .run(day, c.user_id, day);
    if (!claimed.changes) continue;
    const from = c.cursor_at && c.cursor_at > since ? c.cursor_at : since;
    const where = `n.user_id = ? AND ${VISIBLE} AND n.created_at > ? AND n.created_at <= ?`;
    const args = [c.user_id, nowTs, from, nowTs];
    const items = (await db
      .prepare(`SELECT ${ITEM_COLUMNS} FROM notifications n WHERE ${where} ORDER BY n.created_at DESC LIMIT ?`)
      .all(...args, DIGEST_MAX_ITEMS)) as TrackMailItem[];
    await db.prepare('UPDATE track_notify_prefs SET cursor_at = ? WHERE user_id = ?').run(nowTs, c.user_id);
    if (items.length === 0) continue;
    const total = ((await db.prepare(`SELECT COUNT(*) AS c FROM notifications n WHERE ${where}`).get(...args)) as { c: number }).c;
    const mail = buildTrackEmail(items, mailLocale(c.locale), 'digest', total);
    const res = await sendEmail({ to: c.email, ...mail }).catch(() => null);
    if (res?.ok) sent++;
  }
  return sent;
}

// ---------- Recordatorios de issues ----------

/** Hasta cuánto en el futuro se acepta un recordatorio. */
export const ISSUE_REMINDER_MAX_AHEAD_MS = 5 * 365 * 86_400_000;

export class IssueReminderError extends Error {
  constructor(public code: 'invalid_date' | 'reminder_in_past') {
    super(code);
  }
}

export interface IssueReminder {
  remindAt: string;
  sentAt: string | null;
}

export async function getIssueReminder(issueId: string, userId: string): Promise<IssueReminder | null> {
  const row = (await getDb()
    .prepare('SELECT remind_at, sent_at FROM track_issue_reminders WHERE issue_id = ? AND user_id = ?')
    .get(issueId, userId)) as { remind_at: string; sent_at: string | null } | undefined;
  return row ? { remindAt: row.remind_at, sentAt: row.sent_at } : null;
}

export async function setIssueReminder(issueId: string, userId: string, at: string, now = new Date()): Promise<IssueReminder> {
  const date = new Date(at);
  if (!Number.isFinite(date.getTime())) throw new IssueReminderError('invalid_date');
  if (date.getTime() < now.getTime() - 60_000) throw new IssueReminderError('reminder_in_past');
  if (date.getTime() > now.getTime() + ISSUE_REMINDER_MAX_AHEAD_MS) throw new IssueReminderError('invalid_date');
  const iso = date.toISOString();
  await getDb()
    .prepare(
      `INSERT INTO track_issue_reminders (issue_id, user_id, remind_at, sent_at, created_at) VALUES (?, ?, ?, NULL, ?)
       ON CONFLICT(issue_id, user_id) DO UPDATE SET remind_at = excluded.remind_at, sent_at = NULL`,
    )
    .run(issueId, userId, iso, now.toISOString());
  return { remindAt: iso, sentAt: null };
}

export async function clearIssueReminder(issueId: string, userId: string): Promise<boolean> {
  const res = await getDb().prepare('DELETE FROM track_issue_reminders WHERE issue_id = ? AND user_id = ?').run(issueId, userId);
  return res.changes > 0;
}

/**
 * Dispara los recordatorios vencidos como avisos de la bandeja. Solo si la
 * persona todavía tiene acceso al proyecto. Devuelve cuántos se avisaron.
 */
export async function fireIssueReminders(opts: { now?: Date; limit?: number } = {}): Promise<number> {
  const db = getDb();
  const now = (opts.now ?? new Date()).toISOString();
  const rows = (await db
    .prepare(
      `SELECT r.issue_id, r.user_id, r.remind_at, i.identifier, i.title, p.name AS project_name
       FROM track_issue_reminders r
       JOIN track_issues i ON i.id = r.issue_id
       JOIN track_projects p ON p.id = i.project_id
       WHERE r.sent_at IS NULL AND r.remind_at <= ?
         AND (
           (p.team_id IS NULL AND ${ownerSpaceSql('p.owner_id', 'r.user_id')})
           OR (p.team_id IS NOT NULL AND EXISTS (
             SELECT 1 FROM team_members m WHERE m.team_id = p.team_id AND m.user_id = r.user_id
           ))
         )
       ORDER BY r.remind_at ASC LIMIT ?`,
    )
    .all(now, Math.min(Math.max(opts.limit ?? 200, 1), 1000))) as Array<{
    issue_id: string;
    user_id: string;
    remind_at: string;
    identifier: string;
    title: string;
    project_name: string;
  }>;
  let fired = 0;
  for (const r of rows) {
    const claimed = await db
      .prepare('UPDATE track_issue_reminders SET sent_at = ? WHERE issue_id = ? AND user_id = ? AND sent_at IS NULL AND remind_at = ?')
      .run(now, r.issue_id, r.user_id, r.remind_at);
    if (!claimed.changes) continue;
    fired++;
    await createNotification({
      userId: r.user_id,
      type: 'track_reminder',
      title: `Reminder: ${r.identifier}`,
      body: r.title,
      href: `/app/track/issues/${r.issue_id}`,
      sourceType: 'track_issue',
      sourceId: r.issue_id,
      meta: { issueIdentifier: r.identifier, projectName: r.project_name },
    }).catch(() => undefined);
  }
  return fired;
}
