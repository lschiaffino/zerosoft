/**
 * Track — plans: los "projects" de Linear (un proyecto de Track equivale a un
 * team de Linear). Un plan tiene lead, miembros, equipos (proyectos de Track),
 * estado, fechas, descripción, milestones propios, issues de cualquiera de
 * sus equipos y updates periódicos con salud (ver lib/track-plan-updates.ts).
 *
 * Alcance: como los proyectos de Track, un plan es del team activo o, sin
 * team, del dueño del workspace (owner_id = SessionUser.id).
 */
import { getDb } from './db';
import type { UserRow } from './db';
import { likeContains } from './track-views';
import { computeProgress, healthState, nextReminderAt, type HealthState, type Progress, type StatusCategory } from './track-planning-core';
import type {
  PlanCreatePayload,
  PlanHealth,
  PlanPriority,
  PlanStatus,
  PlanUpdatePayload,
  UpdateCadence,
} from './track-planning-schema';

export interface WorkspaceScope {
  teamId: string | null;
  /** Id efectivo del workspace (SessionUser.id). */
  ownerId: string;
}

export interface TrackPlanRow {
  id: string;
  team_id: string | null;
  owner_id: string | null;
  name: string;
  icon: string | null;
  color: string;
  summary: string;
  description: string;
  status: PlanStatus;
  priority: PlanPriority;
  lead_id: string | null;
  start_date: string | null;
  target_date: string | null;
  update_cadence: UpdateCadence;
  update_day: number;
  next_reminder_at: string | null;
  reminder_claimed_at: string | null;
  created_by: string | null;
  completed_at: string | null;
  created_at: string;
  updated_at: string;
}

export interface PlanMember {
  id: string;
  name: string | null;
  email: string;
}

export interface PlanTeam {
  id: string;
  name: string;
  icon: string | null;
}

export interface PlanMilestone {
  id: string;
  plan_id: string;
  name: string;
  description: string;
  target_date: string | null;
  position: number;
  total: number;
  done: number;
  percent: number;
}

export interface PlanSummary extends TrackPlanRow {
  lead_name: string | null;
  lead_email: string | null;
  teams: PlanTeam[];
  member_ids: string[];
  initiatives: Array<{ id: string; name: string }>;
  progress: Progress;
  health: HealthState;
  last_update_at: string | null;
  last_update_health: PlanHealth | null;
  milestones: Array<{ id: string; name: string; target_date: string | null; percent: number }>;
}

export interface PlanIssue {
  id: string;
  identifier: string;
  title: string;
  project_id: string;
  project_name: string;
  status_id: string | null;
  status_name: string | null;
  status_color: string | null;
  status_category: StatusCategory | null;
  priority: string;
  assignee_id: string | null;
  assignee_name: string | null;
  estimate: number | null;
  plan_milestone_id: string | null;
  due_date: string | null;
  created_at: string;
  updated_at: string;
}

function nowIso(): string {
  return new Date().toISOString();
}

function inClause(n: number): string {
  return `(${Array.from({ length: n }, () => '?').join(', ')})`;
}

export function scopeWhere(scope: WorkspaceScope, alias = ''): { where: string; arg: string } {
  const a = alias ? `${alias}.` : '';
  return scope.teamId
    ? { where: `${a}team_id = ?`, arg: scope.teamId }
    : { where: `(${a}team_id IS NULL AND ${a}owner_id = ?)`, arg: scope.ownerId };
}

export function inScope(row: { team_id: string | null; owner_id: string | null }, scope: WorkspaceScope): boolean {
  if (scope.teamId) return row.team_id === scope.teamId;
  return row.team_id === null && row.owner_id === scope.ownerId;
}

/** Personas del workspace (miembros del team, o el dueño en un workspace personal). */
export async function listWorkspaceMembers(scope: WorkspaceScope): Promise<PlanMember[]> {
  const db = getDb();
  if (scope.teamId) {
    return (await db
      .prepare(
        `SELECT u.id, u.name, u.email FROM team_members m JOIN users u ON u.id = m.user_id
         WHERE m.team_id = ? ORDER BY u.name ASC, u.email ASC`,
      )
      .all(scope.teamId)) as PlanMember[];
  }
  const owner = (await db.prepare('SELECT id, name, email FROM users WHERE id = ?').get(scope.ownerId)) as
    | UserRow
    | undefined;
  return owner ? [{ id: owner.id, name: owner.name, email: owner.email }] : [];
}

/** Proyectos de Track (equipos) del workspace, activos. */
export async function listScopeTeams(scope: WorkspaceScope): Promise<PlanTeam[]> {
  const s = scopeWhere(scope);
  return (await getDb()
    .prepare(`SELECT id, name, icon FROM track_projects WHERE ${s.where} AND status = 'active' ORDER BY name ASC LIMIT 200`)
    .all(s.arg)) as PlanTeam[];
}

async function validMemberIds(scope: WorkspaceScope, ids: string[]): Promise<string[]> {
  if (!ids.length) return [];
  const members = new Set((await listWorkspaceMembers(scope)).map((m) => m.id));
  return [...new Set(ids)].filter((i) => members.has(i));
}

async function validTeamIds(scope: WorkspaceScope, ids: string[]): Promise<string[]> {
  if (!ids.length) return [];
  const s = scopeWhere(scope);
  const rows = (await getDb()
    .prepare(`SELECT id FROM track_projects WHERE ${s.where} AND id IN ${inClause(ids.length)}`)
    .all(s.arg, ...ids)) as Array<{ id: string }>;
  return rows.map((r) => r.id);
}

async function validInitiativeIds(scope: WorkspaceScope, ids: string[]): Promise<string[]> {
  if (!ids.length) return [];
  const s = scopeWhere(scope);
  const rows = (await getDb()
    .prepare(`SELECT id FROM track_initiatives WHERE ${s.where} AND id IN ${inClause(ids.length)}`)
    .all(s.arg, ...ids)) as Array<{ id: string }>;
  return rows.map((r) => r.id);
}

async function leadTimezone(leadId: string | null): Promise<string | null> {
  if (!leadId) return null;
  const row = (await getDb().prepare('SELECT timezone FROM track_notify_prefs WHERE user_id = ?').get(leadId)) as
    | { timezone: string | null }
    | undefined;
  return row?.timezone ?? null;
}

/** Recalcula cuándo toca el próximo recordatorio de update (solo plans en curso con lead). */
export async function scheduleReminder(planId: string, after: Date = new Date()): Promise<void> {
  const plan = await getPlan(planId);
  if (!plan) return;
  let next: string | null = null;
  if (plan.status === 'in_progress' && plan.lead_id && plan.update_cadence !== 'off') {
    const at = nextReminderAt({
      after,
      day: plan.update_day,
      cadence: plan.update_cadence,
      timeZone: await leadTimezone(plan.lead_id),
    });
    next = at ? at.toISOString() : null;
  }
  await getDb().prepare('UPDATE track_plans SET next_reminder_at = ? WHERE id = ?').run(next, planId);
}

export async function getPlan(id: string): Promise<TrackPlanRow | undefined> {
  return (await getDb().prepare('SELECT * FROM track_plans WHERE id = ?').get(id)) as TrackPlanRow | undefined;
}

export async function getAccessiblePlan(id: string, scope: WorkspaceScope): Promise<TrackPlanRow | undefined> {
  const plan = await getPlan(id);
  return plan && inScope(plan, scope) ? plan : undefined;
}

async function logEvent(planId: string, userId: string | null, type: string, meta: Record<string, unknown>): Promise<void> {
  await getDb()
    .prepare('INSERT INTO track_plan_events (id, plan_id, user_id, type, meta, created_at) VALUES (?, ?, ?, ?, ?, ?)')
    .run(crypto.randomUUID(), planId, userId, type, JSON.stringify(meta), nowIso());
}

async function setPlanTeams(planId: string, teamIds: string[]): Promise<void> {
  const db = getDb();
  await db.prepare('DELETE FROM track_plan_teams WHERE plan_id = ?').run(planId);
  for (const t of teamIds) {
    await db.prepare('INSERT OR IGNORE INTO track_plan_teams (plan_id, project_id) VALUES (?, ?)').run(planId, t);
  }
}

async function setPlanMembers(planId: string, memberIds: string[]): Promise<void> {
  const db = getDb();
  await db.prepare('DELETE FROM track_plan_members WHERE plan_id = ?').run(planId);
  for (const u of memberIds) {
    await db.prepare('INSERT OR IGNORE INTO track_plan_members (plan_id, user_id) VALUES (?, ?)').run(planId, u);
  }
}

async function setPlanInitiatives(planId: string, initiativeIds: string[]): Promise<void> {
  const db = getDb();
  await db.prepare('DELETE FROM track_initiative_plans WHERE plan_id = ?').run(planId);
  for (const i of initiativeIds) {
    await db.prepare('INSERT OR IGNORE INTO track_initiative_plans (initiative_id, plan_id) VALUES (?, ?)').run(i, planId);
  }
}

export type PlanMutationError = 'invalid_lead' | 'invalid_range';

function rangeOk(start: string | null | undefined, target: string | null | undefined): boolean {
  return !start || !target || start <= target;
}

export async function createPlan(
  scope: WorkspaceScope,
  actorId: string,
  payload: PlanCreatePayload,
): Promise<{ ok: true; plan: TrackPlanRow } | { ok: false; error: PlanMutationError }> {
  if (!rangeOk(payload.startDate, payload.targetDate)) return { ok: false, error: 'invalid_range' };
  const leadId = payload.leadId ? (await validMemberIds(scope, [payload.leadId]))[0] : null;
  if (payload.leadId && !leadId) return { ok: false, error: 'invalid_lead' };
  const id = crypto.randomUUID();
  const now = nowIso();
  const status = payload.status ?? 'planned';
  await getDb()
    .prepare(
      `INSERT INTO track_plans (id, team_id, owner_id, name, icon, color, summary, description, status, priority, lead_id,
         start_date, target_date, update_cadence, update_day, created_by, completed_at, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(
      id,
      scope.teamId,
      scope.ownerId,
      payload.name.trim(),
      payload.icon?.trim() || null,
      payload.color ?? '#5e6ad2',
      payload.summary?.trim() ?? '',
      payload.description ?? '',
      status,
      payload.priority ?? 'none',
      leadId,
      payload.startDate ?? null,
      payload.targetDate ?? null,
      payload.updateCadence ?? 'weekly',
      payload.updateDay ?? 5,
      actorId,
      status === 'completed' ? now : null,
      now,
      now,
    );
  await setPlanTeams(id, await validTeamIds(scope, payload.teamIds ?? []));
  await setPlanMembers(id, await validMemberIds(scope, payload.memberIds ?? []));
  await setPlanInitiatives(id, await validInitiativeIds(scope, payload.initiativeIds ?? []));
  await logEvent(id, actorId, 'created', {});
  await scheduleReminder(id);
  return { ok: true, plan: (await getPlan(id)) as TrackPlanRow };
}

export async function updatePlan(
  plan: TrackPlanRow,
  scope: WorkspaceScope,
  actorId: string,
  payload: PlanUpdatePayload,
): Promise<{ ok: true; plan: TrackPlanRow } | { ok: false; error: PlanMutationError }> {
  const start = payload.startDate !== undefined ? payload.startDate : plan.start_date;
  const target = payload.targetDate !== undefined ? payload.targetDate : plan.target_date;
  if (!rangeOk(start, target)) return { ok: false, error: 'invalid_range' };
  const fields: string[] = [];
  const args: Array<string | number | null> = [];
  const set = (col: string, v: string | number | null) => {
    fields.push(`${col} = ?`);
    args.push(v);
  };
  const events: Array<{ type: string; meta: Record<string, unknown> }> = [];
  if (payload.name !== undefined && payload.name.trim() !== plan.name) {
    set('name', payload.name.trim());
    events.push({ type: 'renamed', meta: { from: plan.name, to: payload.name.trim() } });
  }
  if (payload.icon !== undefined) set('icon', payload.icon.trim() || null);
  if (payload.color !== undefined) set('color', payload.color);
  if (payload.summary !== undefined) set('summary', payload.summary.trim());
  if (payload.description !== undefined) set('description', payload.description);
  if (payload.priority !== undefined) set('priority', payload.priority);
  if (payload.status !== undefined && payload.status !== plan.status) {
    set('status', payload.status);
    set('completed_at', payload.status === 'completed' ? nowIso() : null);
    events.push({ type: 'status', meta: { from: plan.status, to: payload.status } });
  }
  if (payload.leadId !== undefined && (payload.leadId ?? null) !== plan.lead_id) {
    const lead = payload.leadId ? (await validMemberIds(scope, [payload.leadId]))[0] : null;
    if (payload.leadId && !lead) return { ok: false, error: 'invalid_lead' };
    set('lead_id', lead);
    events.push({ type: 'lead', meta: { from: plan.lead_id, to: lead } });
  }
  if (payload.startDate !== undefined && (payload.startDate ?? null) !== plan.start_date) {
    set('start_date', payload.startDate ?? null);
    events.push({ type: 'start_date', meta: { from: plan.start_date, to: payload.startDate ?? null } });
  }
  if (payload.targetDate !== undefined && (payload.targetDate ?? null) !== plan.target_date) {
    set('target_date', payload.targetDate ?? null);
    events.push({ type: 'target_date', meta: { from: plan.target_date, to: payload.targetDate ?? null } });
  }
  if (payload.updateCadence !== undefined) set('update_cadence', payload.updateCadence);
  if (payload.updateDay !== undefined) set('update_day', payload.updateDay);
  if (fields.length) {
    set('updated_at', nowIso());
    await getDb()
      .prepare(`UPDATE track_plans SET ${fields.join(', ')} WHERE id = ?`)
      .run(...args, plan.id);
  }
  if (payload.teamIds !== undefined) await setPlanTeams(plan.id, await validTeamIds(scope, payload.teamIds));
  if (payload.memberIds !== undefined) {
    const before = new Set(await planMemberIds(plan.id));
    const next = await validMemberIds(scope, payload.memberIds);
    await setPlanMembers(plan.id, next);
    const added = next.filter((m) => !before.has(m));
    if (added.length) events.push({ type: 'members', meta: { added } });
  }
  if (payload.initiativeIds !== undefined) await setPlanInitiatives(plan.id, await validInitiativeIds(scope, payload.initiativeIds));
  for (const e of events) await logEvent(plan.id, actorId, e.type, e.meta);
  if (
    payload.status !== undefined ||
    payload.leadId !== undefined ||
    payload.updateCadence !== undefined ||
    payload.updateDay !== undefined
  ) {
    await scheduleReminder(plan.id);
  }
  return { ok: true, plan: (await getPlan(plan.id)) as TrackPlanRow };
}

export async function deletePlan(id: string): Promise<boolean> {
  const db = getDb();
  await db.prepare('UPDATE track_issues SET plan_id = NULL, plan_milestone_id = NULL WHERE plan_id = ?').run(id);
  const res = await db.prepare('DELETE FROM track_plans WHERE id = ?').run(id);
  return res.changes > 0;
}

export async function planMemberIds(planId: string): Promise<string[]> {
  return ((await getDb().prepare('SELECT user_id FROM track_plan_members WHERE plan_id = ?').all(planId)) as Array<{ user_id: string }>).map(
    (r) => r.user_id,
  );
}

// ---------- Listado con progreso y salud ----------

interface PlanIssueStat {
  plan_id: string;
  category: StatusCategory | null;
  estimate: number | null;
  plan_milestone_id: string | null;
}

export interface ListPlansOptions {
  status?: PlanStatus[];
  leadId?: string;
  teamId?: string;
  initiativeId?: string;
  q?: string;
  ids?: string[];
}

/** Plans del workspace con lead, equipos, iniciativas, progreso, salud y milestones. */
export async function listPlans(scope: WorkspaceScope, opts: ListPlansOptions = {}, now: Date = new Date()): Promise<PlanSummary[]> {
  const db = getDb();
  const s = scopeWhere(scope, 'p');
  const where = [s.where];
  const args: Array<string | number> = [s.arg];
  if (opts.status?.length) {
    where.push(`p.status IN ${inClause(opts.status.length)}`);
    args.push(...opts.status);
  }
  if (opts.leadId) {
    where.push('p.lead_id = ?');
    args.push(opts.leadId);
  }
  if (opts.teamId) {
    where.push('p.id IN (SELECT plan_id FROM track_plan_teams WHERE project_id = ?)');
    args.push(opts.teamId);
  }
  if (opts.initiativeId) {
    where.push('p.id IN (SELECT plan_id FROM track_initiative_plans WHERE initiative_id = ?)');
    args.push(opts.initiativeId);
  }
  if (opts.q?.trim()) {
    where.push("p.name LIKE ? ESCAPE '\\'");
    args.push(likeContains(opts.q.trim()));
  }
  if (opts.ids) {
    if (!opts.ids.length) return [];
    where.push(`p.id IN ${inClause(opts.ids.length)}`);
    args.push(...opts.ids);
  }
  const rows = (await db
    .prepare(
      `SELECT p.*, u.name AS lead_name, u.email AS lead_email,
         (SELECT created_at FROM track_plan_updates x WHERE x.plan_id = p.id ORDER BY x.created_at DESC LIMIT 1) AS last_update_at,
         (SELECT health FROM track_plan_updates x WHERE x.plan_id = p.id ORDER BY x.created_at DESC LIMIT 1) AS last_update_health
       FROM track_plans p LEFT JOIN users u ON u.id = p.lead_id
       WHERE ${where.join(' AND ')}
       ORDER BY CASE p.status WHEN 'in_progress' THEN 0 WHEN 'planned' THEN 1 WHEN 'paused' THEN 2 WHEN 'backlog' THEN 3 WHEN 'completed' THEN 4 ELSE 5 END,
         p.target_date IS NULL, p.target_date ASC, p.name ASC
       LIMIT 500`,
    )
    .all(...args)) as Array<TrackPlanRow & { lead_name: string | null; lead_email: string | null; last_update_at: string | null; last_update_health: PlanHealth | null }>;
  if (!rows.length) return [];
  const ids = rows.map((r) => r.id);
  const inIds = inClause(ids.length);
  const [teams, members, inits, stats, milestones] = await Promise.all([
    db
      .prepare(
        `SELECT t.plan_id, p.id, p.name, p.icon FROM track_plan_teams t JOIN track_projects p ON p.id = t.project_id
         WHERE t.plan_id IN ${inIds} ORDER BY p.name`,
      )
      .all(...ids) as Promise<Array<PlanTeam & { plan_id: string }>>,
    db.prepare(`SELECT plan_id, user_id FROM track_plan_members WHERE plan_id IN ${inIds}`).all(...ids) as Promise<
      Array<{ plan_id: string; user_id: string }>
    >,
    db
      .prepare(
        `SELECT ip.plan_id, i.id, i.name FROM track_initiative_plans ip JOIN track_initiatives i ON i.id = ip.initiative_id
         WHERE ip.plan_id IN ${inIds} ORDER BY i.name`,
      )
      .all(...ids) as Promise<Array<{ plan_id: string; id: string; name: string }>>,
    db
      .prepare(
        `SELECT i.plan_id, s.category, i.estimate, i.plan_milestone_id FROM track_issues i
         LEFT JOIN track_statuses s ON s.id = i.status_id
         WHERE i.plan_id IN ${inIds} AND i.triage = 0`,
      )
      .all(...ids) as Promise<PlanIssueStat[]>,
    db
      .prepare(`SELECT id, plan_id, name, target_date, position FROM track_plan_milestones WHERE plan_id IN ${inIds} ORDER BY position, target_date`)
      .all(...ids) as Promise<Array<{ id: string; plan_id: string; name: string; target_date: string | null; position: number }>>,
  ]);
  return rows.map((r) => {
    const own = stats.filter((x) => x.plan_id === r.id);
    return {
      ...r,
      teams: teams.filter((t) => t.plan_id === r.id).map(({ id, name, icon }) => ({ id, name, icon })),
      member_ids: members.filter((m) => m.plan_id === r.id).map((m) => m.user_id),
      initiatives: inits.filter((i) => i.plan_id === r.id).map(({ id, name }) => ({ id, name })),
      progress: computeProgress(own),
      health: healthState({
        status: r.status,
        cadence: r.update_cadence,
        lastUpdateHealth: r.last_update_health,
        lastUpdateAt: r.last_update_at,
        // Desde que arrancó (fecha de inicio) o se creó, lo más reciente.
        since: r.start_date && r.start_date > r.created_at.slice(0, 10) ? `${r.start_date}T00:00:00Z` : r.created_at,
        now,
      }),
      milestones: milestones
        .filter((m) => m.plan_id === r.id)
        .map((m) => ({
          id: m.id,
          name: m.name,
          target_date: m.target_date,
          percent: computeProgress(own.filter((x) => x.plan_milestone_id === m.id)).percent,
        })),
    };
  });
}

export async function getPlanSummary(id: string, scope: WorkspaceScope): Promise<PlanSummary | undefined> {
  return (await listPlans(scope, { ids: [id] }))[0];
}

// ---------- Issues del plan ----------

const ISSUE_SELECT = `SELECT i.id, i.identifier, i.title, i.project_id, p.name AS project_name, i.status_id,
    s.name AS status_name, s.color AS status_color, s.category AS status_category, i.priority, i.assignee_id,
    u.name AS assignee_name, i.estimate, i.plan_milestone_id, i.due_date, i.created_at, i.updated_at
  FROM track_issues i
  JOIN track_projects p ON p.id = i.project_id
  LEFT JOIN track_statuses s ON s.id = i.status_id
  LEFT JOIN users u ON u.id = i.assignee_id`;

export async function listPlanIssues(planId: string): Promise<PlanIssue[]> {
  return (await getDb()
    .prepare(
      `${ISSUE_SELECT} WHERE i.plan_id = ? AND i.triage = 0
       ORDER BY CASE s.category WHEN 'in_progress' THEN 0 WHEN 'todo' THEN 1 WHEN 'backlog' THEN 2 WHEN 'done' THEN 3 ELSE 4 END,
         CASE i.priority WHEN 'urgent' THEN 0 WHEN 'high' THEN 1 WHEN 'medium' THEN 2 ELSE 3 END, i.created_at DESC
       LIMIT 1000`,
    )
    .all(planId)) as PlanIssue[];
}

/** Issues del workspace que se pueden sumar al plan (búsqueda por título o identificador). */
export async function searchIssuesForPlan(scope: WorkspaceScope, planId: string, q: string): Promise<PlanIssue[]> {
  const s = scopeWhere(scope, 'p');
  const like = likeContains(q.trim());
  return (await getDb()
    .prepare(
      `${ISSUE_SELECT} WHERE ${s.where} AND p.status = 'active' AND i.triage = 0 AND i.archived_at IS NULL
         AND (i.plan_id IS NULL OR i.plan_id != ?)
         AND (i.title LIKE ? ESCAPE '\\' OR i.identifier LIKE ? ESCAPE '\\')
       ORDER BY i.updated_at DESC LIMIT 20`,
    )
    .all(s.arg, planId, like, like)) as PlanIssue[];
}

/**
 * Suma o saca issues del plan. Solo issues de proyectos del workspace; al
 * sumar, el proyecto del issue pasa a ser uno de los equipos del plan (como
 * en Linear, donde el team del issue contribuye al project).
 */
export async function setPlanIssues(
  plan: TrackPlanRow,
  scope: WorkspaceScope,
  action: 'add' | 'remove',
  issueIds: string[],
  milestoneId?: string | null,
): Promise<number> {
  const db = getDb();
  const s = scopeWhere(scope, 'p');
  const rows = (await db
    .prepare(
      `SELECT i.id, i.project_id FROM track_issues i JOIN track_projects p ON p.id = i.project_id
       WHERE ${s.where} AND i.id IN ${inClause(issueIds.length)}`,
    )
    .all(s.arg, ...issueIds)) as Array<{ id: string; project_id: string }>;
  if (!rows.length) return 0;
  const ids = rows.map((r) => r.id);
  const now = nowIso();
  if (action === 'remove') {
    const res = await db
      .prepare(`UPDATE track_issues SET plan_id = NULL, plan_milestone_id = NULL, updated_at = ? WHERE plan_id = ? AND id IN ${inClause(ids.length)}`)
      .run(now, plan.id, ...ids);
    return res.changes;
  }
  let ms: string | null = null;
  if (milestoneId) {
    const m = (await db.prepare('SELECT id FROM track_plan_milestones WHERE id = ? AND plan_id = ?').get(milestoneId, plan.id)) as
      | { id: string }
      | undefined;
    ms = m?.id ?? null;
  }
  const res = await db
    .prepare(`UPDATE track_issues SET plan_id = ?, plan_milestone_id = ?, updated_at = ? WHERE id IN ${inClause(ids.length)}`)
    .run(plan.id, ms, now, ...ids);
  for (const projectId of new Set(rows.map((r) => r.project_id))) {
    await db.prepare('INSERT OR IGNORE INTO track_plan_teams (plan_id, project_id) VALUES (?, ?)').run(plan.id, projectId);
  }
  return res.changes;
}

export async function setIssuePlanMilestone(planId: string, issueId: string, milestoneId: string | null): Promise<boolean> {
  const db = getDb();
  if (milestoneId) {
    const m = await db.prepare('SELECT id FROM track_plan_milestones WHERE id = ? AND plan_id = ?').get(milestoneId, planId);
    if (!m) return false;
  }
  const res = await db
    .prepare('UPDATE track_issues SET plan_milestone_id = ?, updated_at = ? WHERE id = ? AND plan_id = ?')
    .run(milestoneId, nowIso(), issueId, planId);
  return res.changes > 0;
}

// ---------- Milestones del plan ----------

export async function listPlanMilestones(planId: string): Promise<PlanMilestone[]> {
  const db = getDb();
  const ms = (await db
    .prepare('SELECT * FROM track_plan_milestones WHERE plan_id = ? ORDER BY position ASC, target_date IS NULL, target_date ASC, created_at ASC')
    .all(planId)) as Array<Omit<PlanMilestone, 'total' | 'done' | 'percent'>>;
  if (!ms.length) return [];
  const stats = (await db
    .prepare(
      `SELECT i.plan_milestone_id, s.category, i.estimate FROM track_issues i LEFT JOIN track_statuses s ON s.id = i.status_id
       WHERE i.plan_id = ? AND i.plan_milestone_id IS NOT NULL AND i.triage = 0`,
    )
    .all(planId)) as Array<{ plan_milestone_id: string; category: StatusCategory | null; estimate: number | null }>;
  return ms.map((m) => {
    const p = computeProgress(stats.filter((x) => x.plan_milestone_id === m.id));
    return { ...m, total: p.total, done: p.done, percent: p.percent };
  });
}

export async function getPlanMilestone(id: string): Promise<{ id: string; plan_id: string; name: string } | undefined> {
  return (await getDb().prepare('SELECT id, plan_id, name FROM track_plan_milestones WHERE id = ?').get(id)) as
    | { id: string; plan_id: string; name: string }
    | undefined;
}

export async function createPlanMilestone(
  planId: string,
  actorId: string,
  payload: { name: string; description?: string; targetDate?: string | null },
): Promise<string> {
  const db = getDb();
  const max = (await db.prepare('SELECT COALESCE(MAX(position), -1) AS m FROM track_plan_milestones WHERE plan_id = ?').get(planId)) as {
    m: number;
  };
  const id = crypto.randomUUID();
  await db
    .prepare('INSERT INTO track_plan_milestones (id, plan_id, name, description, target_date, position, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)')
    .run(id, planId, payload.name.trim(), payload.description?.trim() ?? '', payload.targetDate ?? null, Number(max.m) + 1, nowIso());
  await logEvent(planId, actorId, 'milestone_added', { name: payload.name.trim() });
  return id;
}

export async function updatePlanMilestone(
  id: string,
  payload: { name?: string; description?: string; targetDate?: string | null; position?: number },
): Promise<void> {
  const fields: string[] = [];
  const args: Array<string | number | null> = [];
  if (payload.name !== undefined) {
    fields.push('name = ?');
    args.push(payload.name.trim());
  }
  if (payload.description !== undefined) {
    fields.push('description = ?');
    args.push(payload.description.trim());
  }
  if (payload.targetDate !== undefined) {
    fields.push('target_date = ?');
    args.push(payload.targetDate ?? null);
  }
  if (payload.position !== undefined) {
    fields.push('position = ?');
    args.push(payload.position);
  }
  if (!fields.length) return;
  await getDb().prepare(`UPDATE track_plan_milestones SET ${fields.join(', ')} WHERE id = ?`).run(...args, id);
}

export async function deletePlanMilestone(id: string): Promise<void> {
  const db = getDb();
  await db.prepare('UPDATE track_issues SET plan_milestone_id = NULL WHERE plan_milestone_id = ?').run(id);
  await db.prepare('DELETE FROM track_plan_milestones WHERE id = ?').run(id);
}

// ---------- Seguidores ----------

/** Quienes reciben los updates: lead, miembros y seguidores explícitos, menos quien dejó de seguir. */
export async function planRecipients(planId: string): Promise<string[]> {
  const db = getDb();
  const plan = await getPlan(planId);
  if (!plan) return [];
  const members = await planMemberIds(planId);
  const follows = (await db.prepare('SELECT user_id, following FROM track_plan_followers WHERE plan_id = ?').all(planId)) as Array<{
    user_id: string;
    following: number;
  }>;
  const out = new Set<string>([...(plan.lead_id ? [plan.lead_id] : []), ...members]);
  for (const f of follows) {
    if (Number(f.following)) out.add(f.user_id);
    else out.delete(f.user_id);
  }
  return [...out];
}

export async function isFollowingPlan(planId: string, userId: string): Promise<boolean> {
  return (await planRecipients(planId)).includes(userId);
}

export async function setPlanFollow(planId: string, userId: string, following: boolean): Promise<void> {
  await getDb()
    .prepare(
      `INSERT INTO track_plan_followers (plan_id, user_id, following) VALUES (?, ?, ?)
       ON CONFLICT(plan_id, user_id) DO UPDATE SET following = excluded.following`,
    )
    .run(planId, userId, following ? 1 : 0);
}

// ---------- Historial ----------

export interface PlanEvent {
  id: string;
  type: string;
  meta: string;
  user_id: string | null;
  user_name: string | null;
  user_email: string | null;
  created_at: string;
}

export async function listPlanEvents(planId: string): Promise<PlanEvent[]> {
  return (await getDb()
    .prepare(
      `SELECT e.id, e.type, e.meta, e.user_id, u.name AS user_name, u.email AS user_email, e.created_at
       FROM track_plan_events e LEFT JOIN users u ON u.id = e.user_id
       WHERE e.plan_id = ? ORDER BY e.created_at DESC LIMIT 200`,
    )
    .all(planId)) as PlanEvent[];
}
