/**
 * Resumen del día (Lines e Inbox): lo que espera a una persona hoy, como una
 * tarjeta arriba de la lista (se cierra por el día) y, si lo pide en Ajustes ›
 * Avisos, por email a la mañana.
 *
 * - Lines (por workspace, con lo que esa persona ve: líneas, acceso por
 *   etiqueta, teléfonos ocultos): chats asignados a ella que esperan
 *   respuesta, grupos sin asignar que esperan respuesta, tickets cerca de
 *   vencer su SLA (o vencidos), tickets nuevos, sus tareas de hoy y las
 *   menciones en notas internas.
 * - Inbox (personal: solo sus filas): chats por responder, grupos con
 *   mensajes sin leer, recordatorios vencidos y menciones a su número en
 *   grupos.
 *
 * Solo cuentas y nombres de chats: nunca el texto de un mensaje ni de una
 * nota. Sin IA. Server-only.
 */
import { getDb } from './db';
import { chatAccessSql, canSeeChat, maskedChatName, ticketsForViewer, type GroupsViewer } from './groups-access';

export const BRIEF_APPS = ['lines', 'inbox'] as const;
export type BriefApp = (typeof BRIEF_APPS)[number];

/** Lines: waiting, sla, groups, tickets, tasks, mentions. Inbox: reply, reminders, unreadGroups, groupMentions. */
export type BriefKind = 'waiting' | 'groups' | 'sla' | 'tickets' | 'tasks' | 'mentions' | 'reply' | 'reminders' | 'unreadGroups' | 'groupMentions';

export interface BriefChat {
  id: string;
  name: string;
}

export interface BriefItem {
  kind: BriefKind;
  count: number;
  /** Hasta BRIEF_TOP chats (o tickets y tareas, con el id de su chat) para abrir desde la tarjeta. */
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

const DAY = /^\d{4}-\d{2}-\d{2}$/;

/** Un día local válido ("2026-11-23") o null. */
export function cleanDay(raw: unknown): string | null {
  const s = typeof raw === 'string' ? raw.trim() : '';
  if (!DAY.test(s)) return null;
  const t = Date.parse(`${s}T00:00:00Z`);
  return Number.isFinite(t) && new Date(t).toISOString().slice(0, 10) === s ? s : null;
}

/** ¿Hay algo? (una tarjeta sin nada muestra "nada pendiente"; un email sin nada no sale). */
export function briefIsEmpty(b: DailyBrief): boolean {
  return b.items.every((i) => i.count === 0);
}

type ChatRowLite = { id: string; name: string; phone: string; provider_chat_id: string; total?: number };

function topChats(viewer: GroupsViewer, rows: ChatRowLite[]): BriefChat[] {
  const seen = new Set<string>();
  const out: BriefChat[] = [];
  for (const r of rows) {
    if (seen.has(r.id)) continue;
    seen.add(r.id);
    out.push({ id: r.id, name: maskedChatName(viewer, r) });
    if (out.length >= BRIEF_TOP) break;
  }
  return out;
}

/**
 * Lines: el resumen de `viewer.me` en el workspace `viewer.ws`. Todo pasa por
 * chatAccessSql (las líneas que ve y el acceso por etiqueta): un chat que no
 * ve no cuenta ni aparece.
 */
export async function linesBrief(viewer: GroupsViewer, now = new Date()): Promise<DailyBrief> {
  const db = getDb();
  const me = viewer.me;
  const access = chatAccessSql(viewer, 'c');
  const acc = access ? ` AND ${access.sql}` : '';
  const accArgs = access?.args ?? [];
  const live = "c.status = 'open' AND c.archived_at IS NULL AND c.hidden_at IS NULL AND c.awaiting_since IS NOT NULL";
  const chatCols = 'c.id, c.name, c.phone, c.provider_chat_id, COUNT(*) OVER () AS total';

  // Chats asignados a mí que esperan respuesta (los más viejos primero).
  const waiting = (await db
    .prepare(`SELECT ${chatCols} FROM groups_chats c WHERE c.user_id = ? AND c.assigned_to = ? AND ${live}${acc} ORDER BY c.awaiting_since ASC LIMIT ?`)
    .all(viewer.ws, me, ...accArgs, BRIEF_TOP)) as ChatRowLite[];
  // Grupos sin asignar que esperan respuesta: los puede tomar cualquiera.
  const groups = (await db
    .prepare(`SELECT ${chatCols} FROM groups_chats c WHERE c.user_id = ? AND c.kind = 'group' AND c.assigned_to IS NULL AND ${live}${acc} ORDER BY c.awaiting_since ASC LIMIT ?`)
    .all(viewer.ws, ...accArgs, BRIEF_TOP)) as ChatRowLite[];

  // Tickets: los míos o sin asignar, de chats que veo (ticketsForViewer), activos.
  const soon = new Date(now.getTime() + BRIEF_SLA_SOON_MS).toISOString();
  const since = new Date(now.getTime() - BRIEF_RECENT_MS).toISOString();
  const tickets = (await db
    .prepare(
      `SELECT t.id, t.chat_id, t.created_at, t.due_at, t.first_response_due_at, t.first_response_at, t.breached_at, COALESCE(c.name, '') AS name,
         COALESCE(c.phone, '') AS phone, COALESCE(c.provider_chat_id, '') AS provider_chat_id
       FROM groups_tickets t LEFT JOIN groups_chats c ON c.id = t.chat_id
       WHERE t.user_id = ? AND t.status IN ('open', 'in_progress') AND (t.assignee_id = ? OR t.assignee_id IS NULL)
       ORDER BY t.created_at DESC LIMIT 500`,
    )
    .all(viewer.ws, me)) as Array<{
    id: string;
    chat_id: string | null;
    created_at: string;
    due_at: string | null;
    first_response_due_at: string | null;
    first_response_at: string | null;
    breached_at: string | null;
    name: string;
    phone: string;
    provider_chat_id: string;
  }>;
  const visibleTickets = await ticketsForViewer(
    viewer,
    tickets.map((t) => ({ ...t, chatId: t.chat_id, chatName: '' })),
  );
  const atRisk = visibleTickets.filter(
    (t) => !!t.breached_at || (!!t.due_at && t.due_at <= soon) || (!t.first_response_at && !!t.first_response_due_at && t.first_response_due_at <= soon),
  );
  const fresh = visibleTickets.filter((t) => t.created_at >= since);
  const ticketChats = (list: typeof visibleTickets) => topChats(viewer, list.filter((t) => t.chat_id).map((t) => ({ id: t.chat_id as string, name: t.name, phone: t.phone, provider_chat_id: t.provider_chat_id })));

  // Mis tareas abiertas que vencen hoy (o antes) o que me dieron en las últimas 24 horas, de chats que veo.
  const endOfDay = new Date(now.getTime() + 24 * 60 * 60 * 1000).toISOString();
  const tasks = (await db
    .prepare(
      `SELECT c.id, c.name, c.phone, c.provider_chat_id, COUNT(*) OVER () AS total
       FROM groups_tasks t JOIN crm_activities a ON a.id = t.activity_id JOIN groups_chats c ON c.id = t.chat_id
       WHERE t.user_id = ? AND a.done = 0 AND a.owner_id = ? AND ((a.due_at IS NOT NULL AND a.due_at <= ?) OR t.created_at >= ?)${acc}
       ORDER BY CASE WHEN a.due_at IS NULL THEN 1 ELSE 0 END, a.due_at ASC LIMIT ?`,
    )
    .all(viewer.ws, me, endOfDay, since, ...accArgs, BRIEF_TOP)) as ChatRowLite[];

  // Menciones en notas internas (los avisos de la persona), de chats que todavía ve.
  const notes = (await db
    .prepare(
      `SELECT n.source_id AS id FROM notifications n
       WHERE n.user_id = ? AND n.type = 'mention' AND n.source_type = 'groups_chat' AND n.created_at >= ?
       ORDER BY n.created_at DESC LIMIT 50`,
    )
    .all(me, since)) as Array<{ id: string }>;
  const mentionRows: ChatRowLite[] = [];
  let mentionCount = 0;
  for (const n of notes) {
    if (!n.id || !(await canSeeChat(viewer, n.id))) continue;
    mentionCount++;
    if (mentionRows.some((r) => r.id === n.id)) continue;
    const c = (await db.prepare('SELECT id, name, phone, provider_chat_id FROM groups_chats WHERE id = ? AND user_id = ?').get(n.id, viewer.ws)) as ChatRowLite | undefined;
    if (c) mentionRows.push(c);
  }

  const count = (rows: ChatRowLite[]) => Number(rows[0]?.total ?? 0);
  return {
    app: 'lines',
    items: [
      { kind: 'waiting', count: count(waiting), chats: topChats(viewer, waiting) },
      { kind: 'sla', count: atRisk.length, chats: ticketChats(atRisk) },
      { kind: 'groups', count: count(groups), chats: topChats(viewer, groups) },
      { kind: 'tickets', count: fresh.length, chats: ticketChats(fresh) },
      { kind: 'tasks', count: count(tasks), chats: topChats(viewer, tasks) },
      { kind: 'mentions', count: mentionCount, chats: topChats(viewer, mentionRows) },
    ],
  };
}

type ThreadLite = { id: string; title: string; handle: string; kind: string; total?: number };

const threadName = (t: ThreadLite) => t.title || (t.handle && t.kind !== 'group' ? (t.handle.includes('@') ? t.handle : `+${t.handle}`) : '');

/**
 * Inbox: el resumen de `owner` (su id real). Solo sus filas, en ninguna
 * consulta entra otra persona. `notReply`: una condición extra sobre los
 * chats por responder (alias t), la misma que usa la vista.
 */
export async function inboxBrief(owner: string, now = new Date(), notReply: { sql: string; args: string[] } | null = null): Promise<DailyBrief> {
  const db = getDb();
  const nowS = now.toISOString();
  const since = new Date(now.getTime() - BRIEF_RECENT_MS).toISOString();
  const active = 't.removed_at IS NULL AND t.done_at IS NULL AND t.archived_at IS NULL AND (t.snoozed_until IS NULL OR t.snoozed_until <= ?)';
  const cols = 't.id, t.title, t.handle, t.kind, COUNT(*) OVER () AS total';
  const skip = notReply;

  const reply = (await db
    .prepare(
      `SELECT ${cols} FROM inbox_threads t WHERE t.owner_id = ? AND ${active} AND t.last_from_me = 0 AND t.kind <> 'group' AND t.last_message_at IS NOT NULL${skip ? ` AND NOT ${skip.sql}` : ''}
       ORDER BY t.last_message_at ASC LIMIT ?`,
    )
    .all(owner, nowS, ...(skip?.args ?? []), BRIEF_TOP)) as ThreadLite[];
  const groups = (await db
    .prepare(`SELECT ${cols} FROM inbox_threads t WHERE t.owner_id = ? AND ${active} AND t.kind = 'group' AND t.unread > 0 AND t.last_from_me = 0 ORDER BY t.last_message_at DESC LIMIT ?`)
    .all(owner, nowS, BRIEF_TOP)) as ThreadLite[];
  const reminders = (await db
    .prepare(`SELECT ${cols} FROM inbox_threads t WHERE t.owner_id = ? AND t.removed_at IS NULL AND t.follow_up_at IS NOT NULL AND t.follow_up_at <= ? ORDER BY t.follow_up_at ASC LIMIT ?`)
    .all(owner, nowS, BRIEF_TOP)) as ThreadLite[];

  // Menciones a mi número (el de cada cuenta de WhatsApp) en grupos, en las últimas 24 horas.
  const accounts = (await db.prepare("SELECT id, address FROM inbox_accounts WHERE owner_id = ? AND kind = 'whatsapp'").all(owner)) as Array<{ id: string; address: string }>;
  const mentioned: ThreadLite[] = [];
  let mentionCount = 0;
  for (const a of accounts) {
    const phone = String(a.address ?? '').replace(/\D/g, '');
    if (!/^\d{8,15}$/.test(phone)) continue;
    const rows = (await db
      .prepare(
        `SELECT t.id, t.title, t.handle, t.kind FROM inbox_messages m JOIN inbox_threads t ON t.id = m.thread_id
         WHERE m.owner_id = ? AND t.owner_id = m.owner_id AND t.account_id = ? AND t.kind = 'group' AND t.removed_at IS NULL AND m.from_me = 0 AND m.sent_at >= ?
           AND m.hidden_at IS NULL AND json_valid(m.meta) AND EXISTS (SELECT 1 FROM json_each(json_extract(m.meta, '$.mentions')) je WHERE je.value = ?)
         ORDER BY m.sent_at DESC LIMIT 50`,
      )
      .all(owner, a.id, since, phone)) as ThreadLite[];
    mentionCount += rows.length;
    for (const r of rows) if (!mentioned.some((x) => x.id === r.id)) mentioned.push(r);
  }

  const count = (rows: ThreadLite[]) => Number(rows[0]?.total ?? 0);
  const top = (rows: ThreadLite[]) => rows.slice(0, BRIEF_TOP).map((r) => ({ id: r.id, name: threadName(r) }));
  return {
    app: 'inbox',
    items: [
      { kind: 'reply', count: count(reply), chats: top(reply) },
      { kind: 'reminders', count: count(reminders), chats: top(reminders) },
      { kind: 'unreadGroups', count: count(groups), chats: top(groups) },
      { kind: 'groupMentions', count: mentionCount, chats: top(mentioned) },
    ],
  };
}

// ---------------------------------------------------------------------------
// Estado por persona: cerrada por hoy y el email de la mañana
// ---------------------------------------------------------------------------

/** La tarjeta de esa app quedó cerrada para ese día local. */
export async function briefDismissed(userId: string, app: BriefApp, day: string): Promise<boolean> {
  const row = (await getDb().prepare('SELECT dismissed_day FROM daily_brief_dismissals WHERE user_id = ? AND app = ?').get(userId, app)) as { dismissed_day: string } | undefined;
  return row?.dismissed_day === day;
}

export async function dismissBrief(userId: string, app: BriefApp, day: string): Promise<void> {
  await getDb()
    .prepare(
      `INSERT INTO daily_brief_dismissals (user_id, app, dismissed_day) VALUES (?, ?, ?)
       ON CONFLICT(user_id, app) DO UPDATE SET dismissed_day = excluded.dismissed_day`,
    )
    .run(userId, app, day);
}

export async function briefEmailOn(userId: string): Promise<boolean> {
  const row = (await getDb().prepare('SELECT email FROM daily_brief_prefs WHERE user_id = ?').get(userId)) as { email: number } | undefined;
  return row?.email === 1;
}

export async function setBriefEmail(userId: string, on: boolean, now = new Date()): Promise<void> {
  await getDb()
    .prepare(
      `INSERT INTO daily_brief_prefs (user_id, email, email_day, updated_at) VALUES (?, ?, NULL, ?)
       ON CONFLICT(user_id) DO UPDATE SET email = excluded.email, updated_at = excluded.updated_at`,
    )
    .run(userId, on ? 1 : 0, now.toISOString());
}
