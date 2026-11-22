/**
 * CRM, listado de tareas como tabla (bloque A3, el índice de Tareas de
 * HubSpot): vistas por vencimiento, filtros por tipo, prioridad, owner, cola,
 * proyecto y texto, orden por columna y páginas. Server-only.
 *
 * Privacidad, igual que el resto del CRM:
 * - workspace: todo va con `a.user_id = ?`;
 * - registros: solo tareas cuyos registros asociados se ven (activityScopeSql),
 *   así que contacto, empresa y deal de cada fila se ven;
 * - chats de Lines: una tarea de un chat que quien mira no ve sale con el
 *   marcador y sin notas, y su texto no cuenta para la búsqueda;
 * - colas: la cola privada de otra persona sale vacía, y filtrar por una cola
 *   que no se ve no trae nada.
 */
import { getDb } from './db';
import { activityScopeSql, type OwnerScope } from './crm-visibility';
import { escapeLike } from './crm-filters';
import type { ChatReader } from './crm-chat-privacy';
import { dayRangeUtc, tzOffsetMinutes } from './user-tz';
import { withQueueNames, visibleQueueIds, type QueueViewer } from './crm-task-queues';
import type { CrmActivityRow } from './schema/types';
import { TASK_PAGE_SIZE, type TaskIndexFilter } from './crm-tasks-shared';

export interface TaskIndexRow extends CrmActivityRow {
  contact_name: string | null;
  company_name: string | null;
  deal_name: string | null;
  project_name: string | null;
  project_color: string | null;
  queue_name: string | null;
  chat_private?: 1;
}

export interface TaskIndexContext {
  workspaceId: string;
  viewer: QueueViewer;
  ownerScope: OwnerScope | undefined;
  chatReader?: ChatReader | null;
  timeZone: string;
  now?: Date;
}

/**
 * Condiciones del filtro sobre `crm_activities` con alias `a` (sin el WHERE).
 * También las usa la cola de trabajo para "Empezar" desde una vista.
 */
export async function taskFilterWhere(
  f: Omit<TaskIndexFilter, 'sort'>,
  ctx: TaskIndexContext,
): Promise<{ where: string[]; args: Array<string | number> }> {
  const where: string[] = ['a.user_id = ?', "a.type = 'task'"];
  const args: Array<string | number> = [ctx.workspaceId];
  const { start, end } = dayRangeUtc(ctx.timeZone, ctx.now ?? new Date());
  switch (f.bucket) {
    case 'all':
      where.push('a.done = 0');
      break;
    case 'overdue':
      where.push('a.done = 0 AND a.due_at IS NOT NULL AND a.due_at < ?');
      args.push(start);
      break;
    case 'today':
      where.push('a.done = 0 AND a.due_at >= ? AND a.due_at <= ?');
      args.push(start, end);
      break;
    case 'upcoming':
      where.push('a.done = 0 AND (a.due_at IS NULL OR a.due_at > ?)');
      args.push(end);
      break;
    case 'done':
      where.push('a.done = 1');
      break;
  }
  if (f.kind === 'todo') where.push("COALESCE(a.task_kind, '') = ''");
  else if (f.kind) {
    where.push('a.task_kind = ?');
    args.push(f.kind);
  }
  if (f.priority === 'none') where.push("COALESCE(a.priority, '') = ''");
  else if (f.priority) {
    where.push('a.priority = ?');
    args.push(f.priority);
  }
  if (f.owner === 'unassigned') where.push('a.owner_id IS NULL');
  else if (f.owner) {
    const person = f.owner === 'me' ? ctx.viewer.personId : f.owner;
    // Las tareas sin owner son del dueño del workspace (como en la cola de trabajo).
    where.push(person === ctx.workspaceId ? 'COALESCE(a.owner_id, a.user_id) = ?' : 'a.owner_id = ?');
    args.push(person);
  }
  if (f.queueId) {
    // Una cola que la persona no ve no filtra por nada que exista para ella.
    const visible = await visibleQueueIds(ctx.viewer);
    if (!visible.has(f.queueId)) where.push('0');
    else {
      where.push('a.queue_id = ?');
      args.push(f.queueId);
    }
  }
  if (f.projectId) {
    where.push('a.project_id = ?');
    args.push(f.projectId);
  }
  if (f.q) {
    const like = `%${escapeLike(f.q)}%`;
    const hidden = ctx.chatReader ? (await import('./crm-chat-privacy')).chatHiddenSql('a', ctx.chatReader) : null;
    where.push(`(((a.subject LIKE ? ESCAPE '\\' OR a.body LIKE ? ESCAPE '\\')${hidden ? ` AND NOT ${hidden.sql}` : ''})
      OR c.first_name LIKE ? ESCAPE '\\' OR c.last_name LIKE ? ESCAPE '\\' OR co.name LIKE ? ESCAPE '\\' OR d.name LIKE ? ESCAPE '\\')`);
    args.push(like, like, ...(hidden?.args ?? []), like, like, like, like);
  }
  const vis = activityScopeSql('a', ctx.ownerScope);
  if (vis.sql) {
    where.push(vis.sql);
    args.push(...vis.args);
  }
  return { where, args };
}

const ORDER: Record<TaskIndexFilter['sort'], string> = {
  due: 'a.due_at IS NULL, a.due_at ASC, a.created_at DESC',
  '-due': 'a.due_at IS NULL, a.due_at DESC, a.created_at DESC',
  priority:
    "CASE a.priority WHEN 'high' THEN 0 WHEN 'medium' THEN 1 WHEN 'low' THEN 2 ELSE 3 END ASC, a.due_at IS NULL, a.due_at ASC",
  '-priority':
    "CASE a.priority WHEN 'high' THEN 0 WHEN 'medium' THEN 1 WHEN 'low' THEN 2 ELSE 3 END DESC, a.due_at IS NULL, a.due_at ASC",
  created: 'a.created_at ASC',
  '-created': 'a.created_at DESC',
  subject: 'a.subject COLLATE NOCASE ASC',
  '-subject': 'a.subject COLLATE NOCASE DESC',
};

/**
 * Orden del listado. Por título, una tarea de un chat que quien mira no ve se
 * ordena como si no tuviera título: su lugar no deja adivinar el texto.
 */
async function orderFor(sort: TaskIndexFilter['sort'], ctx: TaskIndexContext): Promise<{ sql: string; args: string[] }> {
  if ((sort === 'subject' || sort === '-subject') && ctx.chatReader) {
    const hidden = (await import('./crm-chat-privacy')).chatHiddenSql('a', ctx.chatReader);
    if (hidden) {
      return {
        sql: `CASE WHEN ${hidden.sql} THEN '' ELSE a.subject END COLLATE NOCASE ${sort === 'subject' ? 'ASC' : 'DESC'}`,
        args: hidden.args,
      };
    }
  }
  return { sql: ORDER[sort], args: [] };
}

const JOINS = `
  FROM crm_activities a
  LEFT JOIN crm_contacts c ON c.id = a.contact_id
  LEFT JOIN crm_companies co ON co.id = a.company_id
  LEFT JOIN crm_deals d ON d.id = a.deal_id
  LEFT JOIN crm_task_projects p ON p.id = a.project_id`;

/** Una página del listado y el total. */
export async function listTaskIndex(
  f: TaskIndexFilter,
  ctx: TaskIndexContext,
  page = 1,
  pageSize = TASK_PAGE_SIZE,
): Promise<{ rows: TaskIndexRow[]; total: number }> {
  const db = getDb();
  const { where, args } = await taskFilterWhere(f, ctx);
  const size = Math.min(Math.max(pageSize, 1), 200);
  const offset = (Math.max(page, 1) - 1) * size;
  const order = await orderFor(f.sort, ctx);
  const [rows, count] = await Promise.all([
    db
      .prepare(
        `SELECT a.*, NULLIF(trim(c.first_name || ' ' || c.last_name), '') AS contact_name, co.name AS company_name,
           d.name AS deal_name, p.name AS project_name, p.color AS project_color
         ${JOINS}
         WHERE ${where.join(' AND ')}
         ORDER BY ${order.sql}
         LIMIT ? OFFSET ?`,
      )
      .all(...args, ...order.args, size, offset) as Promise<TaskIndexRow[]>,
    db.prepare(`SELECT COUNT(*) AS c ${JOINS} WHERE ${where.join(' AND ')}`).get(...args) as Promise<{ c: number } | undefined>,
  ]);
  let out = rows;
  if (ctx.chatReader && out.length) {
    const { redactChatTasks } = await import('./crm-chat-privacy');
    out = await redactChatTasks(ctx.workspaceId, out, ctx.chatReader);
  }
  return { rows: await withQueueNames(ctx.viewer, out), total: Number(count?.c ?? 0) };
}

/** Cuántas tareas abiertas tiene cada cola visible, con el alcance de quien mira. */
export async function openCountsByQueue(ctx: TaskIndexContext): Promise<Map<string, number>> {
  const vis = activityScopeSql('a', ctx.ownerScope);
  const rows = (await getDb()
    .prepare(
      `SELECT a.queue_id AS q, COUNT(*) AS c FROM crm_activities a
       WHERE a.user_id = ? AND a.type = 'task' AND a.done = 0 AND a.queue_id IS NOT NULL${vis.sql ? ` AND ${vis.sql}` : ''}
       GROUP BY a.queue_id`,
    )
    .all(ctx.workspaceId, ...vis.args)) as Array<{ q: string; c: number }>;
  const visible = await visibleQueueIds(ctx.viewer);
  return new Map(rows.filter((r) => visible.has(r.q)).map((r) => [r.q, Number(r.c)]));
}

/**
 * La fecha nueva con la hora local que ya tenía la tarea (o 9:00 si no tenía), en UTC 'YYYY-MM-DD HH:MM'.
 */
export function dueOnDate(existingUtc: string | null, date: string, tz: string): string {
  const pad = (n: number) => String(n).padStart(2, '0');
  let hh = 9;
  let mm = 0;
  if (existingUtc && existingUtc.length > 10) {
    const at = new Date(`${existingUtc.trim().replace(' ', 'T').slice(0, 16)}:00Z`);
    if (!Number.isNaN(at.getTime())) {
      const local = new Date(at.getTime() + tzOffsetMinutes(tz, at) * 60000);
      hh = local.getUTCHours();
      mm = local.getUTCMinutes();
    }
  }
  const [y, mo, d] = date.split('-').map(Number);
  const asIfUtc = Date.UTC(y, mo - 1, d, hh, mm);
  const utc = new Date(asIfUtc - tzOffsetMinutes(tz, new Date(asIfUtc)) * 60000);
  return `${utc.getUTCFullYear()}-${pad(utc.getUTCMonth() + 1)}-${pad(utc.getUTCDate())} ${pad(utc.getUTCHours())}:${pad(utc.getUTCMinutes())}`;
}
