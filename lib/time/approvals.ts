/**
 * Time: aprobación de horas por semana, como en Harvest. Server-only.
 *
 * - La persona envía su semana (lunes a domingo). Desde ahí las entradas de
 *   esa semana quedan trabadas: no se crean, editan ni borran.
 * - Mientras está pendiente la puede retirar y vuelve a quedar abierta.
 * - Quien administra la aprueba (sigue trabada) o la devuelve con una nota
 *   (se destraba). Una semana aprobada se puede reabrir: queda devuelta.
 * - Todo dentro del workspace del actor. Un miembro ve solo sus semanas.
 */
import { getDb } from '../db';
import { createNotification } from '../notifications';
import { localized } from '../notification-copy';
import { workspaceMemberSql } from '../workspace';
import { listTimePeople } from './core';
import { addDays, isIsoDate, MAX_SHEET_NOTE, nextSheetStatus, sheetLocked, TimeError, weekStart, type SheetAction, type SheetStatus, type TimeActor } from './types';

const now = () => new Date().toISOString();

export interface SheetInfo {
  personId: string;
  week: string;
  status: SheetStatus;
  note: string;
  submittedAt: string | null;
  decidedAt: string | null;
  decidedByName: string | null;
}

interface SheetRow {
  person_id: string;
  week_start: string;
  status: string;
  note: string;
  submitted_at: string;
  decided_at: string | null;
  decided_by_name: string | null;
}

const SHEET_SELECT = `SELECT s.person_id, s.week_start, s.status, s.note, s.submitted_at, s.decided_at,
  COALESCE(NULLIF(d.name, ''), d.email) AS decided_by_name
  FROM time_timesheets s LEFT JOIN users d ON d.id = s.decided_by`;

function toInfo(r: SheetRow): SheetInfo {
  return {
    personId: r.person_id,
    week: r.week_start,
    status: (['submitted', 'approved', 'returned'].includes(r.status) ? r.status : 'open') as SheetStatus,
    note: r.note ?? '',
    submittedAt: r.submitted_at,
    decidedAt: r.decided_at,
    decidedByName: r.decided_by_name,
  };
}

function openSheet(personId: string, week: string): SheetInfo {
  return { personId, week, status: 'open', note: '', submittedAt: null, decidedAt: null, decidedByName: null };
}

/** Estado de la semana de una persona (la que contiene `date`). */
export async function sheetOf(ws: string, personId: string, date: string): Promise<SheetInfo> {
  const week = weekStart(date);
  const row = (await getDb().prepare(`${SHEET_SELECT} WHERE s.workspace_id = ? AND s.person_id = ? AND s.week_start = ?`).get(ws, personId, week)) as unknown as SheetRow | undefined;
  return row ? toInfo(row) : openSheet(personId, week);
}

/** Falla con `locked` si la semana de `date` de la persona está pendiente o aprobada. */
export async function assertWeekOpen(actor: TimeActor, ...dates: string[]): Promise<void> {
  for (const week of new Set(dates.filter(isIsoDate).map(weekStart))) {
    const row = (await getDb().prepare('SELECT status FROM time_timesheets WHERE workspace_id = ? AND person_id = ? AND week_start = ?').get(actor.ws, actor.person, week)) as
      | { status: SheetStatus }
      | undefined;
    if (sheetLocked(row?.status)) throw new TimeError('locked', 409);
  }
}

export interface SheetListItem extends SheetInfo {
  personName: string;
  minutes: number;
  billableMinutes: number;
}

/**
 * Semanas enviadas, de la más nueva a la más vieja. Quien administra ve las de
 * todo el workspace; un miembro, solo las suyas. `status` filtra.
 */
export async function listSheets(actor: TimeActor, opts: { status?: Exclude<SheetStatus, 'open'> } = {}): Promise<SheetListItem[]> {
  const where = ['s.workspace_id = ?'];
  const args: string[] = [actor.ws];
  if (!actor.admin) {
    where.push('s.person_id = ?');
    args.push(actor.person);
  }
  if (opts.status) {
    where.push('s.status = ?');
    args.push(opts.status);
  }
  const rows = (await getDb()
    .prepare(
      `SELECT s.person_id, s.week_start, s.status, s.note, s.submitted_at, s.decided_at,
         COALESCE(NULLIF(d.name, ''), d.email) AS decided_by_name,
         COALESCE(NULLIF(u.name, ''), u.email, '') AS person_name,
         (SELECT COALESCE(SUM(e.minutes), 0) FROM time_entries e WHERE e.workspace_id = s.workspace_id AND e.person_id = s.person_id
            AND e.spent_date BETWEEN s.week_start AND date(s.week_start, '+6 days')) AS minutes,
         (SELECT COALESCE(SUM(e.minutes), 0) FROM time_entries e WHERE e.workspace_id = s.workspace_id AND e.person_id = s.person_id
            AND e.billable = 1 AND e.spent_date BETWEEN s.week_start AND date(s.week_start, '+6 days')) AS billable_minutes
       FROM time_timesheets s LEFT JOIN users d ON d.id = s.decided_by LEFT JOIN users u ON u.id = s.person_id
       WHERE ${where.join(' AND ')}
       ORDER BY s.week_start DESC, person_name COLLATE NOCASE
       LIMIT 300`,
    )
    .all(...args)) as unknown as Array<SheetRow & { person_name: string; minutes: number; billable_minutes: number }>;
  return rows.map((r) => ({ ...toInfo(r), personName: r.person_name, minutes: Number(r.minutes), billableMinutes: Number(r.billable_minutes) }));
}

/** Semanas pendientes del workspace (para el número en la navegación de quien administra). */
export async function countPendingSheets(actor: TimeActor): Promise<number> {
  if (!actor.admin) return 0;
  const row = (await getDb().prepare("SELECT COUNT(*) AS n FROM time_timesheets WHERE workspace_id = ? AND status = 'submitted'").get(actor.ws)) as { n: number } | undefined;
  return Number(row?.n ?? 0);
}

export interface SheetActionInput {
  action: SheetAction;
  /** Cualquier día de la semana; se usa su lunes. */
  week: string;
  /** De quién es la semana. Sin esto, la del actor. */
  personId?: string;
  note?: string;
}

/** Owners y admins del workspace con Time, menos `except` (a quiénes avisar de una semana enviada). */
async function approvers(ws: string, except: string): Promise<string[]> {
  const people = new Set((await listTimePeople(ws)).map((p) => p.id));
  const admins = (await getDb()
    .prepare(
      `SELECT DISTINCT u.id FROM users u WHERE ${workspaceMemberSql('?', 'u.id')}
         AND (u.id = ? OR EXISTS (SELECT 1 FROM team_members m JOIN teams t ON t.id = m.team_id WHERE t.owner_id = ? AND m.user_id = u.id AND m.role = 'admin'))`,
    )
    .all(ws, ws, ws)) as Array<{ id: string }>;
  return admins.map((r) => r.id).filter((id) => id !== except && people.has(id));
}

/**
 * Envía, retira, aprueba, devuelve o reabre una semana. Cada cambio se escribe
 * comparando el estado que se leyó: dos pedidos a la vez no pisan uno al otro.
 */
export async function actOnSheet(actor: TimeActor, input: SheetActionInput): Promise<SheetInfo> {
  if (!isIsoDate(input.week)) throw new TimeError('invalid_input', 400);
  const week = weekStart(input.week);
  const personId = input.personId || actor.person;
  const own = personId === actor.person;
  const db = getDb();

  if (!own) {
    // La persona tiene que ser del workspace y poder usar Time.
    if (!(await listTimePeople(actor.ws)).some((p) => p.id === personId)) throw new TimeError('not_found', 404);
  }
  const cur = await sheetOf(actor.ws, personId, week);
  const next = nextSheetStatus(input.action, cur.status, { admin: actor.admin, own });
  if (next === 'forbidden') throw new TimeError('forbidden', 403);
  if (next === 'bad_state') throw new TimeError('bad_state', 409);
  if (!(['open', 'submitted', 'approved', 'returned'] as string[]).includes(next)) throw new TimeError('invalid_input', 400);
  const to = next as SheetStatus;
  const t = now();
  const note = String(input.note ?? '').trim().slice(0, MAX_SHEET_NOTE);

  if (input.action === 'submit') {
    const sums = (await db
      .prepare(
        `SELECT COUNT(*) AS n, SUM(CASE WHEN timer_started_at IS NOT NULL THEN 1 ELSE 0 END) AS running
         FROM time_entries WHERE workspace_id = ? AND person_id = ? AND spent_date BETWEEN ? AND ?`,
      )
      .get(actor.ws, personId, week, addDays(week, 6))) as { n: number; running: number | null };
    if (!Number(sums.n)) throw new TimeError('empty_week', 409);
    if (Number(sums.running ?? 0)) throw new TimeError('timer_running', 409);
  }

  let changed: number;
  if (cur.status === 'open') {
    // Solo `submit` sale de `open`.
    changed = (
      await db
        .prepare(
          `INSERT INTO time_timesheets (workspace_id, person_id, week_start, status, submitted_at, note, updated_at) VALUES (?, ?, ?, 'submitted', ?, '', ?)
           ON CONFLICT(workspace_id, person_id, week_start) DO NOTHING`,
        )
        .run(actor.ws, personId, week, t, t)
    ).changes;
  } else if (to === 'open') {
    changed = (await db.prepare('DELETE FROM time_timesheets WHERE workspace_id = ? AND person_id = ? AND week_start = ? AND status = ?').run(actor.ws, personId, week, cur.status)).changes;
  } else if (input.action === 'submit') {
    changed = (
      await db
        .prepare(
          `UPDATE time_timesheets SET status = 'submitted', submitted_at = ?, note = '', decided_by = NULL, decided_at = NULL, updated_at = ?
           WHERE workspace_id = ? AND person_id = ? AND week_start = ? AND status = ?`,
        )
        .run(t, t, actor.ws, personId, week, cur.status)
    ).changes;
  } else {
    changed = (
      await db
        .prepare(
          `UPDATE time_timesheets SET status = ?, note = ?, decided_by = ?, decided_at = ?, updated_at = ?
           WHERE workspace_id = ? AND person_id = ? AND week_start = ? AND status = ?`,
        )
        .run(to, to === 'returned' ? note : '', actor.person, t, t, actor.ws, personId, week, cur.status)
    ).changes;
  }
  if (!changed) throw new TimeError('bad_state', 409);

  await notify(actor, input.action, personId, week, note);
  return sheetOf(actor.ws, personId, week);
}

/** Avisos en la bandeja: a quienes aprueban cuando se envía; a la persona cuando se decide. Un aviso que falla no frena el cambio. */
async function notify(actor: TimeActor, action: SheetAction, personId: string, week: string, note: string): Promise<void> {
  const href = `/app/time?date=${week}&view=week`;
  const who = actor.name || actor.email;
  try {
    if (action === 'submit') {
      for (const userId of await approvers(actor.ws, actor.person)) {
        await createNotification({
          userId,
          type: 'time_approval',
          title: localized('timeSubmitted', { who, week }),
          href: `/app/time/approvals`,
          sourceType: 'time_timesheet',
          sourceId: `${personId}:${week}`,
        });
      }
    } else if ((action === 'approve' || action === 'return' || action === 'reopen') && personId !== actor.person) {
      await createNotification({
        userId: personId,
        type: 'time_approval',
        title: localized(action === 'approve' ? 'timeApproved' : 'timeReturned', { who, week }),
        ...(action !== 'approve' && note ? { body: note } : {}),
        href,
        sourceType: 'time_timesheet',
        sourceId: `${personId}:${week}`,
      });
    }
  } catch {
    // El aviso es secundario.
  }
}
