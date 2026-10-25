/**
 * Track — operaciones de la API pública (/api/v1/track/*) y del servidor MCP.
 * Las dos superficies llaman a lo mismo: la key actúa como la persona que la
 * creó (ve lo que ella ve: privados e invitados incluidos) y todo lo que
 * escribe pasa por lib/track-data, así que deja actividad, avisos, webhooks y
 * audit log como desde la app.
 *
 * Alcance: los proyectos del dueño de la key (su workspace personal, si la
 * persona es el dueño, y los teams que tiene donde la persona es miembro).
 */
import { z } from 'zod';
import type { ApiKeyAuth } from './api-auth';
import { getDb, type TrackProjectRow } from './db';
import { runAsTrackViewer, trackVisibleSql, type TrackVia } from './track-access';
import { textToDescription, toApiComment, toApiCycle, toApiIssue, toApiProject, toApiStatus } from './track-api';
import { validateIssueRefs } from './track-bulk';
import {
  createCycle,
  createIssue,
  createIssueComment,
  createProject,
  deleteIssue,
  getIssue,
  issueSelect,
  listCycles,
  listIssueComments,
  listProjectMembers,
  listStatuses,
  updateIssue,
  updateProject,
  type TrackIssueWithStatus,
} from './track-data';
import { createLabel, listLabels, projectWorkspaceId } from './track-labels';
import { issueOrderBy, issueSearchClause, ISSUE_SORTS } from './track-views';
import { linkSupportUrls } from './track-support';
import { TRACK_MARKDOWN_MAX } from './track-markdown';

export class TrackApiError extends Error {
  constructor(
    public status: number,
    public code: string,
    message: string,
  ) {
    super(message);
  }
}

export interface TrackApiCtx {
  auth: ApiKeyAuth;
  via: TrackVia;
}

function run<T>(ctx: TrackApiCtx, fn: () => Promise<T>): Promise<T> {
  return runAsTrackViewer(ctx.auth.personId, fn, ctx.via);
}

// ---------- Alcance ----------

/** Condición SQL de los proyectos que ve la key (alias `p`). */
function scopeSql(ctx: TrackApiCtx): { sql: string; args: string[] } {
  const owner = ctx.auth.user.id;
  const person = ctx.auth.personId;
  const v = trackVisibleSql('p', person);
  return {
    sql: `p.owner_id = ? AND (
      (p.team_id IS NULL AND ? = ?)
      OR (p.team_id IS NOT NULL
          AND EXISTS (SELECT 1 FROM team_members m WHERE m.team_id = p.team_id AND m.user_id = ?)
          AND ${v.sql}))`,
    args: [owner, person, owner, person, ...v.args],
  };
}

async function accessibleProject(ctx: TrackApiCtx, projectId: string): Promise<TrackProjectRow> {
  const scope = scopeSql(ctx);
  const row = (await getDb()
    .prepare(`SELECT p.* FROM track_projects p WHERE (p.id = ? OR lower(p.slug) = lower(?)) AND ${scope.sql} LIMIT 1`)
    .get(projectId, projectId, ...scope.args)) as TrackProjectRow | undefined;
  if (!row) throw new TrackApiError(404, 'not_found', 'Project not found.');
  return row;
}

/** Issue por id o por identificador (ZER-12), si la key lo ve. */
async function accessibleIssue(ctx: TrackApiCtx, ref: string): Promise<{ issue: TrackIssueWithStatus; project: TrackProjectRow }> {
  let issue = await getIssue(ref);
  if (!issue && /^[A-Za-z0-9-]+-\d+$/.test(ref)) {
    const scope = scopeSql(ctx);
    const row = (await getDb()
      .prepare(
        `SELECT i.id FROM track_issues i JOIN track_projects p ON p.id = i.project_id
         WHERE i.identifier = ? AND ${scope.sql} LIMIT 2`,
      )
      .all(ref.toUpperCase(), ...scope.args)) as Array<{ id: string }>;
    if (row.length === 1) issue = await getIssue(row[0].id);
  }
  if (!issue) throw new TrackApiError(404, 'not_found', 'Issue not found.');
  const project = await accessibleProject(ctx, issue.project_id).catch(() => null);
  if (!project) throw new TrackApiError(404, 'not_found', 'Issue not found.');
  return { issue, project };
}

function writable(project: TrackProjectRow): void {
  if (project.status === 'archived') throw new TrackApiError(409, 'project_archived', 'The project is archived.');
}

// ---------- Schemas ----------

const idStr = z.string().trim().min(1).max(64);
const dateStr = z.string().trim().regex(/^\d{4}-\d{2}-\d{2}$/, 'Use YYYY-MM-DD.');
const priority = z.enum(['none', 'urgent', 'high', 'medium', 'low']);

export const apiIssueCreateSchema = z.object({
  projectId: idStr,
  title: z.string().trim().min(1).max(500),
  description: z.string().max(20_000).optional(),
  statusId: idStr.nullish(),
  /** Nombre del status (alternativa a statusId), sin distinguir mayúsculas. */
  status: z.string().trim().max(100).optional(),
  priority: priority.optional(),
  assigneeId: idStr.nullish(),
  assigneeEmail: z.string().trim().email().max(200).optional(),
  cycleId: idStr.nullish(),
  milestoneId: idStr.nullish(),
  parentId: idStr.nullish(),
  estimate: z.number().int().min(0).max(1000).nullish(),
  startDate: dateStr.nullish(),
  dueDate: dateStr.nullish(),
  /** Nombres de labels (se crean si no existen). */
  labels: z.array(z.string().trim().min(1).max(50)).max(10).optional(),
  /** Links de Sentry, Zendesk, Intercom o Figma que quedan vinculados al issue. */
  links: z.array(z.string().trim().url().max(2000)).max(10).optional(),
});

export const apiIssueUpdateSchema = apiIssueCreateSchema
  .omit({ projectId: true, links: true })
  .partial()
  .extend({ title: z.string().trim().min(1).max(500).optional() });

export const apiIssueListSchema = z.object({
  projectId: idStr.optional(),
  statusId: idStr.optional(),
  statusCategory: z.enum(['backlog', 'todo', 'in_progress', 'done', 'cancelled']).optional(),
  assigneeId: idStr.optional(),
  priority: priority.optional(),
  cycleId: idStr.optional(),
  labelId: idStr.optional(),
  q: z.string().trim().max(200).optional(),
  triage: z.enum(['true', 'false']).optional(),
  updatedSince: z.string().trim().max(40).optional(),
  sort: z.enum(ISSUE_SORTS).optional(),
  page: z.coerce.number().int().min(1).max(10_000).optional(),
  pageSize: z.coerce.number().int().min(1).max(100).optional(),
});

export const apiCommentSchema = z.object({ body: z.string().trim().min(1).max(TRACK_MARKDOWN_MAX) });

export const apiProjectCreateSchema = z.object({
  name: z.string().trim().min(1).max(200),
  key: z
    .string()
    .trim()
    .min(1)
    .max(20)
    .regex(/^[A-Za-z0-9]+(?:-[A-Za-z0-9]+)*$/, 'Letters, digits and dashes.')
    .optional(),
  description: z.string().trim().max(TRACK_MARKDOWN_MAX).optional(),
  color: z.string().regex(/^#(?:[0-9a-f]{3}|[0-9a-f]{6})$/i).optional(),
  icon: z.string().trim().max(16).optional(),
  /** Team (id) donde crearlo; sin team va al workspace personal del dueño. */
  teamId: idStr.optional(),
});

export const apiProjectUpdateSchema = z.object({
  name: z.string().trim().min(1).max(200).optional(),
  description: z.string().trim().max(TRACK_MARKDOWN_MAX).optional(),
  color: z.string().regex(/^#(?:[0-9a-f]{3}|[0-9a-f]{6})$/i).optional(),
  icon: z.string().trim().max(16).nullish(),
  status: z.enum(['active', 'archived']).optional(),
  triageEnabled: z.boolean().optional(),
});

export const apiCycleCreateSchema = z.object({
  name: z.string().trim().min(1).max(200),
  startAt: dateStr,
  endAt: dateStr,
});

export function parseOrThrow<T extends z.ZodTypeAny>(schema: T, input: unknown): z.infer<T> {
  const parsed = schema.safeParse(input);
  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    const where = issue?.path.join('.') || 'body';
    throw new TrackApiError(400, 'invalid_input', `${where}: ${issue?.message ?? 'invalid'}`);
  }
  return parsed.data;
}

// ---------- Resolución de referencias ----------

async function resolveRefs(
  project: TrackProjectRow,
  input: {
    statusId?: string | null;
    status?: string;
    assigneeId?: string | null;
    assigneeEmail?: string;
    labels?: string[];
    cycleId?: string | null;
    milestoneId?: string | null;
    parentId?: string | null;
  },
  issueId?: string,
): Promise<{ statusId?: string | null; assigneeId?: string | null; labels?: Array<{ name: string }> }> {
  const out: { statusId?: string | null; assigneeId?: string | null; labels?: Array<{ name: string }> } = {};
  if (input.statusId !== undefined) out.statusId = input.statusId;
  if (input.status) {
    const s = (await listStatuses(project.id)).find((x) => x.name.toLowerCase() === input.status!.toLowerCase() || x.category === input.status);
    if (!s) throw new TrackApiError(400, 'invalid_status', `No status named "${input.status}" in this project.`);
    out.statusId = s.id;
  }
  if (input.assigneeId !== undefined) out.assigneeId = input.assigneeId;
  if (input.assigneeEmail) {
    const m = (await listProjectMembers(project.id, project.owner_id ?? '')).find((x) => x.email.toLowerCase() === input.assigneeEmail!.toLowerCase());
    if (!m) throw new TrackApiError(400, 'invalid_assignee', 'The assignee is not a member of this project.');
    out.assigneeId = m.id;
  }
  if (input.labels) out.labels = input.labels.map((name) => ({ name }));
  const invalid = await validateIssueRefs(
    project,
    { statusId: out.statusId, cycleId: input.cycleId, assigneeId: out.assigneeId, parentId: input.parentId, milestoneId: input.milestoneId },
    { ownerId: project.owner_id ?? '', issueId },
  );
  if (invalid) throw new TrackApiError(400, invalid, `Invalid reference: ${invalid.replace('invalid_', '')}.`);
  return out;
}

// ---------- Issues ----------

export async function apiListIssues(ctx: TrackApiCtx, query: z.infer<typeof apiIssueListSchema>) {
  return run(ctx, async () => {
    const scope = scopeSql(ctx);
    const where = [`i.project_id IN (SELECT p.id FROM track_projects p WHERE ${scope.sql})`];
    const args: Array<string | number> = [...scope.args];
    if (query.projectId) {
      const project = await accessibleProject(ctx, query.projectId);
      where.push('i.project_id = ?');
      args.push(project.id);
    }
    if (query.statusId) {
      where.push('i.status_id = ?');
      args.push(query.statusId);
    }
    if (query.statusCategory) {
      where.push('s.category = ?');
      args.push(query.statusCategory);
    }
    if (query.assigneeId) {
      where.push('i.assignee_id = ?');
      args.push(query.assigneeId);
    }
    if (query.priority) {
      where.push('i.priority = ?');
      args.push(query.priority);
    }
    if (query.cycleId) {
      where.push('i.cycle_id = ?');
      args.push(query.cycleId);
    }
    if (query.labelId) {
      where.push("i.labels LIKE ? ESCAPE '\\'");
      args.push(`%"id":"${query.labelId.replace(/[%_\\"]/g, '')}"%`);
    }
    if (query.triage) {
      where.push('i.triage = ?');
      args.push(query.triage === 'true' ? 1 : 0);
    }
    if (query.updatedSince) {
      where.push('i.updated_at >= ?');
      args.push(query.updatedSince);
    }
    const search = issueSearchClause(query.q);
    if (search) {
      where.push(search.sql);
      args.push(...search.args);
    }
    const pageSize = query.pageSize ?? 50;
    const page = query.page ?? 1;
    const whereSql = where.join(' AND ');
    const db = getDb();
    const total = (
      (await db
        .prepare(`SELECT COUNT(*) AS c FROM track_issues i LEFT JOIN track_statuses s ON s.id = i.status_id WHERE ${whereSql}`)
        .get(...args)) as { c: number }
    ).c;
    const rows = (await db
      .prepare(`${issueSelect(`WHERE ${whereSql}`)} ORDER BY ${issueOrderBy(query.sort ?? 'updated')} LIMIT ? OFFSET ?`)
      .all(...args, pageSize, (page - 1) * pageSize)) as TrackIssueWithStatus[];
    return { data: rows.map(toApiIssue), page, pageSize, total, hasMore: page * pageSize < total };
  });
}

export async function apiGetIssue(ctx: TrackApiCtx, ref: string) {
  return run(ctx, async () => toApiIssue((await accessibleIssue(ctx, ref)).issue));
}

export async function apiCreateIssue(ctx: TrackApiCtx, input: z.infer<typeof apiIssueCreateSchema>) {
  return run(ctx, async () => {
    const project = await accessibleProject(ctx, input.projectId);
    writable(project);
    const refs = await resolveRefs(project, input);
    const issue = await createIssue(
      project.id,
      ctx.auth.personId,
      {
        title: input.title,
        description: input.description ? textToDescription(input.description) : undefined,
        statusId: refs.statusId ?? undefined,
        priority: input.priority,
        assigneeId: refs.assigneeId ?? undefined,
        cycleId: input.cycleId ?? undefined,
        milestoneId: input.milestoneId ?? undefined,
        parentId: input.parentId ?? undefined,
        estimate: input.estimate ?? undefined,
        startDate: input.startDate ?? undefined,
        dueDate: input.dueDate ?? undefined,
        labels: refs.labels,
      },
      { source: ctx.via === 'mcp' ? 'mcp' : 'api' },
    );
    if (input.links?.length) {
      const ws = projectWorkspaceId(project);
      if (ws) await linkSupportUrls(issue.id, ws, input.links);
    }
    return toApiIssue(issue);
  });
}

export async function apiUpdateIssue(ctx: TrackApiCtx, ref: string, input: z.infer<typeof apiIssueUpdateSchema>) {
  return run(ctx, async () => {
    const { issue, project } = await accessibleIssue(ctx, ref);
    writable(project);
    const refs = await resolveRefs(project, input, issue.id);
    const payload: Record<string, unknown> = {};
    if (input.title !== undefined) payload.title = input.title;
    if (input.description !== undefined) payload.description = textToDescription(input.description);
    if (refs.statusId !== undefined) payload.statusId = refs.statusId;
    if (input.priority !== undefined) payload.priority = input.priority;
    if (refs.assigneeId !== undefined) payload.assigneeId = refs.assigneeId;
    for (const k of ['cycleId', 'milestoneId', 'parentId', 'estimate', 'startDate', 'dueDate'] as const) {
      if (input[k] !== undefined) payload[k] = input[k];
    }
    if (refs.labels !== undefined) payload.labels = refs.labels;
    if (Object.keys(payload).length === 0) return toApiIssue(issue);
    // Cambiar status o asignado acepta el issue de triage, como en la app.
    if (issue.triage === 1 && (payload.statusId !== undefined || payload.assigneeId !== undefined)) {
      const { claimTriage } = await import('./track-bulk');
      await claimTriage(issue.id).catch(() => false);
    }
    const updated = await updateIssue(issue.id, payload, ctx.auth.personId);
    if (!updated) throw new TrackApiError(404, 'not_found', 'Issue not found.');
    return toApiIssue(updated);
  });
}

export async function apiDeleteIssue(ctx: TrackApiCtx, ref: string) {
  return run(ctx, async () => {
    const { issue, project } = await accessibleIssue(ctx, ref);
    writable(project);
    await deleteIssue(issue.id);
    return { id: issue.id, deleted: true };
  });
}

// ---------- Comentarios ----------

export async function apiListComments(ctx: TrackApiCtx, ref: string) {
  return run(ctx, async () => {
    const { issue } = await accessibleIssue(ctx, ref);
    return { data: (await listIssueComments(issue.id)).map(toApiComment) };
  });
}

export async function apiAddComment(ctx: TrackApiCtx, ref: string, input: z.infer<typeof apiCommentSchema>) {
  return run(ctx, async () => {
    const { issue, project } = await accessibleIssue(ctx, ref);
    writable(project);
    return toApiComment(await createIssueComment(issue.id, ctx.auth.personId, { body: input.body }));
  });
}

// ---------- Proyectos, status, cycles, labels, personas ----------

export async function apiListProjects(ctx: TrackApiCtx, opts: { includeArchived?: boolean } = {}) {
  return run(ctx, async () => {
    const scope = scopeSql(ctx);
    const rows = (await getDb()
      .prepare(
        `SELECT p.* FROM track_projects p WHERE ${scope.sql} ${opts.includeArchived ? '' : "AND p.status = 'active'"} ORDER BY p.name LIMIT 500`,
      )
      .all(...scope.args)) as TrackProjectRow[];
    return { data: rows.map(toApiProject) };
  });
}

export async function apiGetProject(ctx: TrackApiCtx, id: string) {
  return run(ctx, async () => {
    const project = await accessibleProject(ctx, id);
    return { ...toApiProject(project), statuses: (await listStatuses(project.id)).map(toApiStatus) };
  });
}

export async function apiCreateProject(ctx: TrackApiCtx, input: z.infer<typeof apiProjectCreateSchema>) {
  return run(ctx, async () => {
    if (ctx.auth.role === 'member') throw new TrackApiError(403, 'forbidden', 'Only workspace admins can create projects.');
    let teamId: string | null = null;
    if (input.teamId) {
      const team = (await getDb().prepare('SELECT id FROM teams WHERE id = ? AND owner_id = ?').get(input.teamId, ctx.auth.user.id)) as
        | { id: string }
        | undefined;
      if (!team) throw new TrackApiError(404, 'not_found', 'Team not found.');
      teamId = team.id;
    } else if (ctx.auth.personId !== ctx.auth.user.id) {
      // Una key de un miembro crea en el team del dueño donde está (el primero).
      const team = (await getDb()
        .prepare('SELECT t.id FROM teams t JOIN team_members m ON m.team_id = t.id WHERE t.owner_id = ? AND m.user_id = ? ORDER BY t.created_at LIMIT 1')
        .get(ctx.auth.user.id, ctx.auth.personId)) as { id: string } | undefined;
      if (!team) throw new TrackApiError(403, 'forbidden', 'No team for this key.');
      teamId = team.id;
    }
    const project = await createProject(ctx.auth.user.id, teamId, {
      name: input.name,
      slug: input.key?.toLowerCase(),
      description: input.description,
      color: input.color,
      icon: input.icon,
    });
    return toApiProject(project);
  });
}

export async function apiUpdateProject(ctx: TrackApiCtx, id: string, input: z.infer<typeof apiProjectUpdateSchema>) {
  return run(ctx, async () => {
    const project = await accessibleProject(ctx, id);
    if ((input.status !== undefined || input.triageEnabled !== undefined) && ctx.auth.role === 'member') {
      throw new TrackApiError(403, 'forbidden', 'Only workspace admins can archive projects or change triage.');
    }
    const updated = await updateProject(project.id, {
      name: input.name,
      description: input.description,
      color: input.color,
      icon: input.icon === null ? undefined : input.icon,
      status: input.status,
      triageEnabled: input.triageEnabled,
    });
    return toApiProject(updated ?? project);
  });
}

export async function apiListStatuses(ctx: TrackApiCtx, projectId: string) {
  return run(ctx, async () => {
    const project = await accessibleProject(ctx, projectId);
    return { data: (await listStatuses(project.id)).map(toApiStatus) };
  });
}

export async function apiListCycles(ctx: TrackApiCtx, projectId: string) {
  return run(ctx, async () => {
    const project = await accessibleProject(ctx, projectId);
    return { data: (await listCycles(project.id)).map(toApiCycle) };
  });
}

export async function apiCreateCycle(ctx: TrackApiCtx, projectId: string, input: z.infer<typeof apiCycleCreateSchema>) {
  return run(ctx, async () => {
    const project = await accessibleProject(ctx, projectId);
    writable(project);
    if (input.endAt < input.startAt) throw new TrackApiError(400, 'invalid_input', 'endAt must be after startAt.');
    return toApiCycle(await createCycle(project.id, { name: input.name, startAt: input.startAt, endAt: input.endAt }));
  });
}

async function workspaceIds(ctx: TrackApiCtx): Promise<string[]> {
  const scope = scopeSql(ctx);
  const rows = (await getDb()
    .prepare(`SELECT DISTINCT COALESCE(p.team_id, p.owner_id) AS ws FROM track_projects p WHERE ${scope.sql}`)
    .all(...scope.args)) as Array<{ ws: string }>;
  const ids = rows.map((r) => r.ws);
  if (ctx.auth.personId === ctx.auth.user.id && !ids.includes(ctx.auth.user.id)) ids.push(ctx.auth.user.id);
  return ids;
}

export async function apiListLabels(ctx: TrackApiCtx) {
  return run(ctx, async () => {
    const out: Array<{ id: string; name: string; color: string; workspaceId: string }> = [];
    for (const ws of await workspaceIds(ctx)) {
      for (const l of await listLabels(ws)) out.push({ id: l.id, name: l.name, color: l.color, workspaceId: ws });
    }
    return { data: out };
  });
}

export async function apiCreateLabel(ctx: TrackApiCtx, input: { name: string; color?: string; projectId: string }) {
  return run(ctx, async () => {
    const project = await accessibleProject(ctx, input.projectId);
    const ws = projectWorkspaceId(project);
    if (!ws) throw new TrackApiError(404, 'not_found', 'Project not found.');
    const res = await createLabel(ws, { name: input.name, color: input.color });
    if (!res.ok) throw new TrackApiError(409, 'duplicate', 'A label with that name already exists.');
    return { id: res.label.id, name: res.label.name, color: res.label.color, workspaceId: ws };
  });
}

export async function apiListUsers(ctx: TrackApiCtx, projectId?: string) {
  return run(ctx, async () => {
    if (projectId) {
      const project = await accessibleProject(ctx, projectId);
      return { data: (await listProjectMembers(project.id, project.owner_id ?? '')).map((m) => ({ id: m.id, name: m.name, email: m.email, role: m.role })) };
    }
    const seen = new Map<string, { id: string; name: string | null; email: string; role: string }>();
    const scope = scopeSql(ctx);
    const projects = (await getDb()
      .prepare(`SELECT p.* FROM track_projects p WHERE ${scope.sql} AND p.status = 'active' LIMIT 50`)
      .all(...scope.args)) as TrackProjectRow[];
    for (const p of projects) {
      for (const m of await listProjectMembers(p.id, p.owner_id ?? '')) if (!seen.has(m.id)) seen.set(m.id, { id: m.id, name: m.name, email: m.email, role: m.role });
    }
    return { data: [...seen.values()] };
  });
}

// ---------- Respuesta HTTP ----------

export function apiErrorResponse(err: unknown): Response {
  if (err instanceof TrackApiError) {
    return Response.json({ error: { code: err.code, message: err.message } }, { status: err.status });
  }
  // eslint-disable-next-line no-console
  console.error('[track-api]', err);
  return Response.json({ error: { code: 'internal', message: 'Unexpected error.' } }, { status: 500 });
}

