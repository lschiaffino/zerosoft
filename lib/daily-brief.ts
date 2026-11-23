/**
 * Resumen del día (Lines e Inbox): lo que espera a una persona hoy, como una
 * tarjeta arriba de la lista (se cierra por el día) y, si lo pide en Ajustes ›
 * Avisos, por email a la mañana (lib/daily-brief-email.ts).
 *
 * - Lines (por workspace, con lo que esa persona ve: líneas, acceso por
 *   etiqueta, teléfonos ocultos; todo pasa por chatAccessSql en la misma
 *   consulta y cada chat queda atado al workspace): chats asignados a ella
 *   que esperan respuesta, grupos sin asignar que esperan respuesta, tickets
 *   cerca de vencer su SLA (o vencidos), tickets nuevos, sus tareas que
 *   vencen hoy y las menciones en notas internas.
 * - Inbox (personal: solo sus filas): chats por responder, grupos con
 *   mensajes sin leer, recordatorios vencidos y menciones a su número en
 *   grupos.
 *
 * Solo cuentas y nombres de chats: nunca el texto de un mensaje ni de una
 * nota. Sin IA. Server-only.
 */
import { getDb } from './db';
import { chatAccessSql, type GroupsViewer } from './groups-access';
import { maskPhone, maskPhoneText } from './groups-mask';

export type BriefApp = 'lines' | 'inbox';

/** Lines: waiting, sla, groups, tickets, tasks, mentions. Inbox: reply, reminders, unreadGroups, groupMentions. */
export type BriefKind = 'waiting' | 'groups' | 'sla' | 'tickets' | 'tasks' | 'mentions' | 'reply' | 'reminders' | 'unreadGroups' | 'groupMentions';

export interface BriefChat {
  id: string;
  /** '' si no tiene nombre ni teléfono a la vista (la pantalla dice "Chat"). */
  name: string;
}

export interface BriefItem {
  kind: BriefKind;
  /** Cuántas cosas (chats, tickets, tareas o menciones). */
  count: number;
  /** En cuántos chats distintos (para "y N más"). */
  chatTotal: number;
  /** Hasta BRIEF_TOP chats para abrir desde la tarjeta. */
  chats: BriefChat[];
}

export interface DailyBrief {
  app: BriefApp;
  items: BriefItem[];
}

export const BRIEF_TOP = 3;
/** Un SLA "en riesgo": vence dentro de este tiempo (o ya venció). */
export const BRIEF_SLA_SOON_MS = 4 * 60 * 60 * 1000;
/** "Nuevo" es de las últimas 24 horas. */
export const BRIEF_RECENT_MS = 24 * 60 * 60 * 1000;
const NAME_MAX = 80;

const DAY = /^\d{4}-\d{2}-\d{2}$/;

/** Un día local válido ("2026-11-23") o null. */
export function cleanDay(raw: unknown): string | null {
  const s = typeof raw === 'string' ? raw.trim() : '';
  if (!DAY.test(s)) return null;
  const t = Date.parse(`${s}T00:00:00Z`);
  return Number.isFinite(t) && new Date(t).toISOString().slice(0, 10) === s ? s : null;
}

/**
 * El fin del día local de quien mira (lo manda la pantalla: la medianoche que viene en su zona). Tiene que caer
 * entre ahora y 26 horas; si no, se toman 24 horas desde ahora.
 */
export function cleanDayEnd(raw: unknown, now = new Date()): Date {
  const t = typeof raw === 'string' ? Date.parse(raw) : NaN;
  if (Number.isFinite(t) && t > now.getTime() && t <= now.getTime() + 26 * 60 * 60 * 1000) return new Date(t);
  return new Date(now.getTime() + 24 * 60 * 60 * 1000);
}

/** ¿Hay algo? (sin nada, la tarjeta no aparece y el email no sale). */
export function briefIsEmpty(b: DailyBrief): boolean {
  return b.items.every((i) => i.count === 0);
}

/** Un nombre para mostrar: sin saltos ni caracteres de control, corto, y con los teléfonos ocultos si corresponde. */
export function briefName(raw: string, mask = false): string {
  // eslint-disable-next-line no-control-regex
  const clean = String(raw ?? '').replace(/[\u0000-\u001f\u007f\u200e\u200f\u2028-\u202e\u2066-\u2069]+/g, ' ').replace(/\s+/g, ' ').trim();
  const shown = mask ? maskPhoneText(clean) : clean;
  return shown.length > NAME_MAX ? `${shown.slice(0, NAME_MAX - 1)}…` : shown;
}

type Arg = string | number;
type ChatLite = { id: string; name: string; phone: string };

/** Nombre de un chat de Lines: el suyo o su teléfono (oculto si quien mira no los ve). Nunca el id del proveedor. */
function linesChatName(viewer: GroupsViewer, r: ChatLite): string {
  const raw = r.name || (r.phone ? (viewer.mask ? maskPhone(r.phone) : `+${r.phone}`) : '');
  return briefName(raw, viewer.mask);
}

/**
 * Una fila del resumen de Lines: cuántas filas cumplen, en cuántos chats y los primeros chats. `from` arma el FROM
 * con groups_chats como `c` (y su workspace ya atado); a `where` se le suma el acceso de quien mira. `chatless`:
 * cuentan también las filas sin chat (tickets sueltos), pero solo para quien ve todo.
 */
async function linesPart(viewer: GroupsViewer, kind: BriefKind, from: string, where: string[], args: Arg[], order: string, opts: { chatless?: boolean } = {}): Promise<BriefItem> {
  const db = getDb();
  const access = chatAccessSql(viewer, 'c');
  const conds = [...where];
  const condArgs: Arg[] = [...args];
  if (access) {
    conds.push('c.id IS NOT NULL', access.sql);
    condArgs.push(...access.args);
  } else if (!opts.chatless) conds.push('c.id IS NOT NULL');
  const whereSql = conds.join(' AND ');
  const totals = (await db.prepare(`SELECT COUNT(*) AS n, COUNT(DISTINCT c.id) AS d ${from} WHERE ${whereSql}`).get(...condArgs)) as { n: number; d: number } | undefined;
  const top = (await db
    .prepare(`SELECT c.id, MAX(c.name) AS name, MAX(c.phone) AS phone ${from} WHERE ${whereSql} AND c.id IS NOT NULL GROUP BY c.id ORDER BY ${order} LIMIT ${BRIEF_TOP}`)
    .all(...condArgs)) as ChatLite[];
  return { kind, count: Number(totals?.n ?? 0), chatTotal: Number(totals?.d ?? 0), chats: top.map((r) => ({ id: r.id, name: linesChatName(viewer, r) })) };
}

/**
 * Lines: el resumen de `viewer.me` en el workspace `viewer.ws`. Un chat que
 * no ve no cuenta ni aparece. `dayEnd`: el fin del día local de la persona
 * (sus tareas "de hoy").
 */
export async function linesBrief(viewer: GroupsViewer, now = new Date(), opts: { dayEnd?: Date } = {}): Promise<DailyBrief> {
  const ws = viewer.ws;
  const me = viewer.me;
  const soon = new Date(now.getTime() + BRIEF_SLA_SOON_MS).toISOString();
  const since = new Date(now.getTime() - BRIEF_RECENT_MS).toISOString();
  const dayEnd = (opts.dayEnd ?? new Date(now.getTime() + 24 * 60 * 60 * 1000)).toISOString();
  const chats = 'FROM groups_chats c';
  const live = ['c.user_id = ?', "c.status = 'open'", 'c.archived_at IS NULL', 'c.hidden_at IS NULL', 'c.awaiting_since IS NOT NULL'];
  const tickets = 'FROM groups_tickets t LEFT JOIN groups_chats c ON c.id = t.chat_id AND c.user_id = t.user_id';
  const myTickets = ['t.user_id = ?', "t.status IN ('open', 'in_progress')", '(t.assignee_id = ? OR t.assignee_id IS NULL)'];
  const risk =
    '(t.breached_at IS NOT NULL OR (t.due_at IS NOT NULL AND t.due_at <= ?) OR (t.first_response_at IS NULL AND t.first_response_due_at IS NOT NULL AND t.first_response_due_at <= ?))';
  const [waiting, groups, sla, fresh, tasks, mentions] = await Promise.all([
    // Chats asignados a mí que esperan respuesta (los más viejos primero).
    linesPart(viewer, 'waiting', chats, [...live, 'c.assigned_to = ?'], [ws, me], 'MIN(c.awaiting_since) ASC'),
    // Grupos sin asignar que esperan respuesta: los puede tomar cualquiera.
    linesPart(viewer, 'groups', chats, [...live, "c.kind = 'group'", 'c.assigned_to IS NULL'], [ws], 'MIN(c.awaiting_since) ASC'),
    // Tickets míos o sin asignar con el SLA vencido o por vencer.
    linesPart(viewer, 'sla', tickets, [...myTickets, risk], [ws, me, soon, soon], "MIN(COALESCE(t.first_response_due_at, t.due_at, '9999')) ASC", { chatless: true }),
    // Tickets nuevos (últimas 24 horas), míos o sin asignar.
    linesPart(viewer, 'tickets', tickets, [...myTickets, 't.created_at >= ?'], [ws, me, since], 'MAX(t.created_at) DESC', { chatless: true }),
    // Mis tareas abiertas que vencen hoy (o ya vencieron).
    linesPart(
      viewer,
      'tasks',
      'FROM groups_tasks t JOIN crm_activities a ON a.id = t.activity_id JOIN groups_chats c ON c.id = t.chat_id AND c.user_id = t.user_id',
      ['t.user_id = ?', 'a.done = 0', 'a.owner_id = ?', 'a.due_at IS NOT NULL', 'a.due_at <= ?'],
      [ws, me, dayEnd],
      'MIN(a.due_at) ASC',
    ),
    // Menciones en notas internas (los avisos de la persona) de las últimas 24 horas, de chats que todavía ve.
    linesPart(
      viewer,
      'mentions',
      'FROM notifications n JOIN groups_chats c ON c.id = n.source_id AND c.user_id = ?',
      ['n.user_id = ?', "n.type = 'mention'", "n.source_type = 'groups_chat'", 'n.created_at >= ?'],
      [ws, me, since],
      'MAX(n.created_at) DESC',
    ),
  ]);
  return { app: 'lines', items: [waiting, sla, groups, fresh, tasks, mentions] };
}

type ThreadLite = { id: string; title: string; handle: string; kind: string };

const threadName = (t: ThreadLite) => briefName(t.title || (t.handle && t.kind !== 'group' ? (t.handle.includes('@') ? t.handle : `+${t.handle}`) : ''));

/** Una fila del resumen de Inbox: cuántas filas, en cuántos chats y los primeros (siempre de `owner`). */
async function inboxPart(kind: BriefKind, from: string, where: string[], args: Arg[], order: string): Promise<BriefItem> {
  const db = getDb();
  const whereSql = where.join(' AND ');
  const totals = (await db.prepare(`SELECT COUNT(*) AS n, COUNT(DISTINCT t.id) AS d ${from} WHERE ${whereSql}`).get(...args)) as { n: number; d: number } | undefined;
  const top = (await db
    .prepare(`SELECT t.id, MAX(t.title) AS title, MAX(t.handle) AS handle, MAX(t.kind) AS kind ${from} WHERE ${whereSql} GROUP BY t.id ORDER BY ${order} LIMIT ${BRIEF_TOP}`)
    .all(...args)) as ThreadLite[];
  return { kind, count: Number(totals?.n ?? 0), chatTotal: Number(totals?.d ?? 0), chats: top.map((r) => ({ id: r.id, name: threadName(r) })) };
}

/**
 * Inbox: el resumen de `owner` (su id real). Cada consulta filtra por
 * owner_id: en ninguna entra otra persona.
 */
export async function inboxBrief(owner: string, now = new Date()): Promise<DailyBrief> {
  const db = getDb();
  const nowS = now.toISOString();
  const since = new Date(now.getTime() - BRIEF_RECENT_MS).toISOString();
  const threads = 'FROM inbox_threads t';
  const active = ['t.owner_id = ?', 't.removed_at IS NULL', 't.done_at IS NULL', 't.archived_at IS NULL', '(t.snoozed_until IS NULL OR t.snoozed_until <= ?)'];
  // Mi número en cada cuenta de WhatsApp: las menciones a él en grupos.
  const accounts = (await db.prepare("SELECT id, address FROM inbox_accounts WHERE owner_id = ? AND kind = 'whatsapp'").all(owner)) as Array<{ id: string; address: string }>;
  const mine = accounts.map((a) => ({ id: a.id, phone: String(a.address ?? '').replace(/\D/g, '') })).filter((a) => /^\d{8,15}$/.test(a.phone));
  const mentionFrom = 'FROM inbox_messages m JOIN inbox_threads t ON t.id = m.thread_id AND t.owner_id = m.owner_id';
  const mentionWhere = [
    'm.owner_id = ?',
    "t.kind = 'group'",
    't.removed_at IS NULL',
    'm.from_me = 0',
    'm.hidden_at IS NULL',
    'm.sent_at >= ?',
    mine.length
      ? `(${mine.map(() => "(t.account_id = ? AND EXISTS (SELECT 1 FROM json_each(CASE WHEN json_valid(m.meta) THEN json_extract(m.meta, '$.mentions') END) je WHERE je.value = ?))").join(' OR ')})`
      : '0',
  ];
  const [reply, reminders, groups, mentions] = await Promise.all([
    inboxPart('reply', threads, [...active, 't.last_from_me = 0', "t.kind <> 'group'", 't.last_message_at IS NOT NULL'], [owner, nowS], 'MIN(t.last_message_at) ASC'),
    inboxPart('reminders', threads, ['t.owner_id = ?', 't.removed_at IS NULL', 't.follow_up_at IS NOT NULL', 't.follow_up_at <= ?'], [owner, nowS], 'MIN(t.follow_up_at) ASC'),
    inboxPart('unreadGroups', threads, [...active, "t.kind = 'group'", 't.unread > 0', 't.last_from_me = 0'], [owner, nowS], 'MAX(t.last_message_at) DESC'),
    inboxPart('groupMentions', mentionFrom, mentionWhere, [owner, since, ...mine.flatMap((a) => [a.id, a.phone])], 'MAX(m.sent_at) DESC'),
  ]);
  return { app: 'inbox', items: [reply, reminders, groups, mentions] };
}

// ---------------------------------------------------------------------------
// Estado por persona: cerrada por hoy y el email de la mañana
// ---------------------------------------------------------------------------

/** La clave de la tarjeta cerrada: Lines es por workspace (cerrarla en uno no la cierra en otro); Inbox es uno solo. */
export function briefKey(app: BriefApp, ws?: string): string {
  return app === 'lines' ? `lines:${ws ?? ''}` : 'inbox';
}

/** La tarjeta quedó cerrada para ese día local. */
export async function briefDismissed(userId: string, key: string, day: string): Promise<boolean> {
  const row = (await getDb().prepare('SELECT dismissed_day FROM daily_brief_dismissals WHERE user_id = ? AND app = ?').get(userId, key)) as { dismissed_day: string } | undefined;
  return row?.dismissed_day === day;
}

export async function dismissBrief(userId: string, key: string, day: string): Promise<void> {
  await getDb()
    .prepare(
      `INSERT INTO daily_brief_dismissals (user_id, app, dismissed_day) VALUES (?, ?, ?)
       ON CONFLICT(user_id, app) DO UPDATE SET dismissed_day = excluded.dismissed_day`,
    )
    .run(userId, key, day);
}

/** Deshacer el cierre. */
export async function restoreBrief(userId: string, key: string): Promise<void> {
  await getDb().prepare('DELETE FROM daily_brief_dismissals WHERE user_id = ? AND app = ?').run(userId, key);
}

export async function briefEmailOn(userId: string): Promise<boolean> {
  const row = (await getDb().prepare('SELECT email FROM daily_brief_prefs WHERE user_id = ?').get(userId)) as { email: number } | undefined;
  return row?.email === 1;
}

/** Una zona horaria que Intl conoce, o ''. */
export function cleanTimeZone(raw: unknown): string {
  const tz = typeof raw === 'string' ? raw.trim().slice(0, 64) : '';
  if (!tz) return '';
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: tz });
    return tz;
  } catch {
    return '';
  }
}

/** Prende o apaga el email. `timeZone`: la del navegador al guardar (para mandarlo a su mañana). */
export async function setBriefEmail(userId: string, on: boolean, timeZone = '', now = new Date()): Promise<void> {
  await getDb()
    .prepare(
      `INSERT INTO daily_brief_prefs (user_id, email, email_day, time_zone, updated_at) VALUES (?, ?, NULL, ?, ?)
       ON CONFLICT(user_id) DO UPDATE SET email = excluded.email, updated_at = excluded.updated_at,
         time_zone = CASE WHEN excluded.time_zone <> '' THEN excluded.time_zone ELSE daily_brief_prefs.time_zone END`,
    )
    .run(userId, on ? 1 : 0, cleanTimeZone(timeZone), now.toISOString());
}
