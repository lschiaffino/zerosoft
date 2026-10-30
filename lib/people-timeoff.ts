/**
 * People: licencias. Políticas por tipo con su devengamiento, pedidos con
 * aprobación del manager o HR, saldos (lib/people-time.ts hace las cuentas),
 * feriados por país (seed + propios), calendario del equipo y los efectos de
 * una licencia aprobada: Cal la bloquea (calendar_blocked_slots) y Talk
 * muestra "fuera de la oficina" mientras dura (el cron de cada hora la
 * prende el día que empieza). Server-only.
 */
import { getDb } from './db';
import { canApprove, canRequestFor, canSeeSensitive, isSelf } from './people-access';
import {
  addDays,
  computeBalance,
  countLeaveDays,
  isIsoDate,
  seededHolidays,
  zonedInstant,
  zonedToday,
  type AccrualKind,
  type Balance,
  type HalfDay,
  type Holiday,
  type PayPeriod,
} from './people-time';
import { getEmployeeRow, newId, nowIso, parseJson, PeopleError, requireHr, today, type PeopleCtx } from './people';
import { emitPeopleEvent, hrPeople, notifyPeople } from './people-effects';

const db = () => getDb();

export const POLICY_KINDS = ['vacation', 'sick', 'personal', 'other'] as const;
export const ACCRUALS: AccrualKind[] = ['annual', 'monthly', 'per_pay_period', 'none'];

export interface Policy {
  id: string;
  name: string;
  kind: (typeof POLICY_KINDS)[number];
  accrual: AccrualKind;
  daysPerYear: number;
  carryoverMax: number | null;
  capDays: number | null;
  halfDay: boolean;
  archived: boolean;
}

function toPolicy(r: Record<string, unknown>): Policy {
  return {
    id: String(r.id),
    name: String(r.name),
    kind: (POLICY_KINDS as readonly string[]).includes(String(r.kind)) ? (r.kind as Policy['kind']) : 'other',
    accrual: (ACCRUALS as string[]).includes(String(r.accrual)) ? (r.accrual as AccrualKind) : 'annual',
    daysPerYear: Number(r.days_per_year) || 0,
    carryoverMax: r.carryover_max == null ? null : Number(r.carryover_max),
    capDays: r.cap_days == null ? null : Number(r.cap_days),
    halfDay: Number(r.half_day) === 1,
    archived: Number(r.archived) === 1,
  };
}

export async function listPolicies(ws: string, opts: { includeArchived?: boolean } = {}): Promise<Policy[]> {
  const rows = (await db()
    .prepare(`SELECT * FROM people_policies WHERE workspace_id = ? ${opts.includeArchived ? '' : 'AND archived = 0'} ORDER BY created_at`)
    .all(ws)) as Array<Record<string, unknown>>;
  return rows.map(toPolicy);
}

async function getPolicy(ws: string, id: string): Promise<Policy | null> {
  const r = (await db().prepare('SELECT * FROM people_policies WHERE id = ? AND workspace_id = ?').get(id, ws)) as Record<string, unknown> | undefined;
  return r ? toPolicy(r) : null;
}

function num(v: unknown, max = 366): number | null {
  if (v == null || v === '') return null;
  const n = Number(v);
  if (!Number.isFinite(n) || n < 0 || n > max) throw new PeopleError('invalid_number');
  return Math.round(n * 100) / 100;
}

function policyInput(input: Record<string, unknown>, base?: Policy) {
  const name = input.name !== undefined ? String(input.name).trim().slice(0, 80) : base?.name ?? '';
  if (!name) throw new PeopleError('name_required');
  return {
    name,
    kind: input.kind !== undefined ? ((POLICY_KINDS as readonly string[]).includes(String(input.kind)) ? String(input.kind) : 'other') : base?.kind ?? 'vacation',
    accrual: input.accrual !== undefined ? ((ACCRUALS as string[]).includes(String(input.accrual)) ? String(input.accrual) : 'annual') : base?.accrual ?? 'annual',
    daysPerYear: input.daysPerYear !== undefined ? num(input.daysPerYear) ?? 0 : base?.daysPerYear ?? 0,
    carryoverMax: input.carryoverMax !== undefined ? num(input.carryoverMax) : base?.carryoverMax ?? null,
    capDays: input.capDays !== undefined ? num(input.capDays) : base?.capDays ?? null,
    halfDay: input.halfDay !== undefined ? input.halfDay !== false : base?.halfDay ?? true,
    archived: input.archived !== undefined ? input.archived === true : base?.archived ?? false,
  };
}

export async function createPolicy(ctx: PeopleCtx, input: Record<string, unknown>): Promise<Policy> {
  requireHr(ctx);
  const p = policyInput(input);
  const id = newId('pol');
  const now = nowIso();
  await db()
    .prepare(
      `INSERT INTO people_policies (id, workspace_id, name, kind, accrual, days_per_year, carryover_max, cap_days, half_day, archived, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 0, ?, ?)`,
    )
    .run(id, ctx.ws, p.name, p.kind, p.accrual, p.daysPerYear, p.carryoverMax, p.capDays, p.halfDay ? 1 : 0, now, now);
  return (await getPolicy(ctx.ws, id))!;
}

export async function updatePolicy(ctx: PeopleCtx, id: string, input: Record<string, unknown>): Promise<Policy> {
  requireHr(ctx);
  const base = await getPolicy(ctx.ws, id);
  if (!base) throw new PeopleError('not_found', 404);
  const p = policyInput(input, base);
  await db()
    .prepare(
      `UPDATE people_policies SET name = ?, kind = ?, accrual = ?, days_per_year = ?, carryover_max = ?, cap_days = ?, half_day = ?, archived = ?, updated_at = ?
       WHERE id = ? AND workspace_id = ?`,
    )
    .run(p.name, p.kind, p.accrual, p.daysPerYear, p.carryoverMax, p.capDays, p.halfDay ? 1 : 0, p.archived ? 1 : 0, nowIso(), id, ctx.ws);
  return (await getPolicy(ctx.ws, id))!;
}

export async function deletePolicy(ctx: PeopleCtx, id: string): Promise<boolean> {
  requireHr(ctx);
  const used = await db().prepare('SELECT 1 AS x FROM people_requests WHERE policy_id = ? LIMIT 1').get(id);
  // Con historial se archiva (los saldos y reportes la siguen nombrando).
  if (used) return (await db().prepare('UPDATE people_policies SET archived = 1 WHERE id = ? AND workspace_id = ?').run(id, ctx.ws)).changes > 0;
  return (await db().prepare('DELETE FROM people_policies WHERE id = ? AND workspace_id = ?').run(id, ctx.ws)).changes > 0;
}

// ---------- Feriados ----------

export async function holidaysFor(ws: string, country: string, years: number[]): Promise<Holiday[]> {
  const custom = (await db().prepare('SELECT * FROM people_holidays WHERE workspace_id = ? ORDER BY date').all(ws)) as Array<{ id: string; country: string; date: string; name: string }>;
  const out: Holiday[] = [];
  for (const y of years) out.push(...(country ? seededHolidays(country, y) : []));
  for (const h of custom) {
    if (!years.includes(Number(h.date.slice(0, 4)))) continue;
    if (h.country && country && h.country !== country) continue;
    if (h.country && !country) continue;
    out.push({ date: h.date, name: h.name, country: h.country, custom: true, ...({ id: h.id } as object) });
  }
  return out.sort((a, b) => a.date.localeCompare(b.date));
}

export async function listCustomHolidays(ws: string): Promise<Array<{ id: string; country: string; date: string; name: string }>> {
  return (await db().prepare('SELECT id, country, date, name FROM people_holidays WHERE workspace_id = ? ORDER BY date').all(ws)) as Array<{ id: string; country: string; date: string; name: string }>;
}

export async function addHoliday(ctx: PeopleCtx, input: Record<string, unknown>) {
  requireHr(ctx);
  if (!isIsoDate(input.date)) throw new PeopleError('invalid_date');
  const name = String(input.name ?? '').trim().slice(0, 120);
  if (!name) throw new PeopleError('name_required');
  const country = String(input.country ?? '').trim().toUpperCase().slice(0, 2);
  const id = newId('hol');
  await db().prepare('INSERT INTO people_holidays (id, workspace_id, country, date, name, created_at) VALUES (?, ?, ?, ?, ?, ?)').run(id, ctx.ws, country, input.date, name, nowIso());
  return { id, country, date: String(input.date), name };
}

export async function deleteHoliday(ctx: PeopleCtx, id: string): Promise<boolean> {
  requireHr(ctx);
  return (await db().prepare('DELETE FROM people_holidays WHERE id = ? AND workspace_id = ?').run(id, ctx.ws)).changes > 0;
}

// ---------- Pedidos ----------

export type RequestStatus = 'pending' | 'approved' | 'denied' | 'cancelled';

interface RequestRow {
  id: string;
  workspace_id: string;
  employee_id: string;
  policy_id: string;
  start_date: string;
  end_date: string;
  half: string;
  days: number;
  note: string;
  status: RequestStatus;
  decided_by: string | null;
  decided_at: string | null;
  decision_note: string;
  cal_slot_id: string | null;
  talk_set: number;
  created_at: string;
}

export interface RequestDto {
  id: string;
  employeeId: string;
  employeeName: string;
  /** null = quien mira no ve el tipo (licencia por enfermedad, etc.). */
  policyId: string | null;
  policyName: string | null;
  startDate: string;
  endDate: string;
  half: HalfDay;
  days: number;
  note: string | null;
  status: RequestStatus;
  decidedByName: string | null;
  decidedAt: string | null;
  decisionNote: string | null;
  createdAt: string;
  canDecide: boolean;
  canCancel: boolean;
}

async function hasManager(ws: string, employeeId: string): Promise<boolean> {
  const r = await getEmployeeRow(ws, employeeId);
  return Boolean(r?.manager_id);
}

function toDto(ctx: PeopleCtx, r: RequestRow & { employee_name: string; policy_name: string; decided_name: string | null; employee_has_manager: number }): RequestDto {
  const seeType = canSeeSensitive(ctx.viewer, r.employee_id, 'timeoff');
  const decider = canApprove(ctx.viewer, r.employee_id, Number(r.employee_has_manager) === 1);
  return {
    id: r.id,
    employeeId: r.employee_id,
    employeeName: r.employee_name,
    policyId: seeType ? r.policy_id : null,
    policyName: seeType ? r.policy_name : null,
    startDate: r.start_date,
    endDate: r.end_date,
    half: (['am', 'pm'].includes(r.half) ? r.half : '') as HalfDay,
    days: Number(r.days),
    note: seeType ? r.note : null,
    status: r.status,
    decidedByName: seeType ? r.decided_name : null,
    decidedAt: seeType ? r.decided_at : null,
    decisionNote: seeType ? r.decision_note : null,
    createdAt: r.created_at,
    canDecide: decider && r.status === 'pending',
    canCancel: (ctx.viewer.hr || isSelf(ctx.viewer, r.employee_id)) && (r.status === 'pending' || (r.status === 'approved' && r.end_date >= today())),
  };
}

const SELECT_REQUESTS = `SELECT r.*, e.name AS employee_name, p.name AS policy_name, COALESCE(u.name, u.email) AS decided_name,
  CASE WHEN e.manager_id IS NULL THEN 0 ELSE 1 END AS employee_has_manager
  FROM people_requests r JOIN people_employees e ON e.id = r.employee_id JOIN people_policies p ON p.id = r.policy_id
  LEFT JOIN users u ON u.id = r.decided_by`;

type JoinedRow = RequestRow & { employee_name: string; policy_name: string; decided_name: string | null; employee_has_manager: number };

/**
 * Pedidos que quien mira puede ver con detalle: los suyos, los de sus
 * reportes y (HR) todos. `scope: 'approvals'` = los pendientes que puede decidir.
 */
export async function listRequests(ctx: PeopleCtx, opts: { employeeId?: string; scope?: 'mine' | 'approvals' | 'all'; status?: RequestStatus } = {}): Promise<RequestDto[]> {
  const rows = (await db()
    .prepare(`${SELECT_REQUESTS} WHERE r.workspace_id = ? ${opts.employeeId ? 'AND r.employee_id = ?' : ''} ${opts.status ? 'AND r.status = ?' : ''} ORDER BY r.start_date DESC LIMIT 500`)
    .all(...([ctx.ws, opts.employeeId, opts.status].filter((x) => x !== undefined) as string[]))) as unknown as JoinedRow[];
  return rows
    .filter((r) => canSeeSensitive(ctx.viewer, r.employee_id, 'timeoff'))
    .filter((r) => (opts.scope === 'mine' ? isSelf(ctx.viewer, r.employee_id) : true))
    .map((r) => toDto(ctx, r))
    .filter((d) => (opts.scope === 'approvals' ? d.canDecide : true));
}

async function getRequestRow(ws: string, id: string): Promise<JoinedRow | null> {
  return ((await db().prepare(`${SELECT_REQUESTS} WHERE r.id = ? AND r.workspace_id = ?`).get(id, ws)) as unknown as JoinedRow | undefined) ?? null;
}

async function approvedAndPending(ws: string, employeeId: string, policyId: string) {
  return (await db()
    .prepare("SELECT start_date, days, status FROM people_requests WHERE workspace_id = ? AND employee_id = ? AND policy_id = ? AND status IN ('approved', 'pending')")
    .all(ws, employeeId, policyId)) as Array<{ start_date: string; days: number; status: string }>;
}

/** Saldo de cada política para una ficha (HR, la persona o su cadena). */
export async function balancesFor(ctx: PeopleCtx, employeeId: string, asOf = today()): Promise<Array<{ policy: Policy; balance: Balance }>> {
  if (!canSeeSensitive(ctx.viewer, employeeId, 'timeoff')) throw new PeopleError('forbidden', 403);
  return balancesUnchecked(ctx.ws, employeeId, asOf);
}

export async function balancesUnchecked(ws: string, employeeId: string, asOf = today()): Promise<Array<{ policy: Policy; balance: Balance }>> {
  const emp = await getEmployeeRow(ws, employeeId);
  if (!emp) throw new PeopleError('not_found', 404);
  const policies = await listPolicies(ws);
  const out: Array<{ policy: Policy; balance: Balance }> = [];
  for (const policy of policies) {
    const reqs = await approvedAndPending(ws, employeeId, policy.id);
    const adj = (await db().prepare('SELECT date, days FROM people_adjustments WHERE workspace_id = ? AND employee_id = ? AND policy_id = ?').all(ws, employeeId, policy.id)) as Array<{
      date: string;
      days: number;
    }>;
    const balance = computeBalance({
      policy,
      startDate: emp.start_date ?? emp.created_at.slice(0, 10),
      asOf,
      payPeriod: (emp.pay_period as PayPeriod) || 'monthly',
      approved: reqs.filter((r) => r.status === 'approved').map((r) => ({ date: r.start_date, days: Number(r.days) })),
      pending: reqs.filter((r) => r.status === 'pending').map((r) => ({ date: r.start_date, days: Number(r.days) })),
      adjustments: adj.map((a) => ({ date: a.date, days: Number(a.days) })),
    });
    out.push({ policy, balance });
  }
  return out;
}

export async function adjustBalance(ctx: PeopleCtx, employeeId: string, input: Record<string, unknown>) {
  requireHr(ctx);
  const policy = await getPolicy(ctx.ws, String(input.policyId ?? ''));
  if (!policy) throw new PeopleError('invalid_policy');
  if (!(await getEmployeeRow(ctx.ws, employeeId))) throw new PeopleError('not_found', 404);
  const days = Number(input.days);
  if (!Number.isFinite(days) || days === 0 || Math.abs(days) > 366) throw new PeopleError('invalid_number');
  const date = isIsoDate(input.date) ? input.date : today();
  await db()
    .prepare('INSERT INTO people_adjustments (id, workspace_id, employee_id, policy_id, date, days, note, created_by, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)')
    .run(newId('adj'), ctx.ws, employeeId, policy.id, date, Math.round(days * 100) / 100, String(input.note ?? '').slice(0, 200), ctx.personId, nowIso());
}

/** Días hábiles de un pedido con los feriados del país de la persona. */
export async function requestDays(ws: string, employeeId: string, start: string, end: string, half: HalfDay): Promise<number> {
  const emp = await getEmployeeRow(ws, employeeId);
  const years = [...new Set([Number(start.slice(0, 4)), Number(end.slice(0, 4))])];
  const hol = await holidaysFor(ws, emp?.country ?? '', years);
  return countLeaveDays(start, end, hol.map((h) => h.date), half);
}

export async function createRequest(
  ctx: PeopleCtx,
  input: { employeeId?: string; policyId?: string; startDate?: string; endDate?: string; half?: string; note?: string },
): Promise<RequestDto> {
  const employeeId = input.employeeId || ctx.viewer.employeeId;
  if (!employeeId) throw new PeopleError('no_profile', 409);
  if (!canRequestFor(ctx.viewer, employeeId)) throw new PeopleError('forbidden', 403);
  const emp = await getEmployeeRow(ctx.ws, employeeId);
  if (!emp || emp.status === 'terminated') throw new PeopleError('not_found', 404);
  const policy = await getPolicy(ctx.ws, String(input.policyId ?? ''));
  if (!policy || policy.archived) throw new PeopleError('invalid_policy');
  const start = input.startDate;
  const end = input.endDate || input.startDate;
  if (!isIsoDate(start) || !isIsoDate(end) || end < start) throw new PeopleError('invalid_dates');
  if (start > addDays(today(), 730) || end > addDays(start, 366)) throw new PeopleError('invalid_dates');
  const half = (input.half === 'am' || input.half === 'pm' ? input.half : '') as HalfDay;
  if (half && (start !== end || !policy.halfDay)) throw new PeopleError('half_day_not_allowed');
  const days = await requestDays(ctx.ws, employeeId, start, end, half);
  if (days <= 0) throw new PeopleError('no_working_days');
  const overlap = await db()
    .prepare("SELECT 1 AS x FROM people_requests WHERE employee_id = ? AND status IN ('pending', 'approved') AND start_date <= ? AND end_date >= ? LIMIT 1")
    .get(employeeId, end, start);
  if (overlap) throw new PeopleError('overlap', 409);
  if (policy.accrual !== 'none') {
    const asOf = start > today() ? start : today();
    const bal = (await balancesUnchecked(ctx.ws, employeeId, asOf)).find((b) => b.policy.id === policy.id)?.balance;
    if (bal && days > bal.available) throw new PeopleError('insufficient_balance', 409);
  }
  const id = newId('req');
  const now = nowIso();
  await db()
    .prepare(
      `INSERT INTO people_requests (id, workspace_id, employee_id, policy_id, start_date, end_date, half, days, note, status, created_by, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'pending', ?, ?, ?)`,
    )
    .run(id, ctx.ws, employeeId, policy.id, start, end, half, days, String(input.note ?? '').slice(0, 500), ctx.personId, now, now);
  // Aviso a quien aprueba: el manager directo; si no hay, HR. Sin el tipo de licencia.
  const mgr = emp.manager_id ? await getEmployeeRow(ctx.ws, emp.manager_id) : null;
  const to = mgr?.user_id ? [mgr.user_id] : await hrPeople(ctx.ws);
  await notifyPeople(
    to.filter((u) => u !== emp.user_id),
    { title: `${emp.name} requested time off`, body: `${start}${end !== start ? ` to ${end}` : ''} · ${days} day(s)`, href: '/app/people/time-off?tab=approvals', sourceId: id },
  );
  return toDto(ctx, (await getRequestRow(ctx.ws, id))!);
}

/** Aprobar o rechazar (manager de la cadena o HR). Aprobar bloquea Cal y dispara Flow. */
export async function decideRequest(ctx: PeopleCtx, id: string, decision: 'approve' | 'deny', note = ''): Promise<RequestDto> {
  const r = await getRequestRow(ctx.ws, id);
  if (!r) throw new PeopleError('not_found', 404);
  if (!canApprove(ctx.viewer, r.employee_id, Number(r.employee_has_manager) === 1)) throw new PeopleError('forbidden', 403);
  const status = decision === 'approve' ? 'approved' : 'denied';
  // Compare-and-set: dos aprobadores a la vez no duplican el bloqueo de Cal ni el evento.
  const res = await db()
    .prepare("UPDATE people_requests SET status = ?, decided_by = ?, decided_at = ?, decision_note = ?, updated_at = ? WHERE id = ? AND status = 'pending'")
    .run(status, ctx.personId, nowIso(), note.slice(0, 500), nowIso(), id);
  if (!res.changes) throw new PeopleError('not_pending', 409);
  const emp = await getEmployeeRow(ctx.ws, r.employee_id);
  if (status === 'approved' && emp) {
    await applyApprovedEffects(ctx.ws, id);
    const approver = (await db().prepare('SELECT COALESCE(name, email) AS n FROM users WHERE id = ?').get(ctx.personId)) as { n: string } | undefined;
    await emitPeopleEvent(ctx.ws, 'people.timeoff.approved', {
      request: { id, startDate: r.start_date, endDate: r.end_date, days: Number(r.days), half: r.half, approvedBy: approver?.n ?? '', url: '/app/people/time-off' },
      employee: { id: emp.id, name: emp.name, workEmail: emp.work_email },
    });
  }
  await notifyPeople([emp?.user_id], {
    title: status === 'approved' ? 'Your time off was approved' : 'Your time off was declined',
    body: `${r.start_date}${r.end_date !== r.start_date ? ` to ${r.end_date}` : ''}`,
    href: '/app/people/time-off',
    sourceId: id,
  });
  return toDto(ctx, (await getRequestRow(ctx.ws, id))!);
}

/** Zona horaria de la persona (la de su Cal); UTC si no configuró Cal. */
export async function personTz(userId: string | null | undefined): Promise<string> {
  if (!userId) return 'UTC';
  const row = (await db().prepare('SELECT timezone FROM calendar_users WHERE user_id = ?').get(userId).catch(() => undefined)) as { timezone?: string } | undefined;
  return row?.timezone || 'UTC';
}

/** Bloqueo de Cal (todo el día, o medio día) y estado de Talk si ya empezó. Días en la zona horaria de la persona. */
async function applyApprovedEffects(ws: string, id: string): Promise<void> {
  const r = (await db().prepare('SELECT r.*, e.user_id FROM people_requests r JOIN people_employees e ON e.id = r.employee_id WHERE r.id = ?').get(id)) as
    | (RequestRow & { user_id: string | null })
    | undefined;
  if (!r || !r.user_id) return;
  try {
    if (!r.cal_slot_id) {
      const { createBlockedSlot } = await import('./calendar');
      const tz = await personTz(r.user_id);
      const startsAt = zonedInstant(r.start_date, tz, r.half === 'pm' ? 12 : 0);
      const endsAt = r.half === 'am' ? zonedInstant(r.start_date, tz, 12) : zonedInstant(addDays(r.end_date, 1), tz, 0);
      const slot = await createBlockedSlot(r.user_id, { startsAt, endsAt, reason: 'Out of office (People)' });
      const claimed = await db().prepare('UPDATE people_requests SET cal_slot_id = ? WHERE id = ? AND cal_slot_id IS NULL').run(slot.id, id);
      if (!claimed.changes) await db().prepare('DELETE FROM calendar_blocked_slots WHERE id = ?').run(slot.id);
    }
  } catch (err) {
    console.error('[people] cal block', err instanceof Error ? err.message : 'error');
  }
  const now = zonedToday(await personTz(r.user_id));
  if (r.start_date <= now && r.end_date >= now) await setTalkStatus(ws, id);
}

async function setTalkStatus(ws: string, id: string): Promise<void> {
  const claimed = await db().prepare('UPDATE people_requests SET talk_set = 1 WHERE id = ? AND talk_set = 0').run(id);
  if (!claimed.changes) return;
  const r = (await db().prepare('SELECT r.end_date, e.user_id FROM people_requests r JOIN people_employees e ON e.id = r.employee_id WHERE r.id = ?').get(id)) as
    | { end_date: string; user_id: string | null }
    | undefined;
  if (!r?.user_id) return;
  try {
    const { setStatus } = await import('./talk-extras');
    const tz = await personTz(r.user_id);
    await setStatus({ workspaceId: ws, personId: r.user_id, role: 'member', teamId: null }, { emoji: '🌴', text: `Out of office until ${r.end_date}`, expiresAt: zonedInstant(addDays(r.end_date, 1), tz, 0) });
  } catch (err) {
    console.error('[people] talk status', err instanceof Error ? err.message : 'error');
  }
}

async function clearEffects(ws: string, r: { id: string; cal_slot_id: string | null; talk_set: number; employee_id: string }): Promise<void> {
  if (r.cal_slot_id) await db().prepare('DELETE FROM calendar_blocked_slots WHERE id = ?').run(r.cal_slot_id).catch(() => undefined);
  if (r.talk_set) {
    const emp = await getEmployeeRow(ws, r.employee_id);
    if (emp?.user_id) {
      await db()
        .prepare("UPDATE talk_presence SET status_emoji = '', status_text = '', status_expires_at = NULL WHERE workspace_id = ? AND user_id = ? AND status_text LIKE 'Out of office until %'")
        .run(ws, emp.user_id)
        .catch(() => undefined);
    }
  }
}

export async function cancelRequest(ctx: PeopleCtx, id: string): Promise<RequestDto> {
  const r = await getRequestRow(ctx.ws, id);
  if (!r) throw new PeopleError('not_found', 404);
  if (!ctx.viewer.hr && !isSelf(ctx.viewer, r.employee_id)) throw new PeopleError('forbidden', 403);
  if (!(r.status === 'pending' || (r.status === 'approved' && (ctx.viewer.hr || r.end_date >= today())))) throw new PeopleError('not_cancellable', 409);
  const res = await db().prepare("UPDATE people_requests SET status = 'cancelled', updated_at = ? WHERE id = ? AND status IN ('pending', 'approved')").run(nowIso(), id);
  if (!res.changes) throw new PeopleError('not_cancellable', 409);
  await clearEffects(ctx.ws, r);
  return toDto(ctx, (await getRequestRow(ctx.ws, id))!);
}

/** Al borrar u offboardear una ficha: se cancelan sus licencias futuras y sus bloqueos de Cal. */
export async function cancelCalBlocksFor(ws: string, employeeId: string, from = today()): Promise<void> {
  const list = (await db()
    .prepare("SELECT id, cal_slot_id, talk_set, employee_id FROM people_requests WHERE workspace_id = ? AND employee_id = ? AND status IN ('pending', 'approved') AND end_date >= ?")
    .all(ws, employeeId, from)) as Array<{ id: string; cal_slot_id: string | null; talk_set: number; employee_id: string }>;
  for (const r of list) {
    await db().prepare("UPDATE people_requests SET status = 'cancelled', updated_at = ? WHERE id = ?").run(nowIso(), r.id);
    await clearEffects(ws, r);
  }
}

/** Cron de cada hora: las licencias aprobadas que empiezan hoy ponen "fuera de la oficina" en Talk. */
export async function peopleTick(): Promise<number> {
  // Margen de un día para las zonas adelantadas o atrasadas respecto de UTC; cada persona se mira en la suya.
  const t = today();
  const due = (await db()
    .prepare(
      `SELECT r.id, r.workspace_id, r.start_date, r.end_date, e.user_id FROM people_requests r JOIN people_employees e ON e.id = r.employee_id
       WHERE r.status = 'approved' AND r.talk_set = 0 AND r.start_date <= ? AND r.end_date >= ? LIMIT 200`,
    )
    .all(addDays(t, 1), addDays(t, -1))) as Array<{ id: string; workspace_id: string; start_date: string; end_date: string; user_id: string | null }>;
  let n = 0;
  for (const r of due) {
    const local = zonedToday(await personTz(r.user_id));
    if (r.start_date > local || r.end_date < local) continue;
    await setTalkStatus(r.workspace_id, r.id);
    n++;
  }
  return n;
}

// ---------- Calendario del equipo ----------

export interface CalendarEntry {
  requestId: string;
  employeeId: string;
  employeeName: string;
  startDate: string;
  endDate: string;
  half: HalfDay;
  status: 'approved' | 'pending';
  /** null = quien mira no ve el tipo. */
  policyName: string | null;
}

/** Quién está fuera entre dos fechas (todos ven quién; el tipo solo quien puede) y los feriados del período. */
export async function teamCalendar(ctx: PeopleCtx, from: string, to: string, country = ''): Promise<{ entries: CalendarEntry[]; holidays: Holiday[] }> {
  if (!isIsoDate(from) || !isIsoDate(to) || to < from) throw new PeopleError('invalid_dates');
  const rows = (await db()
    .prepare(
      `SELECT r.id, r.employee_id, e.name, r.start_date, r.end_date, r.half, r.status, p.name AS policy_name
       FROM people_requests r JOIN people_employees e ON e.id = r.employee_id JOIN people_policies p ON p.id = r.policy_id
       WHERE r.workspace_id = ? AND r.status IN ('approved', 'pending') AND r.start_date <= ? AND r.end_date >= ?
       ORDER BY r.start_date`,
    )
    .all(ctx.ws, to, from)) as Array<Record<string, string>>;
  const entries: CalendarEntry[] = rows
    // Los pendientes solo los ve quien los puede ver con detalle.
    .filter((r) => r.status === 'approved' || canSeeSensitive(ctx.viewer, r.employee_id, 'timeoff'))
    .map((r) => ({
      requestId: r.id,
      employeeId: r.employee_id,
      employeeName: r.name,
      startDate: r.start_date,
      endDate: r.end_date,
      half: (['am', 'pm'].includes(r.half) ? r.half : '') as HalfDay,
      status: r.status as 'approved' | 'pending',
      policyName: canSeeSensitive(ctx.viewer, r.employee_id, 'timeoff') ? r.policy_name : null,
    }));
  const years = [...new Set([Number(from.slice(0, 4)), Number(to.slice(0, 4))])];
  const holidays = (await holidaysFor(ctx.ws, country, years)).filter((h) => h.date >= from && h.date <= to);
  return { entries, holidays };
}

export function settingsCountries(raw: string): string[] {
  return parseJson<string[]>(raw, []);
}
