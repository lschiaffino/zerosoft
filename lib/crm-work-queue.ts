/**
 * CRM — cola de trabajo diaria (como "Start tasks" de HubSpot): las tareas
 * abiertas vencidas y de hoy, incluidos los pasos manuales de las secuencias,
 * con el contexto del registro para trabajarlas una por una sin salir de la
 * cola. Server-only. Completar, posponer y borrar usan la API de actividades.
 */
import { getDb } from './db';
import { activityScopeSql, type OwnerScope } from './crm-visibility';
import { dayRangeUtc } from './user-tz';

export type QueueScope = 'due' | 'overdue' | 'today';
export const QUEUE_SCOPES: readonly QueueScope[] = ['due', 'overdue', 'today'];

export interface QueueTask {
  id: string;
  subject: string;
  body: string;
  due_at: string | null;
  overdue: boolean;
  owner_id: string | null;
  /** Tipo de tarea: '' = to-do, 'call' o 'email'. */
  kind: '' | 'call' | 'email';
  sequence: { id: string; name: string } | null;
  contact: {
    id: string;
    name: string;
    email: string;
    phone: string;
    job_title: string;
    company_name: string | null;
  } | null;
  company: { id: string; name: string; domain: string; phone: string } | null;
  deal: { id: string; name: string; amount: number; currency: string; stage: string | null } | null;
}

interface QueueRow {
  id: string;
  subject: string;
  body: string;
  due_at: string | null;
  owner_id: string | null;
  task_kind: string | null;
  sequence_id: string | null;
  sequence_name: string | null;
  contact_id: string | null;
  c_first: string | null;
  c_last: string | null;
  c_email: string | null;
  c_phone: string | null;
  c_title: string | null;
  c_company: string | null;
  company_id: string | null;
  co_name: string | null;
  co_domain: string | null;
  co_phone: string | null;
  deal_id: string | null;
  d_name: string | null;
  d_amount: number | null;
  d_currency: string | null;
  d_stage: string | null;
}

export function parseQueueScope(v: unknown): QueueScope {
  return typeof v === 'string' && (QUEUE_SCOPES as readonly string[]).includes(v) ? (v as QueueScope) : 'due';
}

/**
 * Tareas abiertas de la cola: vencidas y/o de hoy (en la zona horaria de la
 * persona), de la más vieja a la más nueva. `ownerId` = de quién es la cola.
 */
export async function listQueueTasks(
  workspaceId: string,
  opts: { ownerId?: string | null; scope?: QueueScope; timeZone?: string; ownerScope?: OwnerScope; now?: Date; limit?: number } = {},
): Promise<QueueTask[]> {
  const { start, end } = dayRangeUtc(opts.timeZone ?? 'UTC', opts.now ?? new Date());
  const scope = opts.scope ?? 'due';
  const where: string[] = ["a.user_id = ?", "a.type = 'task'", 'a.done = 0', 'a.due_at IS NOT NULL'];
  const args: Array<string | number> = [workspaceId];
  if (scope === 'overdue') {
    where.push('a.due_at < ?');
    args.push(start);
  } else if (scope === 'today') {
    where.push('a.due_at >= ? AND a.due_at <= ?');
    args.push(start, end);
  } else {
    where.push('a.due_at <= ?');
    args.push(end);
  }
  if (opts.ownerId) {
    where.push('COALESCE(a.owner_id, a.user_id) = ?');
    args.push(opts.ownerId);
  }
  const vis = activityScopeSql('a', opts.ownerScope);
  if (vis.sql) {
    where.push(vis.sql);
    args.push(...vis.args);
  }
  args.push(Math.min(opts.limit ?? 200, 500));
  const rows = (await getDb()
    .prepare(
      `SELECT a.id, a.subject, a.body, a.due_at, a.owner_id, a.task_kind, a.sequence_id, sq.name AS sequence_name,
         a.contact_id, c.first_name AS c_first, c.last_name AS c_last, c.email AS c_email, c.phone AS c_phone,
         c.job_title AS c_title, cco.name AS c_company,
         a.company_id, co.name AS co_name, co.domain AS co_domain, co.phone AS co_phone,
         a.deal_id, d.name AS d_name, d.amount AS d_amount, d.currency AS d_currency, st.name AS d_stage
       FROM crm_activities a
       LEFT JOIN crm_contacts c ON c.id = a.contact_id
       LEFT JOIN crm_companies cco ON cco.id = c.company_id
       LEFT JOIN crm_companies co ON co.id = a.company_id
       LEFT JOIN crm_deals d ON d.id = a.deal_id
       LEFT JOIN crm_stages st ON st.id = d.stage_id
       LEFT JOIN crm_sequences sq ON sq.id = a.sequence_id
       WHERE ${where.join(' AND ')}
       ORDER BY a.due_at ASC, a.created_at ASC
       LIMIT ?`,
    )
    .all(...args)) as QueueRow[];
  return rows.map((r) => toQueueTask(r, start));
}

function toQueueTask(r: QueueRow, todayStart: string): QueueTask {
  return {
    id: r.id,
    subject: r.subject,
    body: r.body,
    due_at: r.due_at,
    overdue: !!r.due_at && r.due_at < todayStart,
    owner_id: r.owner_id,
    kind: r.task_kind === 'call' || r.task_kind === 'email' ? r.task_kind : '',
    sequence: r.sequence_id ? { id: r.sequence_id, name: r.sequence_name ?? '' } : null,
    contact: r.contact_id
      ? {
          id: r.contact_id,
          name: [r.c_first, r.c_last].filter(Boolean).join(' ').trim() || (r.c_email ?? ''),
          email: r.c_email ?? '',
          phone: r.c_phone ?? '',
          job_title: r.c_title ?? '',
          company_name: r.c_company,
        }
      : null,
    company: r.company_id ? { id: r.company_id, name: r.co_name ?? '', domain: r.co_domain ?? '', phone: r.co_phone ?? '' } : null,
    deal: r.deal_id
      ? { id: r.deal_id, name: r.d_name ?? '', amount: Number(r.d_amount ?? 0), currency: r.d_currency ?? 'USD', stage: r.d_stage }
      : null,
  };
}

/** Cuántas tareas tiene la cola (para el botón "Empezar cola"). */
export async function countQueueTasks(
  workspaceId: string,
  opts: { ownerId?: string | null; timeZone?: string; ownerScope?: OwnerScope; now?: Date } = {},
): Promise<number> {
  const { end } = dayRangeUtc(opts.timeZone ?? 'UTC', opts.now ?? new Date());
  const where = ["a.user_id = ?", "a.type = 'task'", 'a.done = 0', 'a.due_at IS NOT NULL', 'a.due_at <= ?'];
  const args: Array<string | number> = [workspaceId, end];
  if (opts.ownerId) {
    where.push('COALESCE(a.owner_id, a.user_id) = ?');
    args.push(opts.ownerId);
  }
  const vis = activityScopeSql('a', opts.ownerScope);
  if (vis.sql) {
    where.push(vis.sql);
    args.push(...vis.args);
  }
  const row = (await getDb()
    .prepare(`SELECT COUNT(*) AS c FROM crm_activities a WHERE ${where.join(' AND ')}`)
    .get(...args)) as { c: number } | undefined;
  return Number(row?.c ?? 0);
}

/**
 * Posponer: la nueva fecha según la opción, en la zona de la persona.
 * 'tomorrow' y 'next_week' caen a las 9:00 locales; '1h' y '3h' desde ahora.
 */
export type SnoozeOption = '1h' | '3h' | 'tomorrow' | 'two_days' | 'next_week';
export const SNOOZE_OPTIONS: readonly SnoozeOption[] = ['1h', '3h', 'tomorrow', 'two_days', 'next_week'];

export function snoozeUntil(option: SnoozeOption, timeZone: string, now: Date = new Date()): Date {
  if (option === '1h') return new Date(now.getTime() + 3_600_000);
  if (option === '3h') return new Date(now.getTime() + 3 * 3_600_000);
  const days = option === 'tomorrow' ? 1 : option === 'two_days' ? 2 : 7;
  const { start } = dayRangeUtc(timeZone, now);
  const startMs = new Date(`${start.replace(' ', 'T')}Z`).getTime();
  return new Date(startMs + days * 86_400_000 + 9 * 3_600_000);
}
