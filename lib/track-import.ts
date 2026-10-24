/**
 * Track — import: vista previa y escritura de los issues normalizados
 * (lib/track-import-map.ts) que dejó la etapa de lectura en import_job_items.
 *
 * - Proyectos: el elegido, o uno nuevo por proyecto de la fuente (team de
 *   Linear, proyecto de Jira, repo de GitHub, columna del CSV).
 * - Status: por nombre dentro del proyecto; si no existe se crea con su
 *   categoría. Sin nombre (GitHub) va al primero de la categoría.
 * - Personas: por email (o nombre) contra los miembros del workspace; quien no
 *   está queda sin responsable y aparece en la vista previa.
 * - Labels del workspace, cycles y milestones del proyecto se crean una vez.
 * - Comentarios con su fecha; si el autor no es miembro, lo firma quien importa
 *   con el nombre original arriba.
 * - Ids externos en import_external_ids: reimportar saltea lo que ya está y
 *   suma solo los comentarios nuevos.
 * Inserta directo (sin notificaciones ni webhooks: es una mudanza, no
 * actividad nueva).
 */
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
import type { NormalizedComment, NormalizedIssue, TrackImportSource } from './track-import-map';

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
  if (source === 'jira_csv') return 'jira';
  if (source === 'github') return 'github';
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
  return (await db.prepare('SELECT id, email, name FROM users WHERE id = ?').all(job.workspace_id)) as Member[];
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

// ---------- Vista previa ----------

export interface TrackImportPreview {
  [key: string]: unknown;
  issues: number;
  comments: number;
  alreadyImported: number;
  projects: Array<{ name: string; issues: number; existing: string | null }>;
  statuses: Array<{ name: string; category: string; issues: number; existing: boolean }>;
  people: Array<{ label: string; issues: number; member: string | null }>;
  labels: { total: number; existing: number };
  cycles: number;
  milestones: number;
  estimates: number;
  priorities: Record<string, number>;
  sample: Array<{ key: string | null; title: string; status: string; assignee: string | null }>;
}

export async function trackPreview(job: ImportJob, items: StagedItem[]): Promise<TrackImportPreview> {
  const ws = trackImportWorkspace(job);
  const src = externalSource(job.source);
  const issues = items.filter((i) => i.kind === 'issue').map((i) => i.data as unknown as NormalizedIssue);
  const members = await listMembers(job);
  const target = targetOf(job);
  const targetProject = target !== 'new' ? await getProject(target) : undefined;

  const already = await getExternalIds(ws, src, 'issue', issues.map((i) => i.extId));
  const mappedProjects = await getExternalIds(ws, src, 'project', [...new Set(issues.map((i) => i.project.extId))]);

  const projects = new Map<string, { name: string; issues: number; existing: string | null }>();
  const statuses = new Map<string, { name: string; category: string; issues: number; existing: boolean }>();
  const people = new Map<string, { label: string; issues: number; member: string | null }>();
  const labelNames = new Set<string>();
  const cycles = new Set<string>();
  const milestones = new Set<string>();
  const priorities: Record<string, number> = { urgent: 0, high: 0, medium: 0, low: 0 };
  let comments = items.filter((i) => i.kind === 'comment').length;
  let estimates = 0;

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

  for (const issue of issues) {
    const projKey = targetProject ? targetProject.id : issue.project.extId;
    const proj = projects.get(projKey) ?? {
      name: targetProject ? targetProject.name : issue.project.name,
      issues: 0,
      existing: targetProject ? targetProject.name : (projectNames.get(mappedProjects.get(issue.project.extId) ?? '') ?? null),
    };
    proj.issues += 1;
    projects.set(projKey, proj);

    if (issue.status.name) {
      const key = issue.status.name.toLowerCase();
      const s = statuses.get(key) ?? { name: issue.status.name, category: issue.status.category, issues: 0, existing: existingStatusNames.has(key) };
      s.issues += 1;
      statuses.set(key, s);
    } else {
      const key = `:${issue.status.category}`;
      const s = statuses.get(key) ?? { name: '', category: issue.status.category, issues: 0, existing: true };
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
    for (const l of issue.labels) labelNames.add(l.name.toLowerCase());
    if (issue.cycle) cycles.add(`${projKey}|${issue.cycle.extId}`);
    if (issue.milestone) milestones.add(`${projKey}|${issue.milestone.extId}`);
    if (issue.estimate != null) estimates += 1;
    priorities[issue.priority] = (priorities[issue.priority] ?? 0) + 1;
    comments += issue.comments.length;
  }

  const existingLabels = new Set((await listLabels(ws)).map((l) => l.name.toLowerCase()));

  return {
    issues: issues.length,
    comments,
    alreadyImported: already.size,
    projects: [...projects.values()],
    statuses: [...statuses.values()].sort((a, b) => b.issues - a.issues),
    people: [...people.values()].sort((a, b) => Number(!!a.member) - Number(!!b.member) || b.issues - a.issues).slice(0, 100),
    labels: { total: labelNames.size, existing: [...labelNames].filter((n) => existingLabels.has(n)).length },
    cycles: cycles.size,
    milestones: milestones.size,
    estimates,
    priorities,
    sample: issues.slice(0, 5).map((i) => ({
      key: i.key ?? null,
      title: i.title,
      status: i.status.name || i.status.category,
      assignee: i.assignee ? personLabel(i.assignee) || null : null,
    })),
  };
}

// ---------- Escritura ----------

export interface TrackImportReport {
  [key: string]: unknown;
  issues: number;
  skipped: number;
  comments: number;
  projectsCreated: number;
  statusesCreated: number;
  cyclesCreated: number;
  milestonesCreated: number;
  unassigned: number;
  parents: number;
  projects: Array<{ id: string; name: string }>;
}

export function emptyTrackReport(): TrackImportReport {
  return { issues: 0, skipped: 0, comments: 0, projectsCreated: 0, statusesCreated: 0, cyclesCreated: 0, milestonesCreated: 0, unassigned: 0, parents: 0, projects: [] };
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

async function ensureProject(ctx: WriteCtx, project: NormalizedIssue['project']): Promise<string> {
  const target = targetOf(ctx.job);
  if (target !== 'new') return target;
  const cached = ctx.projects.get(project.extId);
  if (cached) return cached;
  const mapped = await getExternalId(ctx.ws, ctx.src, 'project', project.extId);
  if (mapped && (await getProject(mapped))) {
    ctx.projects.set(project.extId, mapped);
    if (!ctx.report.projects.some((p) => p.id === mapped)) ctx.report.projects.push({ id: mapped, name: (await getProject(mapped))!.name });
    return mapped;
  }
  const created = await createProject(
    ctx.job.workspace_id,
    ctx.job.team_id,
    { name: project.name, slug: await slugFrom(project.key, project.name), description: project.description ?? undefined },
    { locale: ctx.job.locale },
  );
  await setExternalId(ctx.ws, ctx.src, 'project', project.extId, created.id);
  ctx.projects.set(project.extId, created.id);
  ctx.report.projectsCreated += 1;
  ctx.report.projects.push({ id: created.id, name: created.name });
  return created.id;
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

async function insertActivity(issueId: string, userId: string, type: 'created' | 'comment', meta: Record<string, unknown>, at: string): Promise<void> {
  await getDb()
    .prepare('INSERT INTO track_issue_activities (id, issue_id, user_id, type, meta, created_at) VALUES (?, ?, ?, ?, ?, ?)')
    .run(crypto.randomUUID(), issueId, userId, type, JSON.stringify(meta), at);
}

async function insertComment(ctx: WriteCtx, issueId: string, c: NormalizedComment): Promise<void> {
  const ext = `${issueId}:${c.extId}`;
  if (await getExternalId(ctx.ws, ctx.src, 'comment', ext)) return;
  const author = matchMember(ctx.members, { email: c.authorEmail, name: c.authorName });
  const original = (c.authorName || c.authorEmail || '').trim();
  const body = author || !original ? c.body : `**${original}**\n\n${c.body}`;
  const at = c.createdAt ?? new Date().toISOString();
  const id = crypto.randomUUID();
  await getDb()
    .prepare('INSERT INTO track_issue_comments (id, issue_id, user_id, body, created_at) VALUES (?, ?, ?, ?, ?)')
    .run(id, issueId, author?.id ?? ctx.job.user_id, body.slice(0, 5000), at);
  await insertActivity(issueId, author?.id ?? ctx.job.user_id, 'comment', { commentId: id }, at);
  await setExternalId(ctx.ws, ctx.src, 'comment', ext, id);
  ctx.report.comments += 1;
}

async function existingIssue(ctx: WriteCtx, extId: string): Promise<string | null> {
  const mapped = await getExternalId(ctx.ws, ctx.src, 'issue', extId);
  if (!mapped) return null;
  const row = await getDb().prepare('SELECT id FROM track_issues WHERE id = ?').get(mapped);
  return row ? mapped : null;
}

async function insertIssue(ctx: WriteCtx, issue: NormalizedIssue): Promise<void> {
  const existing = await existingIssue(ctx, issue.extId);
  if (existing) {
    ctx.report.skipped += 1;
    for (const c of issue.comments) await insertComment(ctx, existing, c);
    return;
  }
  const projectId = await ensureProject(ctx, issue.project);
  const statusId = await ensureStatus(ctx, projectId, issue.status);
  const labels = issue.labels.length ? await normalizeIssueLabels(ctx.ws, issue.labels.map((l) => ({ name: l.name, color: l.color ?? undefined }))) : [];
  const cycleId = issue.cycle ? await ensureCycle(ctx, projectId, issue.cycle) : null;
  const milestoneId = issue.milestone ? await ensureMilestone(ctx, projectId, issue.milestone) : null;
  const assignee = matchMember(ctx.members, issue.assignee);
  if (issue.assignee && !assignee) ctx.report.unassigned += 1;
  const createdAt = issue.createdAt ?? new Date().toISOString();
  const description = issue.description ? JSON.stringify([{ type: 'text', text: issue.description }]) : '[]';
  const id = crypto.randomUUID();

  let identifier = await nextIdentifier(projectId);
  for (let attempt = 0; ; attempt++) {
    try {
      await getDb()
        .prepare(
          `INSERT INTO track_issues (id, project_id, identifier, title, description, status_id, priority, assignee_id, creator_id, cycle_id, estimate,
             due_date, labels, source, triage, milestone_id, created_at, updated_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'import', 0, ?, ?, ?)`,
        )
        .run(
          id,
          projectId,
          identifier,
          issue.title,
          description,
          statusId,
          issue.priority,
          assignee?.id ?? null,
          ctx.job.user_id,
          cycleId,
          issue.estimate ?? null,
          issue.dueDate ?? null,
          JSON.stringify(labels),
          milestoneId,
          createdAt,
          createdAt,
        );
      break;
    } catch (err) {
      const msg = err instanceof Error ? err.message : '';
      if (attempt >= 5 || !msg.includes('UNIQUE')) throw err;
      identifier = await nextIdentifier(projectId);
    }
  }
  await insertActivity(id, ctx.job.user_id, 'created', { source: 'import', from: ctx.src, key: issue.key ?? null }, createdAt);
  await setExternalId(ctx.ws, ctx.src, 'issue', issue.extId, id);
  ctx.report.issues += 1;
  for (const c of issue.comments) await insertComment(ctx, id, c);
}

export const TRACK_WRITE_STAGES = ['issues', 'parents'] as const;

/**
 * Una tanda de una etapa: 'issues' crea issues y comentarios; 'parents'
 * engancha cada sub-issue con su padre (el padre puede venir después en la
 * fuente, por eso va en una pasada aparte).
 */
export async function trackWriteStep(job: ImportJob, stage: string, items: StagedItem[], report: TrackImportReport): Promise<void> {
  const ctx: WriteCtx = {
    job,
    ws: trackImportWorkspace(job),
    src: externalSource(job.source),
    members: await listMembers(job),
    projects: new Map(),
    statuses: new Map(),
    cycles: new Map(),
    milestones: new Map(),
    report,
  };
  if (stage === 'issues') {
    for (const item of items) {
      if (item.kind === 'issue') {
        await insertIssue(ctx, item.data as unknown as NormalizedIssue);
      } else if (item.kind === 'comment') {
        const { issueExtId, comment } = item.data as unknown as { issueExtId: string; comment: NormalizedComment };
        const issueId = await existingIssue(ctx, issueExtId);
        if (issueId) await insertComment(ctx, issueId, comment);
      }
    }
    return;
  }
  if (stage === 'parents') {
    const withParent = items.filter((i) => i.kind === 'issue' && (i.data as unknown as NormalizedIssue).parentExtId);
    for (const item of withParent) {
      const issue = item.data as unknown as NormalizedIssue;
      const [child, parent] = await Promise.all([existingIssue(ctx, issue.extId), existingIssue(ctx, issue.parentExtId!)]);
      if (!child || !parent || child === parent) continue;
      const res = await getDb().prepare('UPDATE track_issues SET parent_id = ? WHERE id = ? AND parent_id IS NULL').run(parent, child);
      if (res.changes) report.parents += 1;
    }
  }
}
