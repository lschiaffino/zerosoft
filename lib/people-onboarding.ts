/**
 * People: onboarding y offboarding. Plantillas con tareas para la persona
 * nueva, su manager, IT o HR, con vencimiento relativo al día de ingreso (o
 * de salida); checklists que salen de una plantilla; la salida con tareas de
 * devolución de equipos, entrevista de salida y, si HR lo elige, "sacar del
 * workspace" por el flujo de siempre (teams.removeMember → personRemoved).
 */
import { localized } from './notification-copy';
import { getDb } from './db';
import { isManagerOf, isSelf } from './people-access';
import { dueDateFor, isIsoDate } from './people-time';
import { getEmployeeRow, newId, nowIso, parseJson, PeopleError, requireHr, today, type PeopleCtx } from './people';
import { emitPeopleEvent, hrPeople, notifyPeople } from './people-effects';

const db = () => getDb();

export const ASSIGNEES = ['new_hire', 'manager', 'it', 'hr'] as const;
export type Assignee = (typeof ASSIGNEES)[number];

export interface TemplateTask {
  title: string;
  description: string;
  assignee: Assignee;
  /** Días desde el ingreso (onboarding) o la salida (offboarding); negativo = antes. */
  offsetDays: number;
}

export interface Template {
  id: string;
  name: string;
  kind: 'onboarding' | 'offboarding';
  tasks: TemplateTask[];
  updatedAt: string;
}

export function cleanTasks(raw: unknown): TemplateTask[] {
  if (!Array.isArray(raw)) return [];
  return raw.slice(0, 100).flatMap((t) => {
    const o = (t ?? {}) as Record<string, unknown>;
    const title = String(o.title ?? '').trim().slice(0, 200);
    if (!title) return [];
    const offset = Math.max(-365, Math.min(365, Math.trunc(Number(o.offsetDays) || 0)));
    return [{
      title,
      description: String(o.description ?? '').trim().slice(0, 1000),
      assignee: (ASSIGNEES as readonly string[]).includes(String(o.assignee)) ? (o.assignee as Assignee) : 'hr',
      offsetDays: offset,
    }];
  });
}

function toTemplate(r: Record<string, unknown>): Template {
  return { id: String(r.id), name: String(r.name), kind: r.kind === 'offboarding' ? 'offboarding' : 'onboarding', tasks: cleanTasks(parseJson(r.tasks, [])), updatedAt: String(r.updated_at) };
}

export async function listTemplates(ws: string, kind?: 'onboarding' | 'offboarding'): Promise<Template[]> {
  const rows = (await db()
    .prepare(`SELECT * FROM people_templates WHERE workspace_id = ? ${kind ? 'AND kind = ?' : ''} ORDER BY kind, name COLLATE NOCASE`)
    .all(...(kind ? [ws, kind] : [ws]))) as Array<Record<string, unknown>>;
  return rows.map(toTemplate);
}

export async function getTemplate(ws: string, id: string): Promise<Template | null> {
  const r = (await db().prepare('SELECT * FROM people_templates WHERE id = ? AND workspace_id = ?').get(id, ws)) as Record<string, unknown> | undefined;
  return r ? toTemplate(r) : null;
}

export async function createTemplate(ctx: PeopleCtx, input: Record<string, unknown>): Promise<Template> {
  requireHr(ctx);
  const name = String(input.name ?? '').trim().slice(0, 120);
  if (!name) throw new PeopleError('name_required');
  const id = newId('tpl');
  const now = nowIso();
  await db()
    .prepare('INSERT INTO people_templates (id, workspace_id, name, kind, tasks, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)')
    .run(id, ctx.ws, name, input.kind === 'offboarding' ? 'offboarding' : 'onboarding', JSON.stringify(cleanTasks(input.tasks)), now, now);
  return (await getTemplate(ctx.ws, id))!;
}

export async function updateTemplate(ctx: PeopleCtx, id: string, input: Record<string, unknown>): Promise<Template> {
  requireHr(ctx);
  const cur = await getTemplate(ctx.ws, id);
  if (!cur) throw new PeopleError('not_found', 404);
  const name = input.name !== undefined ? String(input.name).trim().slice(0, 120) : cur.name;
  if (!name) throw new PeopleError('name_required');
  const tasks = input.tasks !== undefined ? cleanTasks(input.tasks) : cur.tasks;
  await db().prepare('UPDATE people_templates SET name = ?, tasks = ?, updated_at = ? WHERE id = ? AND workspace_id = ?').run(name, JSON.stringify(tasks), nowIso(), id, ctx.ws);
  return (await getTemplate(ctx.ws, id))!;
}

export async function deleteTemplate(ctx: PeopleCtx, id: string): Promise<boolean> {
  requireHr(ctx);
  return (await db().prepare('DELETE FROM people_templates WHERE id = ? AND workspace_id = ?').run(id, ctx.ws)).changes > 0;
}

/**
 * Tareas concretas de una plantilla para una persona: el vencimiento sale del
 * día de ingreso (o salida) más el desfase. Pura: la prueba el unit test.
 */
export function planTasks(tasks: TemplateTask[], anchor: string, who: { newHire: string | null; manager: string | null }): Array<TemplateTask & { dueDate: string; assigneeId: string | null }> {
  return tasks.map((t) => ({
    ...t,
    dueDate: dueDateFor(anchor, t.offsetDays),
    assigneeId: t.assignee === 'new_hire' ? who.newHire : t.assignee === 'manager' ? who.manager : null,
  }));
}

export interface ChecklistTask {
  id: string;
  title: string;
  description: string;
  assignee: Assignee;
  assigneeName: string | null;
  dueDate: string | null;
  done: boolean;
  doneAt: string | null;
  canToggle: boolean;
}

export interface Checklist {
  id: string;
  employeeId: string;
  employeeName: string;
  kind: 'onboarding' | 'offboarding';
  name: string;
  anchorDate: string;
  createdAt: string;
  tasks: ChecklistTask[];
  done: number;
  total: number;
}

export async function startChecklist(ctx: PeopleCtx, employeeId: string, templateId: string, anchorOverride?: string): Promise<Checklist> {
  requireHr(ctx);
  const emp = await getEmployeeRow(ctx.ws, employeeId);
  if (!emp) throw new PeopleError('not_found', 404);
  const tpl = await getTemplate(ctx.ws, templateId);
  if (!tpl) throw new PeopleError('invalid_template');
  const anchor = anchorOverride && isIsoDate(anchorOverride) ? anchorOverride : (tpl.kind === 'offboarding' ? emp.end_date : emp.start_date) ?? today();
  const mgr = emp.manager_id ? await getEmployeeRow(ctx.ws, emp.manager_id) : null;
  const plan = planTasks(tpl.tasks, anchor, { newHire: emp.user_id, manager: mgr?.user_id ?? null });
  const id = newId('chk');
  await db()
    .prepare('INSERT INTO people_checklists (id, workspace_id, employee_id, template_id, kind, name, anchor_date, created_by, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)')
    .run(id, ctx.ws, employeeId, tpl.id, tpl.kind, tpl.name, anchor, ctx.personId, nowIso());
  let pos = 0;
  for (const t of plan) {
    await db()
      .prepare(
        `INSERT INTO people_tasks (id, workspace_id, checklist_id, employee_id, title, description, assignee_role, assignee_id, due_date, position)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(newId('tsk'), ctx.ws, id, employeeId, t.title, t.description, t.assignee, t.assigneeId, t.dueDate, pos++);
  }
  // Avisos: cada persona con tareas; IT y HR van a HR.
  const hr = plan.some((t) => t.assignee === 'it' || t.assignee === 'hr') ? await hrPeople(ctx.ws) : [];
  await notifyPeople([...new Set([...plan.map((t) => t.assigneeId), ...hr])], {
    title: localized(tpl.kind === 'offboarding' ? 'peopleOffboarding' : 'peopleOnboarding', { name: emp.name }),
    href: `/app/people/${employeeId}?tab=onboarding`,
    sourceId: id,
  });
  return (await listChecklists(ctx, { employeeId })).find((c) => c.id === id)!;
}

/** ¿Puede marcar esta tarea? HR todas; la persona asignada; el manager las de manager; la persona nueva las suyas. */
function canToggle(ctx: PeopleCtx, t: { assignee_role: string; assignee_id: string | null; employee_id: string }): boolean {
  if (ctx.viewer.hr) return true;
  if (t.assignee_id && t.assignee_id === ctx.personId) return true;
  if (t.assignee_role === 'new_hire' && isSelf(ctx.viewer, t.employee_id)) return true;
  if (t.assignee_role === 'manager' && isManagerOf(ctx.viewer, t.employee_id)) return true;
  return false;
}

/** Checklists que quien mira puede ver: HR todas; la persona las suyas; el manager las de sus reportes; quien tiene tareas, esas. */
export async function listChecklists(ctx: PeopleCtx, opts: { employeeId?: string; open?: boolean } = {}): Promise<Checklist[]> {
  const lists = (await db()
    .prepare(
      `SELECT c.*, e.name AS employee_name FROM people_checklists c JOIN people_employees e ON e.id = c.employee_id
       WHERE c.workspace_id = ? ${opts.employeeId ? 'AND c.employee_id = ?' : ''} ORDER BY c.created_at DESC LIMIT 200`,
    )
    .all(...(opts.employeeId ? [ctx.ws, opts.employeeId] : [ctx.ws]))) as Array<Record<string, string>>;
  if (!lists.length) return [];
  const tasks = (await db()
    .prepare(
      `SELECT t.*, COALESCE(u.name, u.email) AS assignee_name FROM people_tasks t LEFT JOIN users u ON u.id = t.assignee_id
       WHERE t.workspace_id = ? AND t.checklist_id IN (${lists.map(() => '?').join(',')}) ORDER BY t.position`,
    )
    .all(ctx.ws, ...lists.map((l) => l.id))) as Array<Record<string, string | null>>;
  const out: Checklist[] = [];
  for (const l of lists) {
    const mine = tasks.filter((t) => t.checklist_id === l.id);
    const whole = ctx.viewer.hr || isSelf(ctx.viewer, l.employee_id) || isManagerOf(ctx.viewer, l.employee_id);
    const visible = whole ? mine : mine.filter((t) => t.assignee_id === ctx.personId);
    if (!visible.length && !whole) continue;
    const dtos = visible.map((t) => ({
      id: String(t.id),
      title: String(t.title),
      description: String(t.description ?? ''),
      assignee: t.assignee_role as Assignee,
      assigneeName: (t.assignee_name as string | null) ?? null,
      dueDate: (t.due_date as string | null) ?? null,
      done: Boolean(t.done_at),
      doneAt: (t.done_at as string | null) ?? null,
      canToggle: canToggle(ctx, { assignee_role: String(t.assignee_role), assignee_id: t.assignee_id as string | null, employee_id: String(t.employee_id) }),
    }));
    const c: Checklist = {
      id: l.id,
      employeeId: l.employee_id,
      employeeName: l.employee_name,
      kind: l.kind === 'offboarding' ? 'offboarding' : 'onboarding',
      name: l.name,
      anchorDate: l.anchor_date,
      createdAt: l.created_at,
      tasks: dtos,
      done: dtos.filter((t) => t.done).length,
      total: dtos.length,
    };
    if (opts.open && c.done === c.total) continue;
    out.push(c);
  }
  return out;
}

export async function setTaskDone(ctx: PeopleCtx, taskId: string, done: boolean): Promise<void> {
  const t = (await db().prepare('SELECT * FROM people_tasks WHERE id = ? AND workspace_id = ?').get(taskId, ctx.ws)) as
    | { assignee_role: string; assignee_id: string | null; employee_id: string }
    | undefined;
  if (!t) throw new PeopleError('not_found', 404);
  if (!canToggle(ctx, t)) throw new PeopleError('forbidden', 403);
  await db()
    .prepare('UPDATE people_tasks SET done_at = ?, done_by = ? WHERE id = ?')
    .run(done ? nowIso() : null, done ? ctx.personId : null, taskId);
}

export async function deleteChecklist(ctx: PeopleCtx, id: string): Promise<boolean> {
  requireHr(ctx);
  return (await db().prepare('DELETE FROM people_checklists WHERE id = ? AND workspace_id = ?').run(id, ctx.ws)).changes > 0;
}

/** Tareas abiertas asignadas a quien mira (inicio de People y la bienvenida). */
export async function myOpenTasks(ctx: PeopleCtx): Promise<Array<ChecklistTask & { employeeId: string; employeeName: string }>> {
  const lists = await listChecklists(ctx, { open: true });
  const me = ctx.viewer.employeeId;
  const mine = (t: ChecklistTask, c: Checklist) => {
    if (t.assignee === 'new_hire') return c.employeeId === me;
    if (t.assignee === 'manager') return isManagerOf(ctx.viewer, c.employeeId);
    return ctx.viewer.hr;
  };
  return lists.flatMap((c) => c.tasks.filter((t) => !t.done && mine(t, c)).map((t) => ({ ...t, employeeId: c.employeeId, employeeName: c.employeeName })));
}

// ---------- Offboarding ----------

export interface OffboardInput {
  endDate?: string;
  templateId?: string | null;
  /** Saca a la persona del workspace por el flujo de siempre (personRemoved). */
  removeFromWorkspace?: boolean;
}

/**
 * Salida de una persona: fecha de salida, estado, checklist de offboarding,
 * licencias futuras canceladas y, si HR lo pide, fuera del workspace
 * (teams.removeMember, que llama a personRemoved: API keys, Cal, Chat,
 * Talk, Track, Docs y lo compartido).
 */
export async function offboard(ctx: PeopleCtx, employeeId: string, input: OffboardInput): Promise<{ removed: boolean; checklistId: string | null }> {
  requireHr(ctx);
  const emp = await getEmployeeRow(ctx.ws, employeeId);
  if (!emp) throw new PeopleError('not_found', 404);
  if (emp.user_id && emp.user_id === ctx.ws) throw new PeopleError('owner_profile', 409);
  if (emp.user_id && emp.user_id === ctx.personId) throw new PeopleError('self_offboard', 409);
  // "Sacar del workspace" pide lo mismo que Ajustes › Miembros: ser owner o admin
  // y poder gestionar el rol de esa persona (un admin no saca a otro admin). Se
  // chequea antes de tocar la ficha: si no se puede, no cambia nada.
  let teams: Array<{ team_id: string; role: string }> = [];
  if (input.removeFromWorkspace && emp.user_id) {
    if (!ctx.wsAdmin) throw new PeopleError('cannot_remove', 403);
    teams = (await db()
      .prepare("SELECT m.team_id, m.role FROM team_members m JOIN teams t ON t.id = m.team_id WHERE t.owner_id = ? AND m.user_id = ? AND m.role != 'owner'")
      .all(ctx.ws, emp.user_id)) as Array<{ team_id: string; role: string }>;
    const { normalizeRole } = await import('./teams');
    // Misma regla que Ajustes › Miembros (lib/teams-http.ts canManage).
    const canManage = (a: string, t: string) => t !== 'owner' && (a === 'owner' || (a === 'admin' && (t === 'member' || t === 'guest')));
    const actor = normalizeRole(ctx.wsRole);
    for (const t of teams) if (!canManage(actor, normalizeRole(t.role))) throw new PeopleError('cannot_remove', 403);
    const { rateLimit } = await import('./rate-limit');
    const limit = await rateLimit(`teams:remove:${ctx.personId}`, 60, 3600);
    if (!limit.ok) throw new PeopleError('rate_limited', 429);
  }
  const endDate = input.endDate && isIsoDate(input.endDate) ? input.endDate : today();
  const status = endDate <= today() ? 'terminated' : 'offboarding';
  await db().prepare('UPDATE people_employees SET end_date = ?, status = ?, updated_at = ? WHERE id = ?').run(endDate, status, nowIso(), employeeId);
  const { cancelCalBlocksFor } = await import('./people-timeoff');
  await cancelCalBlocksFor(ctx.ws, employeeId, endDate > today() ? endDate : today());
  let checklistId: string | null = null;
  if (input.templateId) checklistId = (await startChecklist(ctx, employeeId, input.templateId, endDate)).id;
  let removed = false;
  if (input.removeFromWorkspace && emp.user_id) {
    const { removeMember } = await import('./teams');
    for (const t of teams) await removeMember(t.team_id, emp.user_id);
    if (!teams.length) {
      // Sin fila de miembro (p. ej. la quitaron a mano): igual se corre el flujo de salida.
      const { personRemoved } = await import('./workspace-lifecycle');
      const { ensureWorkspace } = await import('./workspace');
      const ficha = await ensureWorkspace(ctx.ws);
      await personRemoved({ ownerId: ctx.ws, teamId: ficha.id, userId: emp.user_id });
    }
    await db().prepare("UPDATE people_employees SET status = 'terminated', updated_at = ? WHERE id = ? AND end_date <= ?").run(nowIso(), employeeId, today());
    removed = true;
  }
  await emitPeopleEvent(ctx.ws, 'people.offboarded', {
    employee: { id: emp.id, name: emp.name, jobTitle: emp.job_title, department: emp.department, workEmail: emp.work_email, endDate, removedFromWorkspace: removed, url: `/app/people/${emp.id}` },
  });
  return { removed, checklistId };
}

// ---------- Entrevista de salida (solo HR) ----------

export interface ExitInterview {
  reason: string;
  wouldRecommend: number | null;
  rehire: boolean | null;
  liked: string;
  improve: string;
  notes: string;
  createdAt: string | null;
}

export const EXIT_REASONS = ['new_job', 'compensation', 'growth', 'manager', 'relocation', 'personal', 'layoff', 'performance', 'other'] as const;

export async function getExitInterview(ctx: PeopleCtx, employeeId: string): Promise<ExitInterview | null> {
  requireHr(ctx);
  const r = (await db().prepare('SELECT data, created_at FROM people_exit_interviews WHERE employee_id = ? AND workspace_id = ?').get(employeeId, ctx.ws)) as
    | { data: string; created_at: string }
    | undefined;
  if (!r) return null;
  const { open } = await import('./secret-box');
  const { audit } = await import('./people');
  await audit(ctx, 'view', 'exit_interview', employeeId);
  return { ...parseJson<ExitInterview>(open(r.data), { reason: '', wouldRecommend: null, rehire: null, liked: '', improve: '', notes: '', createdAt: null }), createdAt: r.created_at };
}

export async function saveExitInterview(ctx: PeopleCtx, employeeId: string, input: Record<string, unknown>): Promise<void> {
  requireHr(ctx);
  if (!(await getEmployeeRow(ctx.ws, employeeId))) throw new PeopleError('not_found', 404);
  const rec = Number(input.wouldRecommend);
  const data = {
    reason: (EXIT_REASONS as readonly string[]).includes(String(input.reason)) ? String(input.reason) : 'other',
    wouldRecommend: Number.isInteger(rec) && rec >= 0 && rec <= 10 ? rec : null,
    rehire: typeof input.rehire === 'boolean' ? input.rehire : null,
    liked: String(input.liked ?? '').slice(0, 4000),
    improve: String(input.improve ?? '').slice(0, 4000),
    notes: String(input.notes ?? '').slice(0, 4000),
  };
  const { seal } = await import('./secret-box');
  await db()
    .prepare(
      `INSERT INTO people_exit_interviews (employee_id, workspace_id, data, created_by, created_at) VALUES (?, ?, ?, ?, ?)
       ON CONFLICT(employee_id) DO UPDATE SET data = excluded.data, created_by = excluded.created_by`,
    )
    .run(employeeId, ctx.ws, seal(JSON.stringify(data)), ctx.personId, nowIso());
  const { audit } = await import('./people');
  await audit(ctx, 'change', 'exit_interview', employeeId);
}
