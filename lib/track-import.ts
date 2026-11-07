/**
 * Track — import: vista previa y escritura de lo que dejó la etapa de lectura
 * en import_job_items (issues normalizados de lib/track-import-map.ts y, desde
 * la API de Linear, también teams, projects, cycles, comentarios, adjuntos y
 * relaciones: lib/track-linear-import.ts).
 *
 * - Teams: el elegido, o uno nuevo por team de la fuente (team de Linear con
 *   su clave y sus workflow states en orden, proyecto de Jira, repo de
 *   GitHub, columna del CSV). Un team privado de Linear queda privado para
 *   sus miembros.
 * - Status: por nombre dentro del team; si no existe se crea con su
 *   categoría. Sin nombre (GitHub, Triage de Linear) va al primero de la
 *   categoría. El estado Triage de Linear deja el issue en la cola de triage.
 * - Projects de Linear → projects de Track (lead, miembros, teams, estado,
 *   prioridad, fechas, descripción, milestones y updates con su health).
 * - Personas: por email (o nombre) contra los miembros del workspace; quien no
 *   está queda sin responsable y aparece en la vista previa.
 * - Labels del workspace, cycles del team y milestones se crean una vez.
 * - Comentarios con su fecha y su hilo; si el autor no es miembro, lo firma
 *   quien importa con el nombre original arriba.
 * - Adjuntos de Linear (links): un PR de GitHub va a la sección GitHub del
 *   issue; el resto a sus links.
 * - Relaciones: bloquea, duplicado y relacionado (similar de Linear).
 *
 * Reimportar no duplica (ids externos en import_external_ids): lo que cambió
 * en la fuente después de la última vez (updatedAt más nuevo que el del
 * issue en Track) se actualiza; si se editó en Track después, queda lo de
 * Track. Suma solo los comentarios, adjuntos y relaciones nuevos.
 *
 * Inserta directo (sin notificaciones ni webhooks: es una mudanza, no
 * actividad nueva).
 */
import { listOwnerSpacePeople } from './workspace';
import { getDb, type TrackStatusRow } from './db';
import {
  getExternalId,
  getExternalIds,
  setExternalId,
  type ImportJob,
  type StagedItem,
} from './import-jobs';
import { createCycle, createProject, createStatus, DEFAULT_STATUS_NAMES, getProject, getProjectBySlug, listStatuses, nextIdentifier } from './track-data';
import { projectSlug, shortProjectKey } from './track-tasks';
import { normalizeIssueLabels, trackWorkspaceId, listLabels } from './track-labels';
import { createPlan, createPlanMilestone, type WorkspaceScope } from './track-plans';
import { upsertExternalRef } from './track-integrations';
import type { NormalizedComment, NormalizedIssue, TrackImportSource } from './track-import-map';
import type { ImportPerson, LinearAttachmentItem, LinearCycleItem, LinearPlanItem, LinearRelationItem, LinearTeamItem, LinearUserItem } from './track-linear-import';

export interface TrackImportOptions {
  /** 'new' = un proyecto por proyecto de la fuente; si no, el id del proyecto destino. */
  target: string;
}

interface Member {
  id: string;
  email: string;
  name: string | null;
}

export function trackImportWorkspace(job: Pick<ImportJob, 'team_id' | 'workspace_id'>): string {
  return trackWorkspaceId(job.team_id, job.workspace_id);
}

/** Fuente para los ids externos: Linear por CSV o por API comparte ids (ENG-12). */
export function externalSource(source: string): string {
  if (source === 'linear' || source === 'linear_csv') return 'linear';
  // Jira por API o CSV comparte ids (la key PROJ-3).
  if (source === 'jira_csv' || source === 'jira') return 'jira';
  if (source === 'github') return 'github';
  if (source === 'asana') return 'asana';
  if (source === 'shortcut') return 'shortcut';
  return 'csv';
}

export function trackSourceKind(source: string): TrackImportSource {
  return externalSource(source) as TrackImportSource;
}

async function listMembers(job: Pick<ImportJob, 'team_id' | 'workspace_id'>): Promise<Member[]> {
  const db = getDb();
  if (job.team_id) {
    return (await db
      .prepare('SELECT u.id, u.email, u.name FROM team_members m JOIN users u ON u.id = m.user_id WHERE m.team_id = ?')
      .all(job.team_id)) as Member[];
  }
  return (await listOwnerSpacePeople(job.workspace_id, {}, db)).map((p) => ({ id: p.id, email: p.email, name: p.name })) as Member[];
}

/** Persona de la fuente → miembro: email, nombre, o login igual a la parte local del email. */
export function matchMember(members: Member[], person: { email?: string | null; name?: string | null } | null | undefined): Member | null {
  if (!person) return null;
  const email = person.email?.trim().toLowerCase();
  const name = person.name?.trim().toLowerCase();
  if (email) {
    const m = members.find((x) => x.email.toLowerCase() === email);
    if (m) return m;
  }
  if (name) {
    return (
      members.find((x) => (x.name ?? '').trim().toLowerCase() === name) ??
      members.find((x) => x.email.toLowerCase().split('@')[0] === name) ??
      null
    );
  }
  return null;
}

function personLabel(p: { email?: string | null; name?: string | null }): string {
  return (p.email || p.name || '').trim();
}

function targetOf(job: ImportJob): string {
  const t = (job.options as unknown as TrackImportOptions).target;
  return typeof t === 'string' && t ? t : 'new';
}

function scopeOf(job: ImportJob): WorkspaceScope {
  return { teamId: job.team_id, ownerId: job.workspace_id };
}

/** El estado Triage de Linear no es un status en Track: es la cola de triage. */
function statusFor(issue: NormalizedIssue): NormalizedIssue['status'] {
  return issue.triage ? { name: null, category: 'backlog' } : issue.status;
}

function byKind<T>(items: StagedItem[], kind: string): T[] {
  return items.filter((i) => i.kind === kind).map((i) => i.data as unknown as T);
}

// ---------- Vista previa ----------

export interface TrackImportPreview {
  [key: string]: unknown;
  /** Nombre del workspace de origen (Linear por API). */
  sourceName: string | null;
  issues: number;
  comments: number;
  alreadyImported: number;
  /** De los ya importados, cuántos cambiaron en la fuente y se van a actualizar. */
  toUpdate: number;
  projects: Array<{ name: string; issues: number; existing: string | null }>;
  plans: Array<{ name: string; issues: number; milestones: number; updates: number; existing: boolean }>;
  statuses: Array<{ name: string; category: string; issues: number; existing: boolean }>;
  people: Array<{ label: string; issues: number; member: string | null }>;
  labels: { total: number; existing: number };
  cycles: number;
  milestones: number;
  estimates: number;
  relations: number;
  attachments: number;
  triage: number;
  archived: number;
  priorities: Record<string, number>;
  sample: Array<{ key: string | null; title: string; status: string; assignee: string | null }>;
}

export async function trackPreview(job: ImportJob, items: StagedItem[]): Promise<TrackImportPreview> {
  const ws = trackImportWorkspace(job);
  const src = externalSource(job.source);
  const issues = byKind<NormalizedIssue>(items, 'issue');
  const teams = byKind<LinearTeamItem>(items, 'team');
  const plansIn = byKind<LinearPlanItem>(items, 'plan');
  const cycleItems = byKind<LinearCycleItem>(items, 'cycle');
  const users = byKind<LinearUserItem>(items, 'user');
  const org = byKind<{ name: string }>(items, 'org')[0];
  const members = await listMembers(job);
  const target = targetOf(job);
  const targetProject = target !== 'new' ? await getProject(target) : undefined;

  const already = await getExternalIds(ws, src, 'issue', issues.map((i) => i.extId));
  const teamExtIds = new Set([...issues.map((i) => i.project.extId), ...teams.map((t) => t.extId)]);
  const mappedProjects = await getExternalIds(ws, src, 'project', [...teamExtIds]);
  const mappedPlans = await getExternalIds(ws, src, 'plan', [...new Set([...plansIn.map((p) => p.extId), ...issues.map((i) => i.plan?.extId).filter((x): x is string => !!x)])]);

  // Ya importados que cambiaron en la fuente desde entonces.
  let toUpdate = 0;
  const alreadyIds = [...already.values()];
  if (alreadyIds.length) {
    const updatedAt = new Map<string, string>();
    for (let i = 0; i < alreadyIds.length; i += 400) {
      const chunk = alreadyIds.slice(i, i + 400);
      const rows = (await getDb()
        .prepare(`SELECT id, updated_at FROM track_issues WHERE id IN (${chunk.map(() => '?').join(',')})`)
        .all(...chunk)) as Array<{ id: string; updated_at: string }>;
      for (const r of rows) updatedAt.set(r.id, r.updated_at);
    }
    for (const issue of issues) {
      const local = already.get(issue.extId);
      const at = local ? updatedAt.get(local) : undefined;
      if (at && issue.updatedAt && issue.updatedAt > at) toUpdate += 1;
    }
  }

  const projects = new Map<string, { name: string; issues: number; existing: string | null }>();
  const statuses = new Map<string, { name: string; category: string; issues: number; existing: boolean }>();
  const people = new Map<string, { label: string; issues: number; member: string | null }>();
  const plans = new Map<string, { name: string; issues: number; milestones: number; updates: number; existing: boolean }>();
  const labelNames = new Set<string>();
  const cycles = new Set<string>();
  const milestones = new Set<string>();
  const priorities: Record<string, number> = { urgent: 0, high: 0, medium: 0, low: 0 };
  let comments = items.filter((i) => i.kind === 'comment').length;
  let estimates = 0;
  let triage = 0;
  let archived = 0;

  // Status que ya existen: los del proyecto destino o los que nacen con un proyecto nuevo.
  const defaults = DEFAULT_STATUS_NAMES[(job.locale as 'en' | 'es' | 'pt') ?? 'en'] ?? DEFAULT_STATUS_NAMES.en;
  const existingStatusNames = new Set(
    (targetProject ? (await listStatuses(targetProject.id)).map((s) => s.name) : Object.values(defaults)).map((n) => n.toLowerCase()),
  );
  const projectNames = new Map<string, string>();
  for (const id of new Set(mappedProjects.values())) {
    const p = await getProject(id);
    if (p) projectNames.set(id, p.name);
  }
  const teamRow = (extId: string, name: string) => {
    const key = targetProject ? targetProject.id : extId;
    const row = projects.get(key) ?? {
      name: targetProject ? targetProject.name : name,
      issues: 0,
      existing: targetProject ? targetProject.name : (projectNames.get(mappedProjects.get(extId) ?? '') ?? null),
    };
    projects.set(key, row);
    return row;
  };
  for (const t of teams) teamRow(t.extId, t.name);
  for (const p of plansIn) {
    plans.set(p.extId, { name: p.name, issues: 0, milestones: p.milestones.length, updates: p.updates.length, existing: mappedPlans.has(p.extId) });
  }
  // Las personas de Linear (aunque no tengan issues asignados): así se ve quién falta invitar.
  for (const u of users.filter((x) => x.active)) {
    const label = personLabel(u);
    if (!label) continue;
    const m = matchMember(members, u);
    people.set(label.toLowerCase(), { label, issues: 0, member: m ? m.name || m.email : null });
  }
  for (const c of cycleItems) cycles.add(`${targetProject ? targetProject.id : c.teamExtId}|${c.extId}`);

  for (const issue of issues) {
    teamRow(issue.project.extId, issue.project.name).issues += 1;
    const projKey = targetProject ? targetProject.id : issue.project.extId;

    const status = statusFor(issue);
    if (status.name) {
      const key = status.name.toLowerCase();
      const s = statuses.get(key) ?? { name: status.name, category: status.category, issues: 0, existing: existingStatusNames.has(key) };
      s.issues += 1;
      statuses.set(key, s);
    } else {
      const key = `:${status.category}`;
      const s = statuses.get(key) ?? { name: '', category: status.category, issues: 0, existing: true };
      s.issues += 1;
      statuses.set(key, s);
    }

    if (issue.assignee && personLabel(issue.assignee)) {
      const label = personLabel(issue.assignee);
      const p = people.get(label.toLowerCase()) ?? { label, issues: 0, member: null as string | null };
      const m = matchMember(members, issue.assignee);
      p.member = m ? m.name || m.email : null;
      p.issues += 1;
      people.set(label.toLowerCase(), p);
    }
    if (issue.plan) {
      const p = plans.get(issue.plan.extId) ?? { name: issue.plan.name, issues: 0, milestones: 0, updates: 0, existing: mappedPlans.has(issue.plan.extId) };
      p.issues += 1;
      plans.set(issue.plan.extId, p);
    }
    for (const l of issue.labels) labelNames.add(l.name.toLowerCase());
    if (issue.cycle) cycles.add(`${projKey}|${issue.cycle.extId}`);
    if (issue.milestone) milestones.add(`${projKey}|${issue.milestone.extId}`);
    if (issue.planMilestone && !plansIn.length) milestones.add(`plan|${issue.planMilestone.extId}`);
    if (issue.estimate != null) estimates += 1;
    if (issue.triage) triage += 1;
    if (issue.archivedAt) archived += 1;
    priorities[issue.priority] = (priorities[issue.priority] ?? 0) + 1;
    comments += issue.comments.length;
  }

  const existingLabels = new Set((await listLabels(ws)).map((l) => l.name.toLowerCase()));

  return {
    sourceName: org?.name || null,
    issues: issues.length,
    comments,
    alreadyImported: already.size,
    toUpdate,
    projects: [...projects.values()],
    plans: [...plans.values()],
    statuses: [...statuses.values()].sort((a, b) => b.issues - a.issues),
    people: [...people.values()].sort((a, b) => Number(!!a.member) - Number(!!b.member) || b.issues - a.issues).slice(0, 100),
    labels: { total: labelNames.size, existing: [...labelNames].filter((n) => existingLabels.has(n)).length },
    cycles: cycles.size,
    milestones: milestones.size + plansIn.reduce((n, p) => n + p.milestones.length, 0),
    estimates,
    relations: items.filter((i) => i.kind === 'relation').length,
    attachments: items.filter((i) => i.kind === 'attachment').length,
    triage,
    archived,
    priorities,
    sample: issues.slice(0, 5).map((i) => ({
      key: i.key ?? null,
      title: i.title,
      status: i.triage ? 'triage' : i.status.name || i.status.category,
      assignee: i.assignee ? personLabel(i.assignee) || null : null,
    })),
  };
}

// ---------- Escritura ----------

export interface TrackImportReport {
  [key: string]: unknown;
  issues: number;
  /** Ya importados que cambiaron en la fuente y se actualizaron. */
  updated: number;
  skipped: number;
  comments: number;
  projectsCreated: number;
  statusesCreated: number;
  cyclesCreated: number;
  milestonesCreated: number;
  plansCreated: number;
  planUpdates: number;
  relations: number;
  attachments: number;
  unassigned: number;
  parents: number;
  projects: Array<{ id: string; name: string }>;
  plans: Array<{ id: string; name: string }>;
}

export function emptyTrackReport(): TrackImportReport {
  return {
    issues: 0,
    updated: 0,
    skipped: 0,
    comments: 0,
    projectsCreated: 0,
    statusesCreated: 0,
    cyclesCreated: 0,
    milestonesCreated: 0,
    plansCreated: 0,
    planUpdates: 0,
    relations: 0,
    attachments: 0,
    unassigned: 0,
    parents: 0,
    projects: [],
    plans: [],
  };
}

/** Cachés de una tanda (proyectos, status, cycles, milestones y miembros). */
interface WriteCtx {
  job: ImportJob;
  ws: string;
  src: string;
  members: Member[];
  projects: Map<string, string>;
  statuses: Map<string, TrackStatusRow[]>;
  cycles: Map<string, string>;
  milestones: Map<string, string>;
  plans: Map<string, string>;
  report: TrackImportReport;
}

/**
 * Slug (prefijo de los identificadores) del proyecto nuevo: la clave de la
 * fuente si la trae (team de Linear: ENG), si no una clave corta del nombre
 * ("Gen Proj" → GP) con un número si ya está tomada (GP2), en vez del nombre
 * entero (GEN-PROJ-0IDT-12).
 */
async function slugFrom(key: string | null | undefined, name: string): Promise<string | undefined> {
  if (key) return projectSlug(key).slice(0, 20) || undefined;
  const base = shortProjectKey(name);
  if (!base) return undefined;
  for (let n = 1; n <= 20; n++) {
    const candidate = n === 1 ? base : `${base}${n}`;
    if (!(await getProjectBySlug(candidate))) return candidate;
  }
  return base;
}

function reportProject(ctx: WriteCtx, id: string, name: string) {
  if (!ctx.report.projects.some((p) => p.id === id)) ctx.report.projects.push({ id, name });
}

/** Team mapeado (o null). */
async function mappedProject(ctx: WriteCtx, extId: string): Promise<string | null> {
  const target = targetOf(ctx.job);
  if (target !== 'new') return target;
  const cached = ctx.projects.get(extId);
  if (cached) return cached;
  const mapped = await getExternalId(ctx.ws, ctx.src, 'project', extId);
  const row = mapped ? await getProject(mapped) : undefined;
  if (!row) return null;
  ctx.projects.set(extId, row.id);
  reportProject(ctx, row.id, row.name);
  return row.id;
}

async function ensureProject(ctx: WriteCtx, project: NormalizedIssue['project']): Promise<string> {
  const existing = await mappedProject(ctx, project.extId);
  if (existing) return existing;
  const created = await createProject(
    ctx.job.workspace_id,
    ctx.job.team_id,
    { name: project.name, slug: await slugFrom(project.key, project.name), description: project.description ?? undefined },
    { locale: ctx.job.locale },
  );
  await setExternalId(ctx.ws, ctx.src, 'project', project.extId, created.id);
  ctx.projects.set(project.extId, created.id);
  ctx.report.projectsCreated += 1;
  reportProject(ctx, created.id, created.name);
  return created.id;
}

/**
 * Team de Linear: el team con su clave y, si se crea ahora, con los workflow
 * states de Linear en su orden (reemplazan a los de por defecto que no usa).
 */
async function ensureTeam(ctx: WriteCtx, team: LinearTeamItem): Promise<void> {
  if (targetOf(ctx.job) !== 'new') return;
  const existed = await mappedProject(ctx, team.extId);
  const projectId = existed ?? (await ensureProject(ctx, { extId: team.extId, name: team.name, key: team.key || null, description: team.description || null }));
  const db = getDb();
  if (team.triageEnabled) await db.prepare('UPDATE track_projects SET triage_enabled = 1 WHERE id = ?').run(projectId);
  if (existed) return;

  if (team.color) await db.prepare('UPDATE track_projects SET color = ? WHERE id = ?').run(team.color, projectId);
  if (team.private) {
    await db.prepare("UPDATE track_projects SET visibility = 'private' WHERE id = ?").run(projectId);
    const emails = new Set(team.memberEmails);
    const ids = new Set([ctx.job.user_id, ...ctx.members.filter((m) => emails.has(m.email.toLowerCase())).map((m) => m.id)]);
    for (const uid of ids) {
      await db.prepare('INSERT OR IGNORE INTO track_project_access (project_id, user_id, added_by) VALUES (?, ?, ?)').run(projectId, uid, ctx.job.user_id);
    }
  }

  const states = team.states.filter((s) => !s.triage);
  if (!states.length) return;
  const current = await listStatuses(projectId);
  const used = new Set<string>();
  for (const [i, s] of states.entries()) {
    const found = current.find((c) => !used.has(c.id) && c.name.toLowerCase() === s.name.toLowerCase());
    if (found) {
      used.add(found.id);
      await db.prepare('UPDATE track_statuses SET name = ?, position = ?, category = ?, color = COALESCE(?, color) WHERE id = ?').run(s.name, i, s.category, s.color, found.id);
    } else {
      const created = await createStatus(projectId, { name: s.name, category: s.category, color: s.color ?? undefined });
      used.add(created.id);
      await db.prepare('UPDATE track_statuses SET position = ? WHERE id = ?').run(i, created.id);
      ctx.report.statusesCreated += 1;
    }
  }
  // Los de por defecto que Linear no tiene (el team recién creado no tiene issues).
  for (const c of current.filter((x) => !used.has(x.id))) {
    const inUse = await db.prepare('SELECT 1 FROM track_issues WHERE status_id = ? LIMIT 1').get(c.id);
    if (!inUse) await db.prepare('DELETE FROM track_statuses WHERE id = ?').run(c.id);
  }
  ctx.statuses.delete(projectId);
}

async function ensureStatus(ctx: WriteCtx, projectId: string, status: NormalizedIssue['status']): Promise<string | null> {
  let list = ctx.statuses.get(projectId);
  if (!list) {
    list = await listStatuses(projectId);
    ctx.statuses.set(projectId, list);
  }
  if (status.name) {
    const byName = list.find((s) => s.name.toLowerCase() === status.name!.toLowerCase());
    if (byName) return byName.id;
    const created = await createStatus(projectId, { name: status.name, category: status.category, color: status.color ?? undefined });
    list.push(created);
    ctx.report.statusesCreated += 1;
    return created.id;
  }
  return (list.find((s) => s.category === status.category) ?? list.find((s) => s.category === 'todo') ?? list[0])?.id ?? null;
}

async function ensureCycle(ctx: WriteCtx, projectId: string, cycle: NonNullable<NormalizedIssue['cycle']>): Promise<string> {
  const key = `${projectId}:${cycle.extId}`;
  const cached = ctx.cycles.get(key);
  if (cached) return cached;
  const mapped = await getExternalId(ctx.ws, ctx.src, 'cycle', key);
  const exists = mapped ? await getDb().prepare('SELECT id FROM track_cycles WHERE id = ?').get(mapped) : null;
  let id = exists ? (mapped as string) : '';
  if (!id) {
    const endAt = cycle.endAt < cycle.startAt ? cycle.startAt : cycle.endAt;
    id = (await createCycle(projectId, { name: cycle.name.slice(0, 200), startAt: cycle.startAt, endAt })).id;
    await setExternalId(ctx.ws, ctx.src, 'cycle', key, id);
    ctx.report.cyclesCreated += 1;
  }
  ctx.cycles.set(key, id);
  return id;
}

async function ensureMilestone(ctx: WriteCtx, projectId: string, m: NonNullable<NormalizedIssue['milestone']>): Promise<string> {
  const key = `${projectId}:${m.extId}`;
  const cached = ctx.milestones.get(key);
  if (cached) return cached;
  const mapped = await getExternalId(ctx.ws, ctx.src, 'milestone', key);
  const exists = mapped ? await getDb().prepare('SELECT id FROM track_milestones WHERE id = ?').get(mapped) : null;
  let id = exists ? (mapped as string) : '';
  if (!id) {
    id = crypto.randomUUID();
    const now = new Date().toISOString();
    await getDb()
      .prepare('INSERT INTO track_milestones (id, project_id, name, description, target_date, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)')
      .run(id, projectId, m.name.slice(0, 200), '', m.targetDate ?? null, now, now);
    await setExternalId(ctx.ws, ctx.src, 'milestone', key, id);
    ctx.report.milestonesCreated += 1;
  }
  ctx.milestones.set(key, id);
  return id;
}

// ---------- Projects de Linear (planes) ----------

function reportPlan(ctx: WriteCtx, id: string, name: string) {
  if (!ctx.report.plans.some((p) => p.id === id)) ctx.report.plans.push({ id, name });
}

/** Project mapeado por id externo o, si no, uno del workspace con el mismo nombre. */
async function findPlan(ctx: WriteCtx, extId: string, name: string): Promise<{ id: string; updated_at: string } | null> {
  const cached = ctx.plans.get(extId);
  const db = getDb();
  const mapped = cached ?? (await getExternalId(ctx.ws, ctx.src, 'plan', extId));
  if (mapped) {
    const row = (await db.prepare('SELECT id, updated_at FROM track_plans WHERE id = ?').get(mapped)) as { id: string; updated_at: string } | undefined;
    if (row) return row;
  }
  const scope = scopeOf(ctx.job);
  const byName = (await db
    .prepare(
      scope.teamId
        ? 'SELECT id, updated_at FROM track_plans WHERE team_id = ? AND lower(name) = lower(?) LIMIT 1'
        : 'SELECT id, updated_at FROM track_plans WHERE team_id IS NULL AND owner_id = ? AND lower(name) = lower(?) LIMIT 1',
    )
    .get(scope.teamId ?? scope.ownerId, name)) as { id: string; updated_at: string } | undefined;
  if (byName) await setExternalId(ctx.ws, ctx.src, 'plan', extId, byName.id);
  return byName ?? null;
}

async function teamIdsFor(ctx: WriteCtx, teamExtIds: string[]): Promise<string[]> {
  const out: string[] = [];
  for (const ext of teamExtIds) {
    const id = await mappedProject(ctx, ext);
    if (id && !out.includes(id)) out.push(id);
  }
  return out;
}

function memberIds(ctx: WriteCtx, people: Array<ImportPerson | null>): string[] {
  return [...new Set(people.map((p) => matchMember(ctx.members, p)?.id).filter((x): x is string => !!x))];
}

async function addPlanLinks(planId: string, teamIds: string[], userIds: string[]): Promise<void> {
  const db = getDb();
  for (const t of teamIds) await db.prepare('INSERT OR IGNORE INTO track_plan_teams (plan_id, project_id) VALUES (?, ?)').run(planId, t);
  for (const u of userIds) await db.prepare('INSERT OR IGNORE INTO track_plan_members (plan_id, user_id) VALUES (?, ?)').run(planId, u);
}

async function ensurePlan(ctx: WriteCtx, plan: LinearPlanItem): Promise<string> {
  const db = getDb();
  const teamIds = await teamIdsFor(ctx, plan.teamExtIds);
  const lead = matchMember(ctx.members, plan.lead);
  const members = memberIds(ctx, plan.members);
  const found = await findPlan(ctx, plan.extId, plan.name);
  let id: string;
  if (found) {
    id = found.id;
    if (plan.updatedAt && plan.updatedAt > found.updated_at) {
      await db
        .prepare(
          `UPDATE track_plans SET name = ?, summary = ?, description = ?, status = ?, priority = ?, lead_id = COALESCE(?, lead_id),
             start_date = ?, target_date = ?, updated_at = ?,
             completed_at = CASE WHEN ? = 'completed' THEN COALESCE(completed_at, ?) ELSE NULL END
           WHERE id = ?`,
        )
        .run(plan.name, plan.summary, plan.description, plan.status, plan.priority, lead?.id ?? null, plan.startDate, plan.targetDate, plan.updatedAt, plan.status, plan.updatedAt, id);
    }
    await addPlanLinks(id, teamIds, members);
  } else {
    const startDate = plan.startDate && plan.targetDate && plan.startDate > plan.targetDate ? plan.targetDate : plan.startDate;
    const res = await createPlan(scopeOf(ctx.job), ctx.job.user_id, {
      name: plan.name,
      summary: plan.summary,
      description: plan.description,
      status: plan.status,
      priority: plan.priority,
      leadId: lead?.id ?? null,
      startDate,
      targetDate: plan.targetDate,
      color: plan.color ?? undefined,
      teamIds,
      memberIds: members,
    });
    if (!res.ok) throw new Error(`plan: ${res.error}`);
    id = res.plan.id;
    const at = plan.createdAt ?? new Date().toISOString();
    await db.prepare('UPDATE track_plans SET created_at = ?, updated_at = ? WHERE id = ?').run(at, plan.updatedAt ?? at, id);
    await setExternalId(ctx.ws, ctx.src, 'plan', plan.extId, id);
    ctx.report.plansCreated += 1;
  }
  ctx.plans.set(plan.extId, id);
  reportPlan(ctx, id, plan.name);

  for (const m of plan.milestones) await ensurePlanMilestone(ctx, id, m.extId, m.name, m.targetDate, m.description);
  for (const u of plan.updates) {
    if (await getExternalId(ctx.ws, ctx.src, 'plan_update', u.extId)) continue;
    const author = matchMember(ctx.members, u.user);
    const original = (u.user?.name || u.user?.email || '').trim();
    const body = author || !original ? u.body : `**${original}**\n\n${u.body}`;
    const uid = crypto.randomUUID();
    const at = u.createdAt ?? new Date().toISOString();
    await db
      .prepare('INSERT INTO track_plan_updates (id, plan_id, user_id, health, body, created_at) VALUES (?, ?, ?, ?, ?, ?)')
      .run(uid, id, author?.id ?? ctx.job.user_id, u.health, body, at);
    await setExternalId(ctx.ws, ctx.src, 'plan_update', u.extId, uid);
    ctx.report.planUpdates += 1;
  }
  return id;
}

/** Project referido desde un issue (CSV: por nombre, sin item propio). */
async function ensurePlanRef(ctx: WriteCtx, ref: NonNullable<NormalizedIssue['plan']>, teamId: string): Promise<string | null> {
  const cached = ctx.plans.get(ref.extId);
  if (cached) {
    await addPlanLinks(cached, [teamId], []);
    return cached;
  }
  const found = await findPlan(ctx, ref.extId, ref.name);
  if (found) {
    ctx.plans.set(ref.extId, found.id);
    await addPlanLinks(found.id, [teamId], []);
    reportPlan(ctx, found.id, ref.name);
    return found.id;
  }
  if (!ref.name.trim()) return null;
  const res = await createPlan(scopeOf(ctx.job), ctx.job.user_id, { name: ref.name, teamIds: [teamId] });
  if (!res.ok) return null;
  await setExternalId(ctx.ws, ctx.src, 'plan', ref.extId, res.plan.id);
  ctx.plans.set(ref.extId, res.plan.id);
  ctx.report.plansCreated += 1;
  reportPlan(ctx, res.plan.id, ref.name);
  return res.plan.id;
}

async function ensurePlanMilestone(ctx: WriteCtx, planId: string, extId: string, name: string, targetDate?: string | null, description?: string): Promise<string> {
  const key = `plan:${extId}`;
  const cached = ctx.milestones.get(key);
  if (cached) return cached;
  const db = getDb();
  const mapped = await getExternalId(ctx.ws, ctx.src, 'plan_milestone', extId);
  let id = mapped && (await db.prepare('SELECT id FROM track_plan_milestones WHERE id = ?').get(mapped)) ? mapped : '';
  if (!id) {
    const byName = (await db.prepare('SELECT id FROM track_plan_milestones WHERE plan_id = ? AND lower(name) = lower(?)').get(planId, name)) as { id: string } | undefined;
    id = byName?.id ?? (await createPlanMilestone(planId, ctx.job.user_id, { name: name.slice(0, 200), description, targetDate: targetDate ?? null }));
    if (!byName) ctx.report.milestonesCreated += 1;
    await setExternalId(ctx.ws, ctx.src, 'plan_milestone', extId, id);
  } else if (targetDate !== undefined) {
    await db.prepare('UPDATE track_plan_milestones SET name = ?, target_date = ? WHERE id = ?').run(name.slice(0, 200), targetDate ?? null, id);
  }
  ctx.milestones.set(key, id);
  return id;
}

// ---------- Issues ----------

async function insertActivity(issueId: string, userId: string, type: 'created' | 'comment', meta: Record<string, unknown>, at: string): Promise<void> {
  await getDb()
    .prepare('INSERT INTO track_issue_activities (id, issue_id, user_id, type, meta, created_at) VALUES (?, ?, ?, ?, ?, ?)')
    .run(crypto.randomUUID(), issueId, userId, type, JSON.stringify(meta), at);
}

async function insertComment(ctx: WriteCtx, issueId: string, c: NormalizedComment): Promise<void> {
  const ext = `${issueId}:${c.extId}`;
  const author = matchMember(ctx.members, { email: c.authorEmail, name: c.authorName });
  const original = (c.authorName || c.authorEmail || '').trim();
  const body = (author || !original ? c.body : `**${original}**\n\n${c.body}`).slice(0, 5000);
  const db = getDb();
  const existing = await getExternalId(ctx.ws, ctx.src, 'comment', ext);
  if (existing) {
    // Editado en la fuente después de importarlo: se trae el texto nuevo.
    if (c.updatedAt) {
      await db
        .prepare('UPDATE track_issue_comments SET body = ?, updated_at = ? WHERE id = ? AND body != ? AND COALESCE(updated_at, created_at) < ?')
        .run(body, c.updatedAt, existing, body, c.updatedAt);
    }
    return;
  }
  const at = c.createdAt ?? new Date().toISOString();
  const parentId = c.parentExtId ? await getExternalId(ctx.ws, ctx.src, 'comment', `${issueId}:${c.parentExtId}`) : null;
  const id = crypto.randomUUID();
  await db
    .prepare('INSERT INTO track_issue_comments (id, issue_id, user_id, body, parent_id, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)')
    .run(id, issueId, author?.id ?? ctx.job.user_id, body, parentId, at, c.updatedAt && c.updatedAt !== c.createdAt ? c.updatedAt : null);
  await insertActivity(issueId, author?.id ?? ctx.job.user_id, 'comment', { commentId: id }, at);
  await setExternalId(ctx.ws, ctx.src, 'comment', ext, id);
  ctx.report.comments += 1;
}

async function existingIssue(ctx: WriteCtx, extId: string, sourceId?: string | null): Promise<string | null> {
  const db = getDb();
  for (const [kind, ext] of [['issue_uuid', sourceId], ['issue', extId]] as const) {
    if (!ext) continue;
    const mapped = await getExternalId(ctx.ws, ctx.src, kind, ext);
    if (mapped && (await db.prepare('SELECT id FROM track_issues WHERE id = ?').get(mapped))) return mapped;
  }
  return null;
}

/** Campos que salen de la fuente (los mismos al crear y al actualizar). */
async function issueFields(ctx: WriteCtx, issue: NormalizedIssue, projectId: string) {
  const labels = issue.labels.length ? await normalizeIssueLabels(ctx.ws, issue.labels.map((l) => ({ name: l.name, color: l.color ?? undefined }))) : [];
  const planId = issue.plan ? await ensurePlanRef(ctx, issue.plan, projectId) : null;
  return {
    statusId: await ensureStatus(ctx, projectId, statusFor(issue)),
    labels: JSON.stringify(labels),
    cycleId: issue.cycle ? await ensureCycle(ctx, projectId, issue.cycle) : null,
    milestoneId: issue.milestone ? await ensureMilestone(ctx, projectId, issue.milestone) : null,
    planId,
    planMilestoneId: planId && issue.planMilestone ? await ensurePlanMilestone(ctx, planId, issue.planMilestone.extId, issue.planMilestone.name) : null,
    assignee: matchMember(ctx.members, issue.assignee),
    description: issue.description ? JSON.stringify([{ type: 'text', text: issue.description }]) : '[]',
  };
}

/** ¿Algún issue (o alias) del workspace del team ya usa ese identificador? */
async function identifierTaken(projectId: string, identifier: string): Promise<boolean> {
  const row = await getDb()
    .prepare(
      `SELECT 1 FROM track_projects t JOIN track_projects p ON (p.team_id = t.team_id OR (t.team_id IS NULL AND p.team_id IS NULL AND p.owner_id = t.owner_id))
       WHERE t.id = ? AND (EXISTS (SELECT 1 FROM track_issues i WHERE i.project_id = p.id AND UPPER(i.identifier) = ?)
         OR EXISTS (SELECT 1 FROM track_issue_aliases a WHERE a.project_id = p.id AND UPPER(a.identifier) = ?))
       LIMIT 1`,
    )
    .get(projectId, identifier, identifier);
  return !!row;
}

async function sourceIdentifier(projectId: string, key: string | null | undefined): Promise<string | null> {
  const id = key?.trim().toUpperCase();
  const m = id ? /^([A-Z][A-Z0-9]*)-(\d+)$/.exec(id) : null;
  if (!m || Number(m[2]) < 1) return null;
  const team = (await getDb().prepare('SELECT slug FROM track_projects WHERE id = ?').get(projectId)) as { slug: string } | undefined;
  if (!team || team.slug.toUpperCase() !== m[1]) return null;
  return (await identifierTaken(projectId, id!)) ? null : `${m[1]}-${Number(m[2])}`;
}

async function upsertIssue(ctx: WriteCtx, issue: NormalizedIssue): Promise<void> {
  const db = getDb();
  const existing = await existingIssue(ctx, issue.extId, issue.sourceId);
  if (existing) {
    // Mismo issue con otro identificador (cambió de team en la fuente): se recuerdan los dos.
    await setExternalId(ctx.ws, ctx.src, 'issue', issue.extId, existing);
    const row = (await db.prepare('SELECT project_id, updated_at FROM track_issues WHERE id = ?').get(existing)) as { project_id: string; updated_at: string };
    if (issue.updatedAt && issue.updatedAt > row.updated_at) {
      const f = await issueFields(ctx, issue, row.project_id);
      await db
        .prepare(
          `UPDATE track_issues SET title = ?, description = ?, status_id = ?, priority = ?, assignee_id = ?, cycle_id = ?, estimate = ?,
             due_date = ?, labels = ?, milestone_id = COALESCE(?, milestone_id), plan_id = ?, plan_milestone_id = ?, archived_at = ?, triage = ?, updated_at = ?
           WHERE id = ?`,
        )
        .run(
          issue.title,
          f.description,
          f.statusId,
          issue.priority,
          f.assignee?.id ?? null,
          f.cycleId,
          issue.estimate ?? null,
          issue.dueDate ?? null,
          f.labels,
          f.milestoneId,
          f.planId,
          f.planMilestoneId,
          issue.archivedAt ?? null,
          issue.triage ? 1 : 0,
          issue.updatedAt,
          existing,
        );
      ctx.report.updated += 1;
    } else {
      ctx.report.skipped += 1;
      // Sin responsable porque la persona no era miembro: si ya se sumó, se asigna ahora.
      const assignee = matchMember(ctx.members, issue.assignee);
      if (assignee) await db.prepare('UPDATE track_issues SET assignee_id = ? WHERE id = ? AND assignee_id IS NULL').run(assignee.id, existing);
    }
    for (const c of issue.comments) await insertComment(ctx, existing, c);
    return;
  }

  const projectId = await ensureProject(ctx, issue.project);
  const f = await issueFields(ctx, issue, projectId);
  if (issue.assignee && !f.assignee) ctx.report.unassigned += 1;
  const creator = matchMember(ctx.members, issue.creator);
  const createdAt = issue.createdAt ?? new Date().toISOString();
  const updatedAt = issue.updatedAt && issue.updatedAt > createdAt ? issue.updatedAt : createdAt;
  const id = crypto.randomUUID();

  // El identificador de la fuente (ENG-457) si el team tiene esa clave y está libre:
  // branches, PRs y links viejos siguen apuntando al mismo issue. Los nuevos siguen después.
  let identifier = (await sourceIdentifier(projectId, issue.key)) ?? (await nextIdentifier(projectId));
  for (let attempt = 0; ; attempt++) {
    try {
      await db
        .prepare(
          `INSERT INTO track_issues (id, project_id, identifier, title, description, status_id, priority, assignee_id, creator_id, cycle_id, estimate,
             due_date, labels, source, triage, milestone_id, plan_id, plan_milestone_id, archived_at, created_at, updated_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'import', ?, ?, ?, ?, ?, ?, ?)`,
        )
        .run(
          id,
          projectId,
          identifier,
          issue.title,
          f.description,
          f.statusId,
          issue.priority,
          f.assignee?.id ?? null,
          creator?.id ?? ctx.job.user_id,
          f.cycleId,
          issue.estimate ?? null,
          issue.dueDate ?? null,
          f.labels,
          issue.triage ? 1 : 0,
          f.milestoneId,
          f.planId,
          f.planMilestoneId,
          issue.archivedAt ?? null,
          createdAt,
          updatedAt,
        );
      break;
    } catch (err) {
      const msg = err instanceof Error ? err.message : '';
      if (attempt >= 5 || !msg.includes('UNIQUE')) throw err;
      identifier = await nextIdentifier(projectId);
    }
  }
  // Sin el mismo identificador (otra clave o número tomado): el de la fuente queda como alias y sigue resolviendo.
  const key = issue.key?.trim().toUpperCase();
  if (key && /^[A-Z][A-Z0-9]*-\d+$/.test(key) && key !== identifier.toUpperCase() && !(await identifierTaken(projectId, key))) {
    await db.prepare('INSERT OR IGNORE INTO track_issue_aliases (project_id, identifier, issue_id, created_at) VALUES (?, ?, ?, ?)').run(projectId, key, id, createdAt);
  }
  await insertActivity(id, creator?.id ?? ctx.job.user_id, 'created', { source: 'import', from: ctx.src, key: issue.key ?? null }, createdAt);
  await setExternalId(ctx.ws, ctx.src, 'issue', issue.extId, id);
  if (issue.sourceId) await setExternalId(ctx.ws, ctx.src, 'issue_uuid', issue.sourceId, id);
  ctx.report.issues += 1;
  for (const c of issue.comments) await insertComment(ctx, id, c);
}

const GITHUB_PR_RE = /^https:\/\/github\.com\/([A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+)\/pull\/(\d+)/;

async function insertAttachment(ctx: WriteCtx, a: LinearAttachmentItem): Promise<void> {
  if (await getExternalId(ctx.ws, ctx.src, 'attachment', a.extId)) return;
  const issueId = await existingIssue(ctx, a.issueExtId);
  if (!issueId) return;
  const db = getDb();
  const pr = GITHUB_PR_RE.exec(a.url);
  if (pr) {
    const state = /merged/i.test(a.subtitle) ? 'merged' : /closed/i.test(a.subtitle) ? 'closed' : 'open';
    // closes = 0: un PR importado no mueve el issue (ya está en el estado que traía de Linear).
    await db
      .prepare(
        `INSERT OR IGNORE INTO track_issue_links (id, issue_id, kind, repo, ref, url, title, state, closes, created_at, updated_at)
         VALUES (?, ?, 'pr', ?, ?, ?, ?, ?, 0, datetime('now'), datetime('now'))`,
      )
      .run(crypto.randomUUID(), issueId, pr[1].toLowerCase(), pr[2], a.url, a.title.slice(0, 300), state);
  } else {
    const figma = /^https:\/\/(www\.)?figma\.com\//i.test(a.url);
    await upsertExternalRef({
      issueId,
      workspaceId: ctx.ws,
      provider: figma ? 'figma' : 'link',
      externalId: `linear:${a.extId}`,
      url: a.url,
      title: [a.title, a.subtitle].filter(Boolean).join(' · ') || a.url,
      meta: { source: 'linear', sourceType: a.sourceType },
    });
  }
  await setExternalId(ctx.ws, ctx.src, 'attachment', a.extId, issueId);
  ctx.report.attachments += 1;
}

async function insertRelation(ctx: WriteCtx, r: LinearRelationItem): Promise<void> {
  if (await getExternalId(ctx.ws, ctx.src, 'relation', r.extId)) return;
  const [from, to] = await Promise.all([existingIssue(ctx, r.issueExtId), existingIssue(ctx, r.relatedExtId)]);
  if (!from || !to || from === to) return;
  const db = getDb();
  const reverse = await db.prepare('SELECT 1 FROM track_issue_relations WHERE issue_id = ? AND related_issue_id = ?').get(to, from);
  if (!reverse) {
    const res = await db
      .prepare('INSERT OR IGNORE INTO track_issue_relations (id, issue_id, related_issue_id, type, created_at) VALUES (?, ?, ?, ?, ?)')
      .run(crypto.randomUUID(), from, to, r.type, new Date().toISOString());
    if (res.changes) ctx.report.relations += 1;
  }
  await setExternalId(ctx.ws, ctx.src, 'relation', r.extId, from);
}

async function insertCycleItem(ctx: WriteCtx, c: LinearCycleItem): Promise<void> {
  const projectId = await mappedProject(ctx, c.teamExtId);
  if (projectId) await ensureCycle(ctx, projectId, c);
}

export const TRACK_WRITE_STAGES = ['issues', 'parents'] as const;

/**
 * Una tanda de una etapa: 'issues' crea (en el orden de lectura) teams,
 * projects, cycles, issues, comentarios, adjuntos y relaciones; 'parents'
 * engancha cada sub-issue con su padre (el padre puede venir después en la
 * fuente, por eso va en una pasada aparte).
 */
export async function trackWriteStep(job: ImportJob, stage: string, items: StagedItem[], report: TrackImportReport): Promise<void> {
  // Reportes de jobs viejos (antes de projects, relaciones y adjuntos).
  for (const [k, v] of Object.entries(emptyTrackReport())) if (report[k] === undefined) report[k] = v;
  const ctx: WriteCtx = {
    job,
    ws: trackImportWorkspace(job),
    src: externalSource(job.source),
    members: await listMembers(job),
    projects: new Map(),
    statuses: new Map(),
    cycles: new Map(),
    milestones: new Map(),
    plans: new Map(),
    report,
  };
  if (stage === 'issues') {
    for (const item of items) {
      switch (item.kind) {
        case 'team':
          await ensureTeam(ctx, item.data as unknown as LinearTeamItem);
          break;
        case 'plan':
          await ensurePlan(ctx, item.data as unknown as LinearPlanItem);
          break;
        case 'cycle':
          await insertCycleItem(ctx, item.data as unknown as LinearCycleItem);
          break;
        case 'issue':
          await upsertIssue(ctx, item.data as unknown as NormalizedIssue);
          break;
        case 'comment': {
          const { issueExtId, comment } = item.data as unknown as { issueExtId: string; comment: NormalizedComment };
          const issueId = await existingIssue(ctx, issueExtId);
          if (issueId) await insertComment(ctx, issueId, comment);
          break;
        }
        case 'attachment':
          await insertAttachment(ctx, item.data as unknown as LinearAttachmentItem);
          break;
        case 'relation':
          await insertRelation(ctx, item.data as unknown as LinearRelationItem);
          break;
        default:
          break;
      }
    }
    return;
  }
  if (stage === 'parents') {
    const withParent = items.filter((i) => i.kind === 'issue' && (i.data as unknown as NormalizedIssue).parentExtId);
    for (const item of withParent) {
      const issue = item.data as unknown as NormalizedIssue;
      const [child, parent] = await Promise.all([existingIssue(ctx, issue.extId, issue.sourceId), existingIssue(ctx, issue.parentExtId!)]);
      if (!child || !parent || child === parent) continue;
      const res = await getDb()
        .prepare('UPDATE track_issues SET parent_id = ? WHERE id = ? AND (parent_id IS NULL OR parent_id != ?)')
        .run(parent, child, parent);
      if (res.changes) report.parents += 1;
    }
  }
}
