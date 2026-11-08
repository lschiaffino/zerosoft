/**
 * Groups: tareas y recordatorios desde un chat o un mensaje. La tarea es una
 * tarea del CRM (crm_activities, type 'task'): aparece en CRM › Tareas, en el
 * contacto o empresa vinculados al chat, y se completa en cualquiera de los
 * dos lados. groups_tasks guarda de qué chat y mensaje salió, con el mismo
 * id que la tarea del CRM.
 *
 * A la hora de la tarea, /api/cron/minute avisa a quien la tiene (en la app y
 * por email). El claim es reminded_for: el UPDATE compara contra el
 * vencimiento leído, así dos corridas no avisan dos veces y si la tarea se
 * mueve a otra hora vuelve a avisar en la nueva.
 *
 * Las tareas del CRM sobre el contacto o la empresa del chat también se ven
 * en el chat (source 'crm'), para quien usa el CRM y las ve allá: una tarea
 * creada en el contacto aparece en su WhatsApp y al revés. Server-only.
 */
import { getDb } from './db';
import { createActivity, deleteActivity, updateActivity } from './crm';
import { activityScopeSql, sessionScope, type OwnerScope } from './crm-visibility';
import { cleanPriority, type TaskPriority } from './tasks-shared';
import { appSender, escapeHtml, formatWhen, renderBrandedHtml, sendEmail } from './email';
import { createNotification } from './notifications';
import { siteUrl } from './board-urls';
import { safeTimezone } from './notes-reminders';
import { GroupsError, chatDisplayName, getChatRow, getMessageRow } from './groups';
import en from '@/messages/en/groups.json';
import es from '@/messages/es/groups.json';
import pt from '@/messages/pt/groups.json';

type Locale = 'en' | 'es' | 'pt';
type TaskStrings = typeof en.taskEmail;
const STRINGS: Record<Locale, TaskStrings> = {
  en: en.taskEmail,
  es: { ...en.taskEmail, ...es.taskEmail },
  pt: { ...en.taskEmail, ...pt.taskEmail },
};

const MAX_AHEAD_MS = 5 * 365 * 86_400_000;
const PAST_GRACE_MS = 60_000;

export interface GroupTaskDto {
  id: string;
  activityId: string;
  chatId: string;
  chatName: string;
  messageId: string | null;
  messageBody: string;
  title: string;
  notes: string;
  dueAt: string | null;
  done: boolean;
  ownerId: string | null;
  ownerName: string;
  createdAt: string;
  priority: TaskPriority;
  /** 'lines': salió de este chat; 'crm': es del contacto o la empresa del chat. */
  source: 'lines' | 'crm';
}

interface TaskJoin {
  id: string;
  activity_id: string;
  chat_id: string;
  message_id: string | null;
  created_at: string;
  subject: string;
  body: string;
  due_at: string | null;
  done: number;
  owner_id: string | null;
  owner_name: string | null;
  owner_email: string | null;
  priority: string | null;
  source: string;
  chat_name: string;
  chat_phone: string;
  chat_pid: string;
  message_body: string | null;
}

const SELECT = `SELECT t.id, t.activity_id, t.chat_id, t.message_id, t.created_at,
    a.subject, a.body, a.due_at, a.done, a.owner_id, u.name AS owner_name, u.email AS owner_email, a.priority, 'lines' AS source,
    c.name AS chat_name, c.phone AS chat_phone, c.provider_chat_id AS chat_pid, m.body AS message_body
  FROM groups_tasks t
  JOIN crm_activities a ON a.id = t.activity_id
  JOIN groups_chats c ON c.id = t.chat_id
  LEFT JOIN users u ON u.id = a.owner_id
  LEFT JOIN groups_messages m ON m.id = t.message_id`;

/**
 * Tareas del CRM sobre el contacto o la empresa de un chat que no salieron de
 * ese chat. Mismas columnas que SELECT; el id es el de la tarea del CRM.
 */
const SELECT_RECORD = `SELECT a.id AS id, a.id AS activity_id, c.id AS chat_id, NULL AS message_id, a.created_at,
    a.subject, a.body, a.due_at, a.done, a.owner_id, u.name AS owner_name, u.email AS owner_email, a.priority, 'crm' AS source,
    c.name AS chat_name, c.phone AS chat_phone, c.provider_chat_id AS chat_pid, NULL AS message_body
  FROM crm_activities a
  JOIN groups_chats c ON c.user_id = a.user_id
    AND ((a.contact_id IS NOT NULL AND c.crm_contact_id = a.contact_id) OR (a.company_id IS NOT NULL AND c.crm_company_id = a.company_id))
  LEFT JOIN users u ON u.id = a.owner_id
  WHERE a.type = 'task' AND NOT EXISTS (SELECT 1 FROM groups_tasks gt WHERE gt.activity_id = a.id AND gt.chat_id = c.id)`;

/** Visibilidad del CRM de quien mira, o false si no usa el CRM (entonces solo ve las tareas que salieron de chats). */
export async function crmTaskScope(user: { id: string; role: import('./teams').TeamRole; actingUser?: { id: string } | null; apps?: import('./workspace').AppAccess }): Promise<OwnerScope | false> {
  const { canUseApp } = await import('./workspace');
  if (!canUseApp({ role: user.role, apps: user.apps ?? '*' }, 'crm')) return false;
  return sessionScope(user);
}

/** Las tareas del CRM del registro del chat, con la visibilidad del CRM de quien mira (null: no usa el CRM). */
function recordScope(crm: OwnerScope | false | undefined): { sql: string; args: string[] } | null {
  if (crm === false || crm === undefined) return null;
  return activityScopeSql('a', crm);
}

function toDto(r: TaskJoin): GroupTaskDto {
  return {
    id: r.id,
    activityId: r.activity_id,
    chatId: r.chat_id,
    chatName: chatDisplayName({ name: r.chat_name, phone: r.chat_phone, provider_chat_id: r.chat_pid }),
    messageId: r.message_id,
    messageBody: (r.message_body ?? '').slice(0, 280),
    title: r.subject,
    notes: r.body,
    dueAt: dbToIso(r.due_at),
    done: Boolean(r.done),
    ownerId: r.owner_id,
    ownerName: r.owner_name || r.owner_email || '',
    createdAt: r.created_at,
    priority: cleanPriority(r.priority),
    source: r.source === 'crm' ? 'crm' : 'lines',
  };
}

/** Formato de fechas del CRM en la base (crm_activities.due_at): 'YYYY-MM-DD HH:MM:SS' en UTC. */
export function toCrmDate(d: Date): string {
  return d.toISOString().slice(0, 19).replace('T', ' ');
}

/** due_at de la base (formato del CRM o ISO viejo con Z) a ISO completo para el cliente y la API. */
export function dbToIso(raw: string | null): string | null {
  if (!raw) return null;
  const t = Date.parse(raw.includes('T') ? raw : `${raw.replace(' ', 'T')}Z`);
  return Number.isFinite(t) ? new Date(t).toISOString() : null;
}

function cleanDue(raw: string | null | undefined, now = new Date()): string | null {
  if (raw === null || raw === undefined || raw === '') return null;
  const t = Date.parse(raw);
  if (!Number.isFinite(t)) throw new GroupsError('invalid_date');
  if (t < now.getTime() - PAST_GRACE_MS) throw new GroupsError('date_in_past');
  if (t > now.getTime() + MAX_AHEAD_MS) throw new GroupsError('invalid_date');
  return toCrmDate(new Date(t));
}

async function assertPerson(ws: string, personId: string): Promise<void> {
  const { isWorkspacePerson } = await import('./crm-refs');
  if (!(await isWorkspacePerson(ws, personId))) throw new GroupsError('invalid_assignee');
}

/**
 * La tarea de un chat. Con `crm` (la visibilidad del CRM de quien mira),
 * también una tarea del CRM sobre el contacto o la empresa de algún chat.
 */
export async function getGroupTask(ws: string, id: string, crm?: OwnerScope | false): Promise<GroupTaskDto | null> {
  const r = (await getDb().prepare(`${SELECT} WHERE t.id = ? AND t.user_id = ?`).get(id, ws)) as TaskJoin | undefined;
  if (r) return toDto(r);
  const scope = recordScope(crm);
  if (!scope) return null;
  const rec = (await getDb()
    .prepare(`${SELECT_RECORD} AND a.id = ? AND a.user_id = ?${scope.sql ? ` AND ${scope.sql}` : ''} LIMIT 1`)
    .get(id, ws, ...scope.args)) as TaskJoin | undefined;
  return rec ? toDto(rec) : null;
}

export interface CreateTaskInput {
  chatId: string;
  messageId?: string | null;
  title?: string;
  notes?: string;
  dueAt?: string | null;
  ownerId?: string | null;
  locale?: string;
  timezone?: string;
  priority?: TaskPriority;
}

/** Crea la tarea (del CRM) ligada al chat y, si viene, al mensaje. */
export async function createGroupTask(ws: string, actor: string, input: CreateTaskInput, now = new Date()): Promise<GroupTaskDto> {
  const chat = await getChatRow(ws, input.chatId);
  if (!chat) throw new GroupsError('not_found', 404);
  let messageBody = '';
  if (input.messageId) {
    const msg = await getMessageRow(ws, input.messageId);
    if (!msg || msg.chat_id !== chat.id) throw new GroupsError('invalid_message');
    messageBody = msg.body;
  }
  const title = (input.title ?? '').trim().slice(0, 200) || messageBody.split('\n').find((l) => l.trim())?.trim().slice(0, 120) || '';
  if (!title) throw new GroupsError('invalid_title');
  const dueAt = cleanDue(input.dueAt, now);
  const ownerId = input.ownerId || actor;
  await assertPerson(ws, ownerId);
  const notes = (input.notes ?? '').trim().slice(0, 4000);
  const activity = await createActivity(ws, {
    type: 'task',
    subject: title,
    body: notes || (messageBody ? `${chatDisplayName(chat)}: ${messageBody.slice(0, 1000)}` : chatDisplayName(chat)),
    dueAt,
    ownerId,
    priority: cleanPriority(input.priority),
    contactId: chat.crm_contact_id,
    companyId: chat.crm_company_id,
  });
  // Mismo id que la tarea del CRM: un solo id en Groups, CRM, ⌘K y la API.
  const id = activity.id;
  const locale = input.locale === 'es' || input.locale === 'pt' ? input.locale : 'en';
  await getDb()
    .prepare(
      'INSERT INTO groups_tasks (id, user_id, chat_id, message_id, activity_id, created_by, locale, timezone, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)',
    )
    .run(id, ws, chat.id, input.messageId ?? null, activity.id, actor, locale, safeTimezone(input.timezone), now.toISOString());
  // Vínculos de la tarea de la suite (lib/tasks.ts): el CRM, el inicio y la API muestran de qué chat salió.
  const link = getDb().prepare(
    'INSERT OR IGNORE INTO task_links (task_id, workspace_id, kind, ref_id, created_by, created_at) VALUES (?, ?, ?, ?, ?, ?)',
  );
  await link.run(id, ws, 'lines_chat', chat.id, actor, now.toISOString());
  if (input.messageId) await link.run(id, ws, 'lines_message', input.messageId, actor, now.toISOString());
  return (await getGroupTask(ws, id)) as GroupTaskDto;
}

export interface TaskQuery {
  chatId?: string;
  status?: 'open' | 'done' | 'all';
  /** 'me' o el id de una persona. */
  ownerId?: string;
  q?: string;
  limit?: number;
  /** Con chatId: sumar las tareas del CRM del contacto o la empresa del chat, con esta visibilidad. */
  crm?: OwnerScope | false;
}

/** Tareas de Groups: abiertas primero por vencimiento (las sin fecha al final). */
export async function listGroupTasks(ws: string, me: string, query: TaskQuery = {}): Promise<GroupTaskDto[]> {
  const where = ['t.user_id = ?'];
  const args: Array<string | number> = [ws];
  const status = query.status ?? 'open';
  if (status === 'open') where.push('a.done = 0');
  if (status === 'done') where.push('a.done = 1');
  if (query.chatId) {
    where.push('t.chat_id = ?');
    args.push(query.chatId);
  }
  if (query.ownerId) {
    where.push('a.owner_id = ?');
    args.push(query.ownerId === 'me' ? me : query.ownerId);
  }
  if (query.q?.trim()) {
    where.push(`(a.subject LIKE ? ESCAPE '\\' OR c.name LIKE ? ESCAPE '\\')`);
    const like = `%${query.q.trim().slice(0, 100).replace(/[\\%_]/g, (ch) => `\\${ch}`)}%`;
    args.push(like, like);
  }
  const limit = Math.min(Math.max(1, query.limit ?? 200), 500);
  const rows = (await getDb()
    .prepare(`${SELECT} WHERE ${where.join(' AND ')} ORDER BY a.done ASC, CASE WHEN a.due_at IS NULL THEN 1 ELSE 0 END, a.due_at ASC, t.created_at DESC LIMIT ?`)
    .all(...args, limit)) as TaskJoin[];
  const scope = query.chatId ? recordScope(query.crm) : null;
  if (scope) {
    const rWhere = ['c.id = ?', 'a.user_id = ?'];
    const rArgs: Array<string | number> = [query.chatId as string, ws];
    if (status === 'open') rWhere.push('a.done = 0');
    if (status === 'done') rWhere.push('a.done = 1');
    if (query.ownerId) {
      rWhere.push('a.owner_id = ?');
      rArgs.push(query.ownerId === 'me' ? me : query.ownerId);
    }
    if (query.q?.trim()) {
      rWhere.push(`a.subject LIKE ? ESCAPE '\\'`);
      rArgs.push(`%${query.q.trim().slice(0, 100).replace(/[\\%_]/g, (ch) => `\\${ch}`)}%`);
    }
    if (scope.sql) {
      rWhere.push(scope.sql);
      rArgs.push(...scope.args);
    }
    const extra = (await getDb()
      .prepare(`${SELECT_RECORD} AND ${rWhere.join(' AND ')} LIMIT ?`)
      .all(...rArgs, limit)) as TaskJoin[];
    rows.push(...extra);
    rows.sort(
      (x, y) =>
        x.done - y.done ||
        (x.due_at ? 0 : 1) - (y.due_at ? 0 : 1) ||
        (x.due_at ?? '').localeCompare(y.due_at ?? '') ||
        y.created_at.localeCompare(x.created_at),
    );
  }
  return rows.slice(0, limit).map(toDto);
}

export interface TaskPatch {
  title?: string;
  notes?: string;
  dueAt?: string | null;
  ownerId?: string | null;
  done?: boolean;
  priority?: TaskPriority;
}

export async function updateGroupTask(ws: string, id: string, patch: TaskPatch, crm?: OwnerScope | false): Promise<GroupTaskDto> {
  const task = await getGroupTask(ws, id, crm);
  if (!task) throw new GroupsError('not_found', 404);
  const data: Parameters<typeof updateActivity>[2] = {};
  if (patch.title !== undefined) {
    const t = patch.title.trim().slice(0, 200);
    if (!t) throw new GroupsError('invalid_title');
    data.subject = t;
  }
  if (patch.notes !== undefined) data.body = patch.notes.trim().slice(0, 4000);
  if (patch.dueAt !== undefined) data.dueAt = cleanDue(patch.dueAt);
  if (patch.ownerId !== undefined) {
    if (patch.ownerId) await assertPerson(ws, patch.ownerId);
    data.ownerId = patch.ownerId || null;
  }
  if (patch.done !== undefined) data.done = patch.done;
  if (patch.priority !== undefined) data.priority = cleanPriority(patch.priority);
  await updateActivity(ws, task.activityId, data);
  return (await getGroupTask(ws, id, crm)) as GroupTaskDto;
}

/** Borra una tarea que salió de un chat (las del CRM se borran en el CRM). */
export async function deleteGroupTask(ws: string, id: string): Promise<boolean> {
  const task = await getGroupTask(ws, id);
  if (!task) return false;
  await deleteActivity(ws, task.activityId).catch(() => false);
  return (await getDb().prepare('DELETE FROM groups_tasks WHERE id = ? AND user_id = ?').run(id, ws)).changes > 0;
}

function fill(s: string, vars: Record<string, string>): string {
  let out = s;
  for (const [k, v] of Object.entries(vars)) out = out.split(`{${k}}`).join(v);
  return out;
}

export function buildTaskEmail(
  t: { title: string; chatName: string; dueAt: string; timezone?: string },
  locale: Locale,
  link: string,
): { subject: string; text: string; html: string } {
  const s = STRINGS[locale];
  const when = formatWhen(new Date(dbToIso(t.dueAt) ?? t.dueAt), safeTimezone(t.timezone), locale);
  const vars = { title: t.title, chat: t.chatName, when };
  const subject = fill(s.subject, vars);
  const lines = [fill(s.body, vars), fill(s.chat, vars)];
  return {
    subject,
    text: [...lines, '', `${s.open}: ${link}`, '', s.why].join('\n'),
    html: renderBrandedHtml({
      heading: s.heading,
      eyebrow: 'zerosoft · groups',
      paragraphs: [...lines.map(escapeHtml), `<a href="${escapeHtml(link)}">${escapeHtml(s.open)}</a>`, `<span style="color:#888888;font-size:12px;">${escapeHtml(s.why)}</span>`],
    }),
  };
}

/** Cron: avisa las tareas que llegaron a su hora. Devuelve cuántas avisó. */
export async function fireTaskReminders(opts: { now?: Date; limit?: number } = {}): Promise<number> {
  const db = getDb();
  // Mismo formato que due_at (el del CRM): la comparación es de texto.
  const now = toCrmDate(opts.now ?? new Date());
  const rows = (await db
    .prepare(
      `SELECT t.id, t.user_id, t.chat_id, t.created_by, t.locale, t.timezone, a.subject, a.due_at, a.owner_id, c.name AS chat_name, c.phone AS chat_phone,
         c.provider_chat_id AS chat_pid, u.email AS owner_email
       FROM groups_tasks t JOIN crm_activities a ON a.id = t.activity_id JOIN groups_chats c ON c.id = t.chat_id
       LEFT JOIN users u ON u.id = COALESCE(a.owner_id, t.created_by)
       WHERE a.done = 0 AND a.due_at IS NOT NULL AND datetime(a.due_at) <= datetime(?) AND (t.reminded_for IS NULL OR t.reminded_for != a.due_at)
       ORDER BY a.due_at ASC LIMIT ?`,
    )
    .all(now, Math.min(Math.max(opts.limit ?? 200, 1), 1000))) as Array<{
    id: string;
    user_id: string;
    chat_id: string;
    created_by: string | null;
    locale: string;
    timezone: string;
    subject: string;
    due_at: string;
    owner_id: string | null;
    chat_name: string;
    chat_phone: string;
    chat_pid: string;
    owner_email: string | null;
  }>;
  let fired = 0;
  for (const r of rows) {
    const claim = await db
      .prepare('UPDATE groups_tasks SET reminded_for = ? WHERE id = ? AND (reminded_for IS NULL OR reminded_for != ?)')
      .run(r.due_at, r.id, r.due_at);
    if (!claim.changes) continue;
    fired++;
    const person = r.owner_id ?? r.created_by;
    const locale: Locale = r.locale === 'es' || r.locale === 'pt' ? r.locale : 'en';
    const chatName = chatDisplayName({ name: r.chat_name, phone: r.chat_phone, provider_chat_id: r.chat_pid });
    const href = `/app/groups/inbox/${encodeURIComponent(r.chat_id)}`;
    const mail = buildTaskEmail({ title: r.subject, chatName, dueAt: r.due_at, timezone: r.timezone }, locale, `${siteUrl()}/${locale}${href}`);
    if (person) {
      await createNotification({
        userId: person,
        type: 'groups_reminder',
        title: fill(STRINGS[locale].notification, { title: r.subject }),
        body: chatName,
        href,
        sourceType: 'groups_task',
        sourceId: r.id,
      }).catch(() => undefined);
    }
    if (r.owner_email) await sendEmail({ to: r.owner_email, from: appSender(), ...mail }).catch(() => undefined);
  }
  return fired;
}
