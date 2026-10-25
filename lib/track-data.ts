/**
 * Track — lógica de negocio para proyectos, status, cycles e issues.
 *
 * Nota: el módulo `lib/track.ts` ya existe para el tracking de clicks de
 * links, por lo que este feature vive en `lib/track-data.ts`.
 */
import { after } from 'next/server';
import { getDb, getClient, txDb, getUserById } from './db';
import { emitEvent } from './events';
import { deleteUploads } from './uploads';
import type {
  TrackCycleRow,
  TrackIssueActivityRow,
  TrackIssueAttachmentRow,
  TrackIssueCommentRow,
  TrackIssueRelationRow,
  TrackIssueRow,
  TrackIssueViewRow,
  TrackProjectRow,
  TrackStatusRow,
  UserRow,
} from './db';
import {
  createIssueAssignedNotification,
  createIssueCommentNotifications,
  createIssueStatusChangedNotifications,
  createIssueUpdatedNotifications,
} from './notifications';
import { autoSubscribe, listIssueSubscriberIds } from './track-subscriptions';
import type {
  CommentCreatePayload,
  CommentUpdatePayload,
  CycleCreatePayload,
  CycleUpdatePayload,
  IssueCreatePayload,
  IssueUpdatePayload,
  IssueViewCreatePayload,
  IssueViewUpdatePayload,
  ProjectCreatePayload,
  ProjectUpdatePayload,
  StatusCreatePayload,
  StatusUpdatePayload,
  StatusesReorderPayload,
} from './track-schema';
import { safeHexColor } from './track-color';
import { normalizeIssueLabels, projectWorkspaceId } from './track-labels';
import { issueOrderBy, issueSearchClause, labelIdLike, type IssueSort } from './track-views';
import { defaultIssueStatus } from './track-tasks';

// ---------- Tipos públicos ----------

export interface TrackIssueWithStatus extends TrackIssueRow {
  status_name: string | null;
  status_color: string | null;
  status_category: TrackStatusRow['category'] | null;
  assignee_name: string | null;
  assignee_email: string | null;
  cycle_name: string | null;
  child_count: number;
  milestone_name?: string | null;
}

export interface TrackProjectWithStats extends TrackProjectRow {
  open_issues: number;
}

export interface TrackCommentWithAuthor extends TrackIssueCommentRow {
  user_name: string | null;
  user_email: string;
}

export interface TrackIssueAttachmentWithAuthor extends TrackIssueAttachmentRow {
  user_name: string | null;
  user_email: string;
}

export interface TrackIssueActivityWithAuthor extends TrackIssueActivityRow {
  user_name: string | null;
  user_email: string;
}

export interface TrackIssueRelationWithTarget extends TrackIssueRelationRow {
  identifier: string;
  title: string;
  direction: 'outgoing' | 'incoming';
}

export interface IssueParentSummary {
  id: string;
  identifier: string;
  title: string;
}

export interface ListIssuesResult {
  rows: TrackIssueWithStatus[];
  total: number;
  page: number;
  pageSize: number;
}

export interface ListProjectsOptions {
  page?: number;
  pageSize?: number;
}

export interface ListIssuesOptions {
  statusId?: string | string[];
  priority?: string | string[];
  assigneeId?: string | string[];
  cycleId?: string | string[];
  labelIds?: string | string[];
  q?: string;
  dueAfter?: string;
  dueBefore?: string;
  sort?: IssueSort;
  page?: number;
  pageSize?: number;
}

export interface ListAllIssuesOptions extends ListIssuesOptions {
  projectId?: string;
}

// ---------- Saved views ----------

export interface TrackIssueView {
  id: string;
  project_id: string;
  user_id: string;
  name: string;
  view_type: 'list' | 'board' | 'calendar' | 'gantt';
  filters: Record<string, unknown>;
  sort: IssueSort;
  columns: string[] | null;
  is_default: boolean;
  created_at: string;
  updated_at: string;
}

// ---------- Helpers ----------

function nowIso(): string {
  return new Date().toISOString();
}

function slugify(input: string): string {
  return input
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 64);
}

function blocksToJson(value: unknown): string {
  if (value == null) return '[]';
  if (typeof value === 'string') return value;
  return JSON.stringify(value);
}

function toArray<T>(value: T | T[] | undefined): T[] | undefined {
  if (value === undefined) return undefined;
  if (Array.isArray(value)) return value.length ? value : undefined;
  return value ? [value] : undefined;
}

function inClause(count: number): string {
  return `(${Array.from({ length: count }, () => '?').join(', ')})`;
}

export async function nextIdentifier(projectId: string): Promise<string> {
  const db = getDb();
  const project = (await db
    .prepare('SELECT slug, team_id, owner_id FROM track_projects WHERE id = ?')
    .get(projectId)) as { slug: string; team_id: string | null; owner_id: string } | undefined;
  const prefix = (project?.slug ?? 'project').toUpperCase();
  const workspaceId = project?.team_id ?? project?.owner_id ?? '';

  // El número sigue al máximo del prefijo en todo el workspace, no solo en el
  // proyecto: si un slug se liberó (rename) y otro proyecto lo reusa, sus
  // issues no repiten identificadores (GitHub y la búsqueda por identifier
  // actúan a nivel workspace). El workspace se filtra sin COALESCE y el prefijo
  // con un rango ('PREF-' <= x < 'PREF.'), para que sirvan los índices.
  const row = (await db
    .prepare(
      `SELECT COALESCE(MAX(CAST(SUBSTR(i.identifier, ?) AS INTEGER)), 0) AS n
       FROM track_projects p
       JOIN track_issues i ON i.project_id = p.id
       WHERE (p.team_id = ? OR (p.team_id IS NULL AND p.owner_id = ?))
         AND i.identifier >= ? AND i.identifier < ?
         AND SUBSTR(i.identifier, ?) NOT GLOB '*[^0-9]*'`,
    )
    .get(prefix.length + 2, workspaceId, workspaceId, `${prefix}-`, `${prefix}.`, prefix.length + 2)) as
    | { n: number }
    | undefined;

  return `${prefix}-${(row?.n ?? 0) + 1}`;
}

// ---------- Projects ----------

/**
 * Un proyecto es visible si pertenece al team activo, o si es personal
 * (sin team) y su dueño es el usuario. `ownerId` es el id efectivo del
 * workspace (SessionUser.id).
 */
export function canAccessTrackProject(
  project: Pick<TrackProjectRow, 'team_id' | 'owner_id'>,
  teamId: string | null,
  ownerId: string,
): boolean {
  if (teamId) return project.team_id === teamId;
  return project.team_id === null && project.owner_id === ownerId;
}

function projectScope(teamId: string | null, ownerId: string): { where: string; arg: string } {
  return teamId
    ? { where: 'team_id = ?', arg: teamId }
    : { where: '(team_id IS NULL AND owner_id = ?)', arg: ownerId };
}

/** Slug único globalmente: si está tomado, agrega un sufijo corto. */
async function uniqueProjectSlug(base: string, excludeId?: string): Promise<string> {
  const db = getDb();
  const root = base || 'project';
  for (let i = 0; i < 20; i++) {
    const candidate =
      i === 0 ? root : `${root.slice(0, 57)}-${Math.random().toString(36).slice(2, 6)}`;
    const taken = (await db
      .prepare('SELECT id FROM track_projects WHERE slug = ?')
      .get(candidate)) as { id: string } | undefined;
    if (!taken || taken.id === excludeId) return candidate;
  }
  return `${root.slice(0, 50)}-${crypto.randomUUID().slice(0, 12)}`;
}

export async function listProjects(
  teamId: string | null,
  userId: string,
  options: ListProjectsOptions = {},
): Promise<{ rows: TrackProjectWithStats[]; total: number; page: number; pageSize: number }> {
  const db = getDb();
  const pageSize = Math.min(Math.max(options.pageSize ?? 50, 1), 100);
  const page = Math.max(options.page ?? 1, 1);

  const scope = projectScope(teamId, userId);
  const where = scope.where;
  const args: Array<string | number> = [scope.arg];

  const total = (
    (await db.prepare(`SELECT COUNT(*) AS c FROM track_projects WHERE ${where}`).get(...args)) as {
      c: number;
    }
  ).c;

  const rows = (await db
    .prepare(
      `SELECT p.*,
        (SELECT COUNT(*) FROM track_issues i WHERE i.project_id = p.id AND i.triage = 0 AND i.status_id IN (
          SELECT s.id FROM track_statuses s WHERE s.project_id = p.id AND s.category IN ('backlog','todo','in_progress')
        )) AS open_issues
       FROM track_projects p
       WHERE ${where}
       ORDER BY p.status ASC, p.name ASC
       LIMIT ? OFFSET ?`,
    )
    .all(...args, pageSize, (page - 1) * pageSize)) as TrackProjectWithStats[];

  return { rows, total, page, pageSize };
}

export interface TrackProjectOverview {
  id: string;
  name: string;
  icon: string | null;
  open_issues: number;
  overdue: number;
  triage: number;
  cycle_id: string | null;
  cycle_name: string | null;
  cycle_end: string | null;
  cycle_total: number;
  cycle_done: number;
}

/**
 * Resumen de Track: por proyecto activo, el ciclo en curso con su avance,
 * los issues vencidos (abiertos, fuera de triage) y los que esperan triage.
 */
export async function listProjectOverview(
  teamId: string | null,
  userId: string,
  today: string,
): Promise<TrackProjectOverview[]> {
  const scope = projectScope(teamId, userId);
  const open = `SELECT s.id FROM track_statuses s WHERE s.project_id = p.id AND s.category IN ('backlog','todo','in_progress')`;
  const rows = (await getDb()
    .prepare(
      `SELECT p.id, p.name, p.icon,
        (SELECT COUNT(*) FROM track_issues i WHERE i.project_id = p.id AND i.triage = 0 AND i.status_id IN (${open})) AS open_issues,
        (SELECT COUNT(*) FROM track_issues i WHERE i.project_id = p.id AND i.triage = 0 AND i.due_date IS NOT NULL
           AND substr(i.due_date, 1, 10) < ? AND i.status_id IN (${open})) AS overdue,
        (SELECT COUNT(*) FROM track_issues i WHERE i.project_id = p.id AND i.triage = 1) AS triage,
        c.id AS cycle_id, c.name AS cycle_name, c.end_at AS cycle_end,
        (SELECT COUNT(*) FROM track_issues i WHERE c.id IS NOT NULL AND i.cycle_id = c.id) AS cycle_total,
        (SELECT COUNT(*) FROM track_issues i JOIN track_statuses s ON s.id = i.status_id
           WHERE c.id IS NOT NULL AND i.cycle_id = c.id AND s.category IN ('done', 'cancelled')) AS cycle_done
       FROM track_projects p
       LEFT JOIN track_cycles c ON c.id = (
         SELECT c2.id FROM track_cycles c2
         WHERE c2.project_id = p.id AND substr(c2.start_at, 1, 10) <= ? AND substr(c2.end_at, 1, 10) >= ?
         ORDER BY c2.start_at DESC LIMIT 1
       )
       WHERE ${scope.where} AND p.status = 'active'
       ORDER BY p.name ASC
       LIMIT 100`,
    )
    .all(today, today, today, scope.arg)) as TrackProjectOverview[];
  return rows;
}

export async function getProject(id: string): Promise<TrackProjectRow | undefined> {
  return (await getDb().prepare('SELECT * FROM track_projects WHERE id = ?').get(id)) as
    | TrackProjectRow
    | undefined;
}

export async function getProjectBySlug(slug: string): Promise<TrackProjectRow | undefined> {
  return (await getDb().prepare('SELECT * FROM track_projects WHERE slug = ?').get(slug)) as
    | TrackProjectRow
    | undefined;
}

/**
 * Nombres de los estados con los que nace un proyecto, en el idioma de quien
 * lo crea. Después son datos del proyecto: se renombran como cualquier otro.
 */
export const DEFAULT_STATUS_NAMES: Record<'en' | 'es' | 'pt', Record<TrackStatusRow['category'], string>> = {
  en: { backlog: 'Backlog', todo: 'Todo', in_progress: 'In progress', done: 'Done', cancelled: 'Cancelled' },
  es: { backlog: 'Backlog', todo: 'Por hacer', in_progress: 'En progreso', done: 'Hecho', cancelled: 'Cancelado' },
  pt: { backlog: 'Backlog', todo: 'A fazer', in_progress: 'Em andamento', done: 'Feito', cancelled: 'Cancelado' },
};

export async function createProject(
  userId: string,
  teamId: string | null,
  payload: ProjectCreatePayload,
  opts: { locale?: string } = {},
): Promise<TrackProjectRow> {
  const db = getDb();
  const id = crypto.randomUUID();
  const slug = await uniqueProjectSlug(payload.slug ?? slugify(payload.name));
  const now = nowIso();

  await db
    .prepare(
      'INSERT INTO track_projects (id, team_id, owner_id, name, slug, description, icon, color, status, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
    )
    .run(
      id,
      teamId,
      userId,
      payload.name.trim(),
      slug,
      payload.description?.trim() ?? '',
      payload.icon?.trim() ?? null,
      safeHexColor(payload.color, '#000000'),
      'active',
      now,
      now,
    );

  // Crear estados por defecto
  const names = DEFAULT_STATUS_NAMES[(opts.locale ?? 'en') as keyof typeof DEFAULT_STATUS_NAMES] ?? DEFAULT_STATUS_NAMES.en;
  const defaults: Array<{ name: string; category: TrackStatusRow['category']; color: string }> = [
    { name: names.backlog, category: 'backlog', color: '#666666' },
    { name: names.todo, category: 'todo', color: '#000000' },
    { name: names.in_progress, category: 'in_progress', color: '#000000' },
    { name: names.done, category: 'done', color: '#000000' },
    { name: names.cancelled, category: 'cancelled', color: '#999999' },
  ];

  for (let i = 0; i < defaults.length; i++) {
    const s = defaults[i];
    await db
      .prepare(
        'INSERT INTO track_statuses (id, project_id, name, color, position, category) VALUES (?, ?, ?, ?, ?, ?)',
      )
      .run(crypto.randomUUID(), id, s.name, s.color, i, s.category);
  }

  return (await db.prepare('SELECT * FROM track_projects WHERE id = ?').get(id)) as TrackProjectRow;
}

export async function updateProject(
  id: string,
  payload: ProjectUpdatePayload,
): Promise<TrackProjectRow | undefined> {
  const db = getDb();
  const existing = await getProject(id);
  if (!existing) return undefined;

  const fields: string[] = [];
  const args: Array<string | number | null> = [];

  if (payload.name !== undefined) {
    fields.push('name = ?');
    args.push(payload.name.trim());
  }
  if (payload.slug !== undefined) {
    fields.push('slug = ?');
    args.push(await uniqueProjectSlug(payload.slug, id));
  }
  if (payload.description !== undefined) {
    fields.push('description = ?');
    args.push(payload.description.trim());
  }
  if (payload.icon !== undefined) {
    fields.push('icon = ?');
    args.push(payload.icon?.trim() ?? null);
  }
  if (payload.color !== undefined) {
    fields.push('color = ?');
    args.push(safeHexColor(payload.color, '#000000'));
  }
  if (payload.status !== undefined) {
    fields.push('status = ?');
    args.push(payload.status);
  }
  if (payload.triageEnabled !== undefined) {
    fields.push('triage_enabled = ?');
    args.push(payload.triageEnabled ? 1 : 0);
  }
  if (payload.cycleAuto !== undefined) {
    fields.push('cycle_auto = ?');
    args.push(payload.cycleAuto ? 1 : 0);
    // Que el próximo tick vuelva a revisar los cycles.
    fields.push('cycle_auto_day = NULL');
  }
  if (payload.cycleWeeks !== undefined) {
    fields.push('cycle_weeks = ?');
    args.push(payload.cycleWeeks);
  }
  if (payload.cycleName !== undefined) {
    fields.push('cycle_name = ?');
    args.push(payload.cycleName.trim());
  }

  if (fields.length > 0) {
    fields.push('updated_at = ?');
    args.push(nowIso());
    args.push(id);
    await db.prepare(`UPDATE track_projects SET ${fields.join(', ')} WHERE id = ?`).run(...args);
  }

  return getProject(id);
}

export async function deleteProject(id: string): Promise<boolean> {
  const db = getDb();
  const files = (await db
    .prepare(
      'SELECT a.url FROM track_issue_attachments a JOIN track_issues i ON i.id = a.issue_id WHERE i.project_id = ?',
    )
    .all(id)) as Array<{ url: string }>;
  const res = await db.prepare('DELETE FROM track_projects WHERE id = ?').run(id);
  if (res.changes > 0) await deleteUploads(files.map((f) => f.url));
  return res.changes > 0;
}

// ---------- Statuses ----------

export async function listStatuses(projectId: string): Promise<TrackStatusRow[]> {
  return (await getDb()
    .prepare('SELECT * FROM track_statuses WHERE project_id = ? ORDER BY position ASC')
    .all(projectId)) as TrackStatusRow[];
}

export async function getStatus(id: string): Promise<TrackStatusRow | undefined> {
  return (await getDb().prepare('SELECT * FROM track_statuses WHERE id = ?').get(id)) as
    | TrackStatusRow
    | undefined;
}

export async function createStatus(
  projectId: string,
  payload: StatusCreatePayload,
): Promise<TrackStatusRow> {
  const db = getDb();
  const id = crypto.randomUUID();

  const max = (await db
    .prepare('SELECT COALESCE(MAX(position), 0) AS p FROM track_statuses WHERE project_id = ?')
    .get(projectId)) as { p: number };

  await db
    .prepare(
      'INSERT INTO track_statuses (id, project_id, name, color, position, category) VALUES (?, ?, ?, ?, ?, ?)',
    )
    .run(
      id,
      projectId,
      payload.name.trim(),
      safeHexColor(payload.color, '#666666'),
      payload.position ?? max.p + 1,
      payload.category ?? 'todo',
    );

  return (await db.prepare('SELECT * FROM track_statuses WHERE id = ?').get(id)) as TrackStatusRow;
}

export async function updateStatus(
  id: string,
  payload: StatusUpdatePayload,
): Promise<TrackStatusRow | undefined> {
  const db = getDb();
  const existing = await getStatus(id);
  if (!existing) return undefined;

  const fields: string[] = [];
  const args: Array<string | number | null> = [];

  if (payload.name !== undefined) {
    fields.push('name = ?');
    args.push(payload.name.trim());
  }
  if (payload.color !== undefined) {
    fields.push('color = ?');
    args.push(safeHexColor(payload.color, '#666666'));
  }
  if (payload.position !== undefined) {
    fields.push('position = ?');
    args.push(payload.position);
  }
  if (payload.category !== undefined) {
    fields.push('category = ?');
    args.push(payload.category);
  }

  if (fields.length > 0) {
    args.push(id);
    await db.prepare(`UPDATE track_statuses SET ${fields.join(', ')} WHERE id = ?`).run(...args);
  }

  return getStatus(id);
}

export async function reorderStatuses(
  projectId: string,
  payload: StatusesReorderPayload,
): Promise<TrackStatusRow[]> {
  const db = getDb();
  const client = getClient();
  const tx = await client.transaction();
  const tdb = txDb(tx);

  try {
    for (let i = 0; i < payload.statusIds.length; i++) {
      await tdb
        .prepare(
          'UPDATE track_statuses SET position = ? WHERE id = ? AND project_id = ?',
        )
        .run(i, payload.statusIds[i], projectId);
    }
    await tx.commit();
  } catch (e) {
    await tx.rollback();
    throw e;
  }

  return listStatuses(projectId);
}

export async function deleteStatus(id: string): Promise<boolean> {
  const res = await getDb().prepare('DELETE FROM track_statuses WHERE id = ?').run(id);
  return res.changes > 0;
}

export type DeleteStatusResult =
  | { ok: true; reassigned: number }
  | { ok: false; reason: 'not_found' | 'invalid_target' | 'last_status' };

/**
 * Borra un status reasignando sus issues a otro status del mismo proyecto
 * (sin esto quedarían con status NULL por el ON DELETE SET NULL).
 */
export async function deleteStatusWithReassign(id: string, reassignTo: string): Promise<DeleteStatusResult> {
  const status = await getStatus(id);
  if (!status) return { ok: false, reason: 'not_found' };
  const target = await getStatus(reassignTo);
  if (!target || target.id === id || target.project_id !== status.project_id) {
    return { ok: false, reason: 'invalid_target' };
  }
  const tx = await getClient().transaction();
  const tdb = txDb(tx);
  try {
    const moved = await tdb
      .prepare("UPDATE track_issues SET status_id = ?, updated_at = datetime('now') WHERE status_id = ? AND project_id = ?")
      .run(target.id, id, status.project_id);
    await tdb.prepare('DELETE FROM track_statuses WHERE id = ?').run(id);
    await tx.commit();
    return { ok: true, reassigned: moved.changes };
  } catch (e) {
    await tx.rollback();
    throw e;
  }
}

// ---------- Cycles ----------

export async function listCycles(projectId: string): Promise<TrackCycleRow[]> {
  return (await getDb()
    .prepare('SELECT * FROM track_cycles WHERE project_id = ? ORDER BY start_at DESC')
    .all(projectId)) as TrackCycleRow[];
}

export async function getCycle(id: string): Promise<TrackCycleRow | undefined> {
  return (await getDb().prepare('SELECT * FROM track_cycles WHERE id = ?').get(id)) as
    | TrackCycleRow
    | undefined;
}

export async function createCycle(
  projectId: string,
  payload: CycleCreatePayload,
): Promise<TrackCycleRow> {
  const db = getDb();
  const id = crypto.randomUUID();
  await db
    .prepare(
      'INSERT INTO track_cycles (id, project_id, name, start_at, end_at) VALUES (?, ?, ?, ?, ?)',
    )
    .run(id, projectId, payload.name.trim(), payload.startAt, payload.endAt);
  return (await db.prepare('SELECT * FROM track_cycles WHERE id = ?').get(id)) as TrackCycleRow;
}

export async function updateCycle(
  id: string,
  payload: CycleUpdatePayload,
): Promise<TrackCycleRow | undefined> {
  const db = getDb();
  const existing = await getCycle(id);
  if (!existing) return undefined;

  const fields: string[] = [];
  const args: Array<string | number | null> = [];

  if (payload.name !== undefined) {
    fields.push('name = ?');
    args.push(payload.name.trim());
  }
  if (payload.startAt !== undefined) {
    fields.push('start_at = ?');
    args.push(payload.startAt);
  }
  if (payload.endAt !== undefined) {
    fields.push('end_at = ?');
    args.push(payload.endAt);
  }

  if (fields.length > 0) {
    args.push(id);
    await db.prepare(`UPDATE track_cycles SET ${fields.join(', ')} WHERE id = ?`).run(...args);
  }

  return getCycle(id);
}

export interface TrackCycleWithProgress extends TrackCycleRow {
  total: number;
  done: number;
}

/** Cycles del proyecto con progreso (issues terminados / totales). */
export async function listCyclesWithProgress(projectId: string): Promise<TrackCycleWithProgress[]> {
  return (await getDb()
    .prepare(
      `SELECT c.*,
         (SELECT COUNT(*) FROM track_issues i WHERE i.cycle_id = c.id) AS total,
         (SELECT COUNT(*) FROM track_issues i JOIN track_statuses s ON s.id = i.status_id
            WHERE i.cycle_id = c.id AND s.category IN ('done', 'cancelled')) AS done
       FROM track_cycles c
       WHERE c.project_id = ?
       ORDER BY c.start_at DESC`,
    )
    .all(projectId)) as TrackCycleWithProgress[];
}

/** Siguiente cycle del proyecto (empieza después que este). */
export async function nextCycle(cycle: TrackCycleRow): Promise<TrackCycleRow | undefined> {
  return (await getDb()
    .prepare(
      `SELECT * FROM track_cycles
       WHERE project_id = ? AND id != ? AND (start_at > ? OR (start_at = ? AND created_at > ?))
       ORDER BY start_at ASC, created_at ASC LIMIT 1`,
    )
    .get(cycle.project_id, cycle.id, cycle.start_at, cycle.start_at, cycle.created_at)) as TrackCycleRow | undefined;
}

export type CompleteCycleResult =
  | { ok: true; moved: number; targetCycleId: string | null }
  | { ok: false; reason: 'not_found' | 'invalid_target' };

/**
 * Completa un cycle: los issues sin terminar (status no done/cancelled o sin
 * status) pasan al cycle indicado; si no se indica (undefined), al siguiente
 * del proyecto; `null` los saca de todo cycle. Si el cycle seguía abierto, su
 * fin pasa a hoy. Cada issue movido deja su cycle_change en la actividad
 * (firmado por `actorId`, o el dueño del proyecto) y emite issue.updated,
 * igual que updateIssue.
 */
export async function completeCycle(
  cycleId: string,
  targetCycleId?: string | null,
  actorId?: string,
): Promise<CompleteCycleResult> {
  const cycle = await getCycle(cycleId);
  if (!cycle) return { ok: false, reason: 'not_found' };
  let target: string | null;
  if (targetCycleId === undefined) {
    target = (await nextCycle(cycle))?.id ?? null;
  } else if (targetCycleId === null) {
    target = null;
  } else {
    const t = await getCycle(targetCycleId);
    if (!t || t.id === cycle.id || t.project_id !== cycle.project_id) return { ok: false, reason: 'invalid_target' };
    target = t.id;
  }
  const today = new Date().toISOString().slice(0, 10);
  const unfinished = `cycle_id = ? AND project_id = ?
           AND (status_id IS NULL OR status_id NOT IN (
             SELECT id FROM track_statuses WHERE project_id = ? AND category IN ('done', 'cancelled')))`;
  const tx = await getClient().transaction();
  const tdb = txDb(tx);
  let before: TrackIssueWithStatus[];
  let moved: number;
  try {
    // Los ids se toman dentro de la transacción para loguear exactamente los que se movieron.
    before = (await tdb
      .prepare(
        issueSelect(`WHERE i.id IN (SELECT id FROM track_issues WHERE ${unfinished})`),
      )
      .all(cycle.id, cycle.project_id, cycle.project_id)) as TrackIssueWithStatus[];
    const res = await tdb
      .prepare(`UPDATE track_issues SET cycle_id = ?, updated_at = datetime('now') WHERE ${unfinished}`)
      .run(target, cycle.id, cycle.project_id, cycle.project_id);
    moved = res.changes;
    if (cycle.end_at.slice(0, 10) > today) {
      await tdb.prepare('UPDATE track_cycles SET end_at = ? WHERE id = ?').run(today, cycle.id);
    }
    await tdb
      .prepare('UPDATE track_cycles SET completed_at = COALESCE(completed_at, ?) WHERE id = ?')
      .run(nowIso(), cycle.id);
    await tx.commit();
  } catch (e) {
    await tx.rollback();
    throw e;
  }

  if (before.length) {
    const actor = actorId ?? (await getProject(cycle.project_id))?.owner_id ?? null;
    const targetName = target ? ((await getCycle(target))?.name ?? '') : '';
    for (const prev of before) {
      if (actor) {
        await createIssueActivity(prev.id, actor, 'cycle_change', {
          from: prev.cycle_name ?? cycle.name,
          to: targetName,
          via: 'cycle_complete',
        });
      }
      const updated = await getIssue(prev.id);
      if (updated) scheduleIssueEvents(prev, updated, ['cycleId']);
    }
  }
  return { ok: true, moved, targetCycleId: target };
}

export async function deleteCycle(id: string): Promise<boolean> {
  const res = await getDb().prepare('DELETE FROM track_cycles WHERE id = ?').run(id);
  return res.changes > 0;
}

// ---------- Issues ----------

function issueSelect(extraWhere = ''): string {
  return `
    SELECT
      i.*,
      s.name AS status_name,
      s.color AS status_color,
      s.category AS status_category,
      u.name AS assignee_name,
      u.email AS assignee_email,
      c.name AS cycle_name,
      ms.name AS milestone_name,
      (SELECT COUNT(*) FROM track_issues child WHERE child.parent_id = i.id) AS child_count
    FROM track_issues i
    LEFT JOIN track_statuses s ON s.id = i.status_id
    LEFT JOIN users u ON u.id = i.assignee_id
    LEFT JOIN track_cycles c ON c.id = i.cycle_id
    LEFT JOIN track_milestones ms ON ms.id = i.milestone_id
    ${extraWhere}
  `;
}

/** Cola de triage del proyecto (más nuevos primero), en una sola query. */
export async function listProjectTriageIssues(projectId: string, limit = 200): Promise<TrackIssueWithStatus[]> {
  return (await getDb()
    .prepare(`${issueSelect('WHERE i.project_id = ? AND i.triage = 1')} ORDER BY i.created_at DESC LIMIT ?`)
    .all(projectId, limit)) as TrackIssueWithStatus[];
}

export async function listIssues(
  projectId: string,
  options: ListIssuesOptions = {},
): Promise<ListIssuesResult> {
  const db = getDb();
  const pageSize = Math.min(Math.max(options.pageSize ?? 50, 1), 100);
  const page = Math.max(options.page ?? 1, 1);

  // Los archivados (auto-archivo, lib/track-housekeeping) no salen en las listas.
  const where: string[] = ['i.project_id = ?', 'i.triage = 0', 'i.archived_at IS NULL'];
  const args: Array<string | number> = [projectId];

  const statusIds = toArray(options.statusId);
  if (statusIds) {
    where.push(`i.status_id IN ${inClause(statusIds.length)}`);
    args.push(...statusIds);
  }
  const priorities = toArray(options.priority);
  if (priorities) {
    where.push(`i.priority IN ${inClause(priorities.length)}`);
    args.push(...priorities);
  }
  const assigneeIds = toArray(options.assigneeId);
  if (assigneeIds) {
    where.push(`i.assignee_id IN ${inClause(assigneeIds.length)}`);
    args.push(...assigneeIds);
  }
  const cycleIds = toArray(options.cycleId);
  if (cycleIds) {
    where.push(`i.cycle_id IN ${inClause(cycleIds.length)}`);
    args.push(...cycleIds);
  }
  if (options.dueAfter) {
    where.push('i.due_date >= ?');
    args.push(options.dueAfter);
  }
  if (options.dueBefore) {
    where.push('i.due_date <= ?');
    args.push(options.dueBefore);
  }
  // Título, identificador, descripción y comentarios; % y _ se buscan literales.
  const search = issueSearchClause(options.q);
  if (search) {
    where.push(search.sql);
    args.push(...search.args);
  }

  const labelIds = toArray(options.labelIds);
  if (labelIds) {
    const placeholders = labelIds.map(() => "i.labels LIKE ? ESCAPE '\\'").join(' OR ');
    where.push(`(${placeholders})`);
    args.push(...labelIds.map(labelIdLike));
  }

  const whereSql = where.join(' AND ');
  const orderBy = issueOrderBy(options.sort);

  const total = (
    (await db
      .prepare(`SELECT COUNT(*) AS c FROM track_issues i WHERE ${whereSql}`)
      .get(...args)) as { c: number }
  ).c;

  const rows = (await db
    .prepare(
      `${issueSelect(`WHERE ${whereSql}`)} ORDER BY ${orderBy} LIMIT ? OFFSET ?`,
    )
    .all(...args, pageSize, (page - 1) * pageSize)) as TrackIssueWithStatus[];

  return { rows, total, page, pageSize };
}

export async function listAllIssues(
  teamId: string | null,
  userId: string,
  options: ListAllIssuesOptions = {},
): Promise<ListIssuesResult> {
  const db = getDb();
  const pageSize = Math.min(Math.max(options.pageSize ?? 50, 1), 100);
  const page = Math.max(options.page ?? 1, 1);

  const scope = projectScope(teamId, userId);
  const projectWhere = scope.where;
  const projectArg = scope.arg;

  // Solo proyectos activos, como listMyIssues y listProjectMetas: los de un
  // proyecto archivado no se pueden editar desde la lista.
  const where: string[] = [
    `i.project_id IN (SELECT id FROM track_projects WHERE ${projectWhere} AND status = 'active')`,
    'i.triage = 0',
    'i.archived_at IS NULL',
  ];
  const args: Array<string | number> = [projectArg];

  if (options.projectId) {
    where.push('i.project_id = ?');
    args.push(options.projectId);
  }

  const statusIds = toArray(options.statusId);
  if (statusIds) {
    where.push(`i.status_id IN ${inClause(statusIds.length)}`);
    args.push(...statusIds);
  }
  const priorities = toArray(options.priority);
  if (priorities) {
    where.push(`i.priority IN ${inClause(priorities.length)}`);
    args.push(...priorities);
  }
  const assigneeIds = toArray(options.assigneeId);
  if (assigneeIds) {
    where.push(`i.assignee_id IN ${inClause(assigneeIds.length)}`);
    args.push(...assigneeIds);
  }
  const cycleIds = toArray(options.cycleId);
  if (cycleIds) {
    where.push(`i.cycle_id IN ${inClause(cycleIds.length)}`);
    args.push(...cycleIds);
  }
  if (options.dueAfter) {
    where.push('i.due_date >= ?');
    args.push(options.dueAfter);
  }
  if (options.dueBefore) {
    where.push('i.due_date <= ?');
    args.push(options.dueBefore);
  }
  // Título, identificador, descripción y comentarios; % y _ se buscan literales.
  const search = issueSearchClause(options.q);
  if (search) {
    where.push(search.sql);
    args.push(...search.args);
  }

  const labelIds = toArray(options.labelIds);
  if (labelIds) {
    const placeholders = labelIds.map(() => "i.labels LIKE ? ESCAPE '\\'").join(' OR ');
    where.push(`(${placeholders})`);
    args.push(...labelIds.map(labelIdLike));
  }

  const whereSql = where.join(' AND ');
  const orderBy = issueOrderBy(options.sort);

  const total = (
    (await db
      .prepare(`SELECT COUNT(*) AS c FROM track_issues i WHERE ${whereSql}`)
      .get(...args)) as { c: number }
  ).c;

  const rows = (await db
    .prepare(
      `${issueSelect(`WHERE ${whereSql}`)} ORDER BY ${orderBy} LIMIT ? OFFSET ?`,
    )
    .all(...args, pageSize, (page - 1) * pageSize)) as TrackIssueWithStatus[];

  return { rows, total, page, pageSize };
}

/**
 * "My tasks": issues asignados a `assigneeId` en todos los proyectos
 * accesibles del workspace. Por defecto excluye los completados
 * (status done/cancelled). Ordena por vencimiento (sin fecha al final) y
 * prioridad.
 */
export async function listMyIssues(
  teamId: string | null,
  ownerId: string,
  assigneeId: string,
  options: { includeCompleted?: boolean; limit?: number } = {},
): Promise<TrackIssueWithStatus[]> {
  const scope = projectScope(teamId, ownerId);
  const limit = Math.min(Math.max(options.limit ?? 200, 1), 500);
  const where = [
    `i.project_id IN (SELECT id FROM track_projects WHERE ${scope.where} AND status = 'active')`,
    'i.assignee_id = ?',
    'i.triage = 0',
    'i.archived_at IS NULL',
  ];
  if (!options.includeCompleted) {
    where.push("(s.category IS NULL OR s.category NOT IN ('done', 'cancelled'))");
  }
  return (await getDb()
    .prepare(
      `${issueSelect(`WHERE ${where.join(' AND ')}`)}
       ORDER BY i.due_date IS NULL, i.due_date ASC,
         CASE i.priority WHEN 'urgent' THEN 0 WHEN 'high' THEN 1 WHEN 'medium' THEN 2 ELSE 3 END,
         i.created_at ASC
       LIMIT ?`,
    )
    .all(scope.arg, assigneeId, limit)) as TrackIssueWithStatus[];
}

export async function getIssue(id: string): Promise<TrackIssueWithStatus | undefined> {
  return (await getDb().prepare(`${issueSelect('WHERE i.id = ?')}`).get(id)) as
    | TrackIssueWithStatus
    | undefined;
}

/**
 * Issue con su proyecto, solo si el proyecto es del workspace activo
 * (ver canAccessTrackProject). Para páginas que cargan un issue por id.
 */
export async function getAccessibleIssue(
  id: string,
  teamId: string | null,
  ownerId: string,
): Promise<{ issue: TrackIssueWithStatus; project: TrackProjectRow } | null> {
  const issue = await getIssue(id);
  if (!issue) return null;
  const project = await getProject(issue.project_id);
  if (!project || !canAccessTrackProject(project, teamId, ownerId)) return null;
  return { issue, project };
}

export async function getIssueByIdentifier(
  projectId: string,
  identifier: string,
): Promise<TrackIssueWithStatus | undefined> {
  return (await getDb().prepare(`${issueSelect('WHERE i.project_id = ? AND i.identifier = ?')}`).get(projectId, identifier)) as
    | TrackIssueWithStatus
    | undefined;
}

/**
 * Origen del issue. 'app' = creado por un miembro desde la app; el resto
 * (API, Chat, Flow, GitHub, agentes) entra a triage si el proyecto lo tiene
 * activo. Por defecto se asume origen externo.
 */
export type TrackIssueSource = 'app' | 'api' | 'chat' | 'flow' | 'github' | 'agent' | 'recurring' | 'import';

export async function createIssue(
  projectId: string,
  creatorId: string,
  payload: IssueCreatePayload,
  opts: { source?: TrackIssueSource } = {},
): Promise<TrackIssueWithStatus> {
  const db = getDb();
  const id = crypto.randomUUID();
  const source: TrackIssueSource = opts.source ?? 'api';
  const projectRow = await getProject(projectId);
  // Los que se repiten los configuró un miembro: no pasan por triage.
  const triage = source !== 'app' && source !== 'recurring' && projectRow?.triage_enabled ? 1 : 0;
  const ws = projectRow ? projectWorkspaceId(projectRow) : null;
  const labelsJson =
    payload.labels && ws ? JSON.stringify(await normalizeIssueLabels(ws, payload.labels)) : '[]';
  let identifier = await nextIdentifier(projectId);
  const now = nowIso();

  // Sin status elegido: el default del proyecto (Todo antes que Backlog),
  // el mismo que preselecciona el quick-create.
  let statusId = payload.statusId ?? null;
  if (!statusId) statusId = defaultIssueStatus(await listStatuses(projectId))?.id ?? null;

  // El identificador (PROJ-n) se calcula con MAX+1: dos creaciones
  // simultáneas (p. ej. quick-add con Enter rápido) pueden chocar con el
  // UNIQUE(project_id, identifier). En ese caso se recalcula y se reintenta.
  for (let attempt = 0; ; attempt++) {
    try {
      await db
        .prepare(
          'INSERT INTO track_issues (id, project_id, identifier, title, description, status_id, priority, assignee_id, creator_id, cycle_id, estimate, parent_id, start_date, due_date, labels, source, triage, milestone_id, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
        )
        .run(
          id,
          projectId,
          identifier,
          payload.title?.trim() ?? '',
          blocksToJson(payload.description),
          statusId,
          payload.priority ?? 'medium',
          payload.assigneeId ?? null,
          creatorId,
          payload.cycleId ?? null,
          payload.estimate ?? null,
          payload.parentId ?? null,
          payload.startDate ?? null,
          payload.dueDate ?? null,
          labelsJson,
          source,
          triage,
          payload.milestoneId ?? null,
          now,
          now,
        );
      break;
    } catch (err) {
      const msg = err instanceof Error ? err.message : '';
      if (attempt >= 5 || !msg.includes('UNIQUE') || !msg.includes('identifier')) throw err;
      identifier = await nextIdentifier(projectId);
    }
  }

  await createIssueActivity(id, creatorId, 'created', source === 'app' ? {} : { source });
  if (payload.parentId) {
    await createIssueActivity(id, creatorId, 'subtask_added', { parentId: payload.parentId });
  }

  await autoSubscribe(id, [creatorId, payload.assigneeId]);

  const created = (await getIssue(id)) as TrackIssueWithStatus;

  if (payload.assigneeId && payload.assigneeId !== creatorId) {
    const [project, creator] = await Promise.all([
      getProject(projectId),
      getUserById(creatorId),
    ]);
    if (project && creator) {
      await createIssueAssignedNotification({
        issue: created,
        projectName: project.name,
        actor: creator,
        assigneeId: payload.assigneeId,
      });
    }
  }

  return created;
}

/** Cambios que avisan a los suscriptos (clave corta que traduce la bandeja). */
const NOTIFY_CHANGE: Partial<Record<TrackIssueActivityRow['type'], string>> = {
  title_change: 'title',
  description_change: 'description',
  priority_change: 'priority',
  assignee_change: 'assignee',
  cycle_change: 'cycle',
  due_date_change: 'dueDate',
  estimate_change: 'estimate',
};

/** Origen de un cambio automático (hoy solo GitHub): se guarda en la actividad. */
export interface IssueChangeVia {
  source: 'github';
  author?: string | null;
  ref?: string | null;
}

export async function updateIssue(
  id: string,
  payload: IssueUpdatePayload,
  actorId?: string,
  opts: { via?: IssueChangeVia } = {},
): Promise<TrackIssueWithStatus | undefined> {
  const db = getDb();
  const existing = await getIssue(id);
  if (!existing) return undefined;

  const fields: string[] = [];
  const args: Array<string | number | null> = [];
  const activities: Array<{ type: TrackIssueActivityRow['type']; meta: Record<string, unknown> }> = [];

  let newAssigneeId: string | null | undefined = undefined;
  let statusChanged = false;
  let oldStatusName = existing.status_name ?? '';
  let newStatusName = existing.status_name ?? '';

  if (payload.title !== undefined && payload.title.trim() !== existing.title) {
    fields.push('title = ?');
    args.push(payload.title.trim());
    activities.push({ type: 'title_change', meta: { from: existing.title, to: payload.title.trim() } });
  }
  if (payload.description !== undefined && blocksToJson(payload.description) !== existing.description) {
    fields.push('description = ?');
    args.push(blocksToJson(payload.description));
    activities.push({ type: 'description_change', meta: {} });
  }
  if (payload.statusId !== undefined && payload.statusId !== existing.status_id) {
    fields.push('status_id = ?');
    args.push(payload.statusId ?? null);
    const newStatus = payload.statusId ? await getStatus(payload.statusId) : null;
    statusChanged = true;
    oldStatusName = existing.status_name ?? '';
    newStatusName = newStatus?.name ?? '';
    activities.push({
      type: 'status_change',
      meta: {
        from: existing.status_name ?? '',
        to: newStatus?.name ?? '',
        fromCategory: existing.status_category ?? '',
        toCategory: newStatus?.category ?? '',
      },
    });
    if (newStatus && (newStatus.category === 'done' || newStatus.category === 'cancelled')) {
      activities.push({ type: 'closed', meta: { status: newStatus.name, category: newStatus.category } });
    } else if (
      existing.status_category &&
      (existing.status_category === 'done' || existing.status_category === 'cancelled')
    ) {
      activities.push({ type: 'reopened', meta: { status: newStatus?.name ?? '' } });
    }
  }
  if (payload.priority !== undefined && payload.priority !== existing.priority) {
    fields.push('priority = ?');
    args.push(payload.priority);
    activities.push({ type: 'priority_change', meta: { from: existing.priority, to: payload.priority } });
  }
  if (payload.assigneeId !== undefined && payload.assigneeId !== existing.assignee_id) {
    fields.push('assignee_id = ?');
    args.push(payload.assigneeId ?? null);
    activities.push({
      type: 'assignee_change',
      meta: { from: existing.assignee_id ?? '', to: payload.assigneeId ?? '' },
    });
    newAssigneeId = payload.assigneeId ?? null;
  }
  if (payload.cycleId !== undefined && payload.cycleId !== existing.cycle_id) {
    fields.push('cycle_id = ?');
    args.push(payload.cycleId ?? null);
    const newCycle = payload.cycleId ? await getCycle(payload.cycleId) : null;
    activities.push({ type: 'cycle_change', meta: { from: existing.cycle_name ?? '', to: newCycle?.name ?? '' } });
  }
  if (payload.estimate !== undefined && payload.estimate !== existing.estimate) {
    fields.push('estimate = ?');
    args.push(payload.estimate ?? null);
    activities.push({ type: 'estimate_change', meta: { from: existing.estimate ?? '', to: payload.estimate ?? '' } });
  }
  if (payload.parentId !== undefined && payload.parentId !== existing.parent_id) {
    fields.push('parent_id = ?');
    args.push(payload.parentId ?? null);
  }
  if (payload.dueDate !== undefined && payload.dueDate !== existing.due_date) {
    fields.push('due_date = ?');
    args.push(payload.dueDate ?? null);
    activities.push({ type: 'due_date_change', meta: { from: existing.due_date ?? '', to: payload.dueDate ?? '' } });
  }
  if (payload.milestoneId !== undefined && payload.milestoneId !== (existing.milestone_id ?? null)) {
    fields.push('milestone_id = ?');
    args.push(payload.milestoneId ?? null);
  }
  // Sin activity type dedicado en el CHECK de track_issue_activity: se
  // actualiza la columna sin registrar actividad (igual que parent_id).
  if (payload.startDate !== undefined && payload.startDate !== existing.start_date) {
    fields.push('start_date = ?');
    args.push(payload.startDate ?? null);
  }
  if (payload.labels !== undefined) {
    const project = await getProject(existing.project_id);
    const ws = project ? projectWorkspaceId(project) : null;
    const next = ws ? JSON.stringify(await normalizeIssueLabels(ws, payload.labels)) : '[]';
    if (next !== existing.labels) {
      fields.push('labels = ?');
      args.push(next);
    }
  }

  if (fields.length > 0) {
    fields.push('updated_at = ?');
    args.push(nowIso());
    args.push(id);
    await db.prepare(`UPDATE track_issues SET ${fields.join(', ')} WHERE id = ?`).run(...args);
    if (newAssigneeId) await autoSubscribe(id, [newAssigneeId]);

    if (actorId) {
      const viaMeta = opts.via
        ? { via: opts.via.source, viaAuthor: opts.via.author ?? '', viaRef: opts.via.ref ?? '' }
        : {};
      for (const activity of activities) {
        await createIssueActivity(id, actorId, activity.type, { ...activity.meta, ...viaMeta });
      }

      const [owner, project] = await Promise.all([
        getUserById(actorId),
        getProject(existing.project_id),
      ]);
      // Un cambio automático (GitHub) no se notifica a nombre del owner: el
      // actor es la integración, así que el owner también recibe el aviso.
      const actor =
        owner && opts.via
          ? { id: '', email: '', name: `GitHub${opts.via.author ? ` (@${opts.via.author})` : ''}` }
          : owner;
      if (actor && project) {
        // El nuevo asignado recibe "te asignaron"; el resto de los suscriptos,
        // un aviso por el cambio de status o, si no hubo, por los demás cambios.
        const subscribers = (await listIssueSubscriberIds(id)).filter((u) => u !== newAssigneeId);
        if (newAssigneeId) {
          await createIssueAssignedNotification({
            issue: existing,
            projectName: project.name,
            actor,
            assigneeId: newAssigneeId,
          });
        }
        if (statusChanged) {
          await createIssueStatusChangedNotifications({
            issue: existing,
            projectName: project.name,
            actor,
            oldStatus: oldStatusName,
            newStatus: newStatusName,
            recipients: subscribers,
          });
        } else {
          const changes = activities.map((a) => NOTIFY_CHANGE[a.type]).filter((c): c is string => Boolean(c));
          await createIssueUpdatedNotifications({
            issue: existing,
            projectName: project.name,
            actor,
            changes: [...new Set(changes)],
            recipients: subscribers,
          });
        }
      }
    }
  }

  const updated = await getIssue(id);
  if (updated && fields.length > 0) {
    scheduleIssueEvents(
      existing,
      updated,
      Object.keys(payload).filter((k) => payload[k as keyof IssueUpdatePayload] !== undefined),
    );
  }
  return updated;
}

/**
 * Emite issue.updated (y issue.status_changed si cambió el status) para
 * webhooks y disparadores de Flow. Vive en updateIssue para que todos los
 * caminos lo usen: detalle, edición masiva, triage y GitHub. Corre después de
 * responder (after) si hay request; si no, en segundo plano.
 */
function scheduleIssueEvents(before: TrackIssueWithStatus, updated: TrackIssueWithStatus, changes: string[]): void {
  const job = async () => {
    const project = await getProject(updated.project_id);
    if (!project?.owner_id) return;
    const payload = {
      issue: {
        id: updated.id,
        identifier: updated.identifier,
        title: updated.title,
        priority: updated.priority,
        status: updated.status_name ?? null,
        assigneeId: updated.assignee_id,
      },
      project: { id: project.id, name: project.name },
      changes,
    };
    await emitEvent(project.owner_id, 'issue.updated', payload);
    if (updated.status_id !== before.status_id) {
      await emitEvent(project.owner_id, 'issue.status_changed', {
        ...payload,
        from: before.status_name ?? null,
        to: updated.status_name ?? null,
      });
    }
  };
  try {
    after(job);
  } catch {
    void job().catch(() => {});
  }
}

/** El issue y todos sus descendientes (subtasks de subtasks incluidas). */
const ISSUE_TREE_CTE = `WITH RECURSIVE tree(id) AS (
  SELECT id FROM track_issues WHERE id = ?
  UNION
  SELECT c.id FROM track_issues c JOIN tree ON c.parent_id = tree.id
)`;

/**
 * Borra el issue con todos sus descendientes (parent_id es ON DELETE SET NULL,
 * así que sin esto los nietos quedarían sueltos). Devuelve los ids borrados;
 * vacío si el issue no existía.
 */
export async function deleteIssueTree(id: string): Promise<string[]> {
  const db = getDb();
  const ids = ((await db.prepare(`${ISSUE_TREE_CTE} SELECT id FROM tree`).all(id)) as Array<{ id: string }>).map(
    (r) => r.id,
  );
  if (ids.length === 0) return [];
  // Los adjuntos se borran por FK, pero sus archivos no: juntar las URLs antes.
  const files = (await db
    .prepare(`SELECT url FROM track_issue_attachments WHERE issue_id IN (${ISSUE_TREE_CTE} SELECT id FROM tree)`)
    .all(id)) as Array<{ url: string }>;
  // Un solo DELETE: atómico, y las filas hijas de otras tablas se borran por FK.
  await db.prepare(`DELETE FROM track_issues WHERE id IN (${ISSUE_TREE_CTE} SELECT id FROM tree)`).run(id);
  await deleteUploads(files.map((f) => f.url));
  return ids;
}

export async function deleteIssue(id: string): Promise<boolean> {
  return (await deleteIssueTree(id)).length > 0;
}

export async function listIssueChildren(issueId: string): Promise<TrackIssueWithStatus[]> {
  return (await getDb().prepare(`${issueSelect('WHERE i.parent_id = ?')} ORDER BY i.created_at ASC`).all(issueId)) as TrackIssueWithStatus[];
}

export async function getIssueParentChain(issueId: string): Promise<IssueParentSummary[]> {
  const chain: IssueParentSummary[] = [];
  const db = getDb();
  let currentId: string | null = issueId;
  const seen = new Set<string>();
  while (currentId && !seen.has(currentId)) {
    seen.add(currentId);
    const row = (await db
      .prepare(
        `SELECT p.id, p.parent_id, p.identifier, p.title
         FROM track_issues p
         WHERE p.id = ?`,
      )
      .get(currentId)) as { id: string; parent_id: string | null; identifier: string; title: string } | undefined;
    if (!row) break;
    if (row.parent_id) {
      const parent = (await db
        .prepare('SELECT id, identifier, title FROM track_issues WHERE id = ?')
        .get(row.parent_id)) as IssueParentSummary | undefined;
      if (parent) {
        chain.unshift(parent);
        currentId = row.parent_id;
        continue;
      }
    }
    break;
  }
  return chain;
}

export interface ProjectMember {
  id: string;
  email: string;
  name: string | null;
  role: string;
}

export async function listProjectMembers(projectId: string, userId: string): Promise<ProjectMember[]> {
  const db = getDb();
  const project = (await db.prepare('SELECT team_id FROM track_projects WHERE id = ?').get(projectId)) as
    | { team_id: string | null }
    | undefined;
  if (!project) return [];

  if (project.team_id) {
    return (await db
      .prepare(
        `SELECT u.id, u.email, u.name, m.role
         FROM team_members m
         JOIN users u ON u.id = m.user_id
         WHERE m.team_id = ?
         ORDER BY m.role = 'owner' DESC, u.name ASC, u.email ASC`,
      )
      .all(project.team_id)) as ProjectMember[];
  }

  const owner = (await db.prepare('SELECT id, email, name FROM users WHERE id = ?').get(userId)) as
    | UserRow
    | undefined;
  if (!owner) return [];
  return [{ id: owner.id, email: owner.email, name: owner.name, role: 'owner' }];
}

/** Proyecto con lo necesario para crear/editar issues inline desde vistas cruzadas. */
export interface TrackProjectMeta {
  id: string;
  name: string;
  icon: string | null;
  statuses: TrackStatusRow[];
  members: ProjectMember[];
}

/**
 * Proyectos activos accesibles con sus status y miembros, para las vistas
 * que mezclan issues de varios proyectos (Issues, My tasks).
 */
export async function listProjectMetas(teamId: string | null, ownerId: string): Promise<TrackProjectMeta[]> {
  const db = getDb();
  const scope = projectScope(teamId, ownerId);
  const projects = (await db
    .prepare(
      `SELECT id, name, icon FROM track_projects WHERE ${scope.where} AND status = 'active' ORDER BY name ASC LIMIT 100`,
    )
    .all(scope.arg)) as Array<{ id: string; name: string; icon: string | null }>;
  if (projects.length === 0) return [];

  const statuses = (await db
    .prepare(
      `SELECT * FROM track_statuses WHERE project_id IN ${inClause(projects.length)} ORDER BY position ASC`,
    )
    .all(...projects.map((p) => p.id))) as TrackStatusRow[];

  // Todos los proyectos del scope comparten miembros (mismo team o mismo dueño).
  const members = await listProjectMembers(projects[0].id, ownerId);

  return projects.map((p) => ({
    ...p,
    statuses: statuses.filter((s) => s.project_id === p.id),
    members,
  }));
}

// ---------- Saved views ----------

function rowToView(row: TrackIssueViewRow): TrackIssueView {
  return {
    ...row,
    sort: row.sort as TrackIssueView['sort'],
    filters: parseJson(row.filters, {}),
    columns: row.columns ? parseJson<string[]>(row.columns, []) : null,
    is_default: row.is_default === 1,
  };
}

function parseJson<T>(value: string, fallback: T): T {
  try {
    return JSON.parse(value) as T;
  } catch {
    return fallback;
  }
}

export async function listIssueViews(projectId: string, userId: string): Promise<TrackIssueView[]> {
  const rows = (await getDb()
    .prepare(
      `SELECT * FROM track_issue_views
       WHERE project_id = ? AND user_id = ?
       ORDER BY is_default DESC, name ASC`,
    )
    .all(projectId, userId)) as TrackIssueViewRow[];
  return rows.map(rowToView);
}

export async function getIssueView(id: string): Promise<TrackIssueView | undefined> {
  const row = (await getDb().prepare('SELECT * FROM track_issue_views WHERE id = ?').get(id)) as
    | TrackIssueViewRow
    | undefined;
  return row ? rowToView(row) : undefined;
}

export async function createIssueView(
  projectId: string,
  userId: string,
  payload: IssueViewCreatePayload,
): Promise<TrackIssueView> {
  const db = getDb();
  const id = crypto.randomUUID();
  const now = nowIso();
  await db
    .prepare(
      `INSERT INTO track_issue_views
       (id, project_id, user_id, name, view_type, filters, sort, columns, is_default, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(
      id,
      projectId,
      userId,
      payload.name.trim(),
      payload.viewType,
      JSON.stringify(payload.filters ?? {}),
      payload.sort,
      payload.columns ? JSON.stringify(payload.columns) : null,
      0,
      now,
      now,
    );
  return (await getIssueView(id)) as TrackIssueView;
}

export async function updateIssueView(
  id: string,
  payload: IssueViewUpdatePayload,
): Promise<TrackIssueView | undefined> {
  const db = getDb();
  const existing = await getIssueView(id);
  if (!existing) return undefined;

  const fields: string[] = [];
  const args: Array<string | number | null> = [];

  if (payload.name !== undefined) {
    fields.push('name = ?');
    args.push(payload.name.trim());
  }
  if (payload.viewType !== undefined) {
    fields.push('view_type = ?');
    args.push(payload.viewType);
  }
  if (payload.filters !== undefined) {
    fields.push('filters = ?');
    args.push(JSON.stringify(payload.filters));
  }
  if (payload.sort !== undefined) {
    fields.push('sort = ?');
    args.push(payload.sort);
  }
  if (payload.columns !== undefined) {
    fields.push('columns = ?');
    args.push(payload.columns ? JSON.stringify(payload.columns) : null);
  }

  if (fields.length > 0) {
    fields.push('updated_at = ?');
    args.push(nowIso());
    args.push(id);
    await db.prepare(`UPDATE track_issue_views SET ${fields.join(', ')} WHERE id = ?`).run(...args);
  }

  return getIssueView(id);
}

export async function deleteIssueView(id: string): Promise<boolean> {
  const res = await getDb().prepare('DELETE FROM track_issue_views WHERE id = ?').run(id);
  return res.changes > 0;
}

export async function setDefaultIssueView(
  projectId: string,
  userId: string,
  viewId: string,
): Promise<TrackIssueView | undefined> {
  const db = getDb();
  const existing = await getIssueView(viewId);
  if (!existing || existing.project_id !== projectId || existing.user_id !== userId) {
    return undefined;
  }

  const client = getClient();
  const tx = await client.transaction();
  const tdb = txDb(tx);

  try {
    await tdb
      .prepare(
        'UPDATE track_issue_views SET is_default = 0 WHERE project_id = ? AND user_id = ?',
      )
      .run(projectId, userId);
    await tdb
      .prepare('UPDATE track_issue_views SET is_default = 1 WHERE id = ?')
      .run(viewId);
    await tx.commit();
  } catch (e) {
    await tx.rollback();
    throw e;
  }

  return getIssueView(viewId);
}

// ---------- Comments ----------

export async function listIssueComments(issueId: string): Promise<TrackCommentWithAuthor[]> {
  return (await getDb()
    .prepare(
      `SELECT c.*, u.name AS user_name, u.email AS user_email
       FROM track_issue_comments c
       JOIN users u ON u.id = c.user_id
       WHERE c.issue_id = ?
       ORDER BY c.created_at ASC`,
    )
    .all(issueId)) as TrackCommentWithAuthor[];
}

export async function createIssueComment(
  issueId: string,
  userId: string,
  payload: CommentCreatePayload,
): Promise<TrackCommentWithAuthor> {
  const db = getDb();
  const id = crypto.randomUUID();
  await db
    .prepare(
      'INSERT INTO track_issue_comments (id, issue_id, user_id, body, created_at) VALUES (?, ?, ?, ?, ?)',
    )
    .run(id, issueId, userId, payload.body.trim(), nowIso());

  // El cuerpo vive solo en track_issue_comments: el timeline lo lee de ahí,
  // así una edición o un borrado del autor no deja copias viejas en el log.
  await createIssueActivity(issueId, userId, 'comment', { commentId: id });
  await autoSubscribe(issueId, [userId]);

  const comment = (await db
    .prepare(
      `SELECT c.*, u.name AS user_name, u.email AS user_email
       FROM track_issue_comments c
       JOIN users u ON u.id = c.user_id
       WHERE c.id = ?`,
    )
    .get(id)) as TrackCommentWithAuthor;

  // Notify mentions, assignee and creator.
  const [issue, project, actor] = await Promise.all([
    getIssue(issueId),
    db.prepare('SELECT name FROM track_projects WHERE id = (SELECT project_id FROM track_issues WHERE id = ?)').get(issueId) as Promise<{ name: string } | undefined>,
    getUserById(userId),
  ]);
  if (issue && project && actor) {
    const members = await listProjectMembers(issue.project_id, userId);
    await createIssueCommentNotifications({
      issue,
      projectName: project.name,
      actor,
      body: payload.body.trim(),
      members,
      recipients: await listIssueSubscriberIds(issueId),
    });
  }

  return comment;
}

export type CommentMutationResult<T> = { ok: true; value: T } | { ok: false; reason: 'not_found' | 'forbidden' };

async function ownComment(
  issueId: string,
  commentId: string,
  userId: string,
): Promise<{ ok: true } | { ok: false; reason: 'not_found' | 'forbidden' }> {
  const row = (await getDb()
    .prepare('SELECT user_id FROM track_issue_comments WHERE id = ? AND issue_id = ?')
    .get(commentId, issueId)) as { user_id: string } | undefined;
  if (!row) return { ok: false, reason: 'not_found' };
  if (row.user_id !== userId) return { ok: false, reason: 'forbidden' };
  return { ok: true };
}

/** Solo el autor edita su comentario; queda marcado con updated_at. */
export async function updateIssueComment(
  issueId: string,
  commentId: string,
  userId: string,
  payload: CommentUpdatePayload,
): Promise<CommentMutationResult<TrackCommentWithAuthor>> {
  const own = await ownComment(issueId, commentId, userId);
  if (!own.ok) return own;
  const db = getDb();
  const body = payload.body.trim();
  await db
    .prepare('UPDATE track_issue_comments SET body = ?, updated_at = ? WHERE id = ? AND body != ?')
    .run(body, nowIso(), commentId, body);
  // Filas viejas guardaban el cuerpo en meta: se limpian para no conservar la versión anterior.
  await db
    .prepare(
      `UPDATE track_issue_activities SET meta = json_object('commentId', ?)
       WHERE issue_id = ? AND type = 'comment' AND json_extract(meta, '$.commentId') = ?`,
    )
    .run(commentId, issueId, commentId);
  const comment = (await db
    .prepare(
      `SELECT c.*, u.name AS user_name, u.email AS user_email
       FROM track_issue_comments c
       JOIN users u ON u.id = c.user_id
       WHERE c.id = ?`,
    )
    .get(commentId)) as TrackCommentWithAuthor;
  return { ok: true, value: comment };
}

/** Solo el autor borra su comentario; se va también su entrada del timeline. */
export async function deleteIssueComment(
  issueId: string,
  commentId: string,
  userId: string,
): Promise<CommentMutationResult<null>> {
  const own = await ownComment(issueId, commentId, userId);
  if (!own.ok) return own;
  const db = getDb();
  await db
    .prepare(
      `DELETE FROM track_issue_activities
       WHERE issue_id = ? AND type = 'comment' AND json_extract(meta, '$.commentId') = ?`,
    )
    .run(issueId, commentId);
  await db.prepare('DELETE FROM track_issue_comments WHERE id = ? AND issue_id = ?').run(commentId, issueId);
  return { ok: true, value: null };
}

// ---------- Relations ----------

export async function listIssueRelations(issueId: string): Promise<TrackIssueRelationWithTarget[]> {
  return (await getDb()
    .prepare(
      `SELECT r.*, i.identifier, i.title, 'outgoing' AS direction
       FROM track_issue_relations r
       JOIN track_issues i ON i.id = r.related_issue_id
       WHERE r.issue_id = ?
       UNION ALL
       SELECT r.*, i.identifier, i.title, 'incoming' AS direction
       FROM track_issue_relations r
       JOIN track_issues i ON i.id = r.issue_id
       WHERE r.related_issue_id = ?
       ORDER BY created_at DESC`,
    )
    .all(issueId, issueId)) as TrackIssueRelationWithTarget[];
}

export async function createIssueRelation(
  issueId: string,
  userId: string,
  relatedIssueId: string,
  type: 'blocks' | 'related' | 'duplicates' = 'related',
): Promise<TrackIssueRelationWithTarget[]> {
  const db = getDb();
  const id = crypto.randomUUID();
  await db
    .prepare(
      'INSERT INTO track_issue_relations (id, issue_id, related_issue_id, type) VALUES (?, ?, ?, ?)',
    )
    .run(id, issueId, relatedIssueId, type);
  const related = (await db.prepare('SELECT identifier, title FROM track_issues WHERE id = ?').get(relatedIssueId)) as
    | { identifier: string; title: string }
    | undefined;
  await createIssueActivity(issueId, userId, 'relation_added', {
    relatedIssueId,
    type,
    identifier: related?.identifier ?? '',
    title: related?.title ?? '',
  });
  return listIssueRelations(issueId);
}

/** ¿Ya hay una relación entre los dos issues (en cualquier dirección)? */
export async function hasIssueRelation(issueId: string, otherIssueId: string): Promise<boolean> {
  const row = await getDb()
    .prepare(
      `SELECT id FROM track_issue_relations
       WHERE (issue_id = ? AND related_issue_id = ?) OR (issue_id = ? AND related_issue_id = ?) LIMIT 1`,
    )
    .get(issueId, otherIssueId, otherIssueId, issueId);
  return !!row;
}

export async function deleteIssueRelation(id: string, issueId: string, userId: string): Promise<boolean> {
  const db = getDb();
  const row = (await db
    .prepare('SELECT issue_id, related_issue_id, type FROM track_issue_relations WHERE id = ?')
    .get(id)) as { issue_id: string; related_issue_id: string; type: string } | undefined;
  // La relación tiene que colgar del issue de la URL (el único validado contra
  // el workspace): si no, se podría borrar una relación ajena por id.
  if (!row || (row.issue_id !== issueId && row.related_issue_id !== issueId)) return false;
  const otherIssueId = row.issue_id === issueId ? row.related_issue_id : row.issue_id;
  const related = (await db.prepare('SELECT identifier, title FROM track_issues WHERE id = ?').get(otherIssueId)) as
    | { identifier: string; title: string }
    | undefined;
  const res = await db
    .prepare('DELETE FROM track_issue_relations WHERE id = ? AND (issue_id = ? OR related_issue_id = ?)')
    .run(id, issueId, issueId);
  if (res.changes === 0) return false;
  const actorIssueId = row.issue_id === issueId ? issueId : row.issue_id;
  await createIssueActivity(actorIssueId, userId, 'relation_removed', {
    relatedIssueId: otherIssueId,
    type: row.type,
    identifier: related?.identifier ?? '',
    title: related?.title ?? '',
  });
  return res.changes > 0;
}

// ---------- Attachments ----------

export async function listIssueAttachments(issueId: string): Promise<TrackIssueAttachmentWithAuthor[]> {
  return (await getDb()
    .prepare(
      `SELECT a.*, u.name AS user_name, u.email AS user_email
       FROM track_issue_attachments a
       JOIN users u ON u.id = a.user_id
       WHERE a.issue_id = ?
       ORDER BY a.created_at DESC`,
    )
    .all(issueId)) as TrackIssueAttachmentWithAuthor[];
}

export interface AttachmentCreatePayload {
  filename: string;
  contentType: string;
  size: number;
  url: string;
}

export async function createIssueAttachment(
  issueId: string,
  userId: string,
  payload: AttachmentCreatePayload,
): Promise<TrackIssueAttachmentWithAuthor> {
  const db = getDb();
  const id = crypto.randomUUID();
  const now = nowIso();
  await db
    .prepare(
      'INSERT INTO track_issue_attachments (id, issue_id, user_id, filename, content_type, size, url, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
    )
    .run(id, issueId, userId, payload.filename, payload.contentType, payload.size, payload.url, now);

  await createIssueActivity(issueId, userId, 'attachment_added', { attachmentId: id, filename: payload.filename });

  return (await db
    .prepare(
      `SELECT a.*, u.name AS user_name, u.email AS user_email
       FROM track_issue_attachments a
       JOIN users u ON u.id = a.user_id
       WHERE a.id = ?`,
    )
    .get(id)) as TrackIssueAttachmentWithAuthor;
}

export async function deleteIssueAttachment(id: string, issueId: string): Promise<boolean> {
  const db = getDb();
  const row = (await db
    .prepare('SELECT url FROM track_issue_attachments WHERE id = ? AND issue_id = ?')
    .get(id, issueId)) as { url: string } | undefined;
  if (!row) return false;
  const res = await db.prepare('DELETE FROM track_issue_attachments WHERE id = ? AND issue_id = ?').run(id, issueId);
  if (res.changes > 0) await deleteUploads([row.url]);
  return res.changes > 0;
}

// ---------- Activity ----------

export async function listIssueActivities(issueId: string): Promise<TrackIssueActivityWithAuthor[]> {
  return (await getDb()
    .prepare(
      `SELECT a.*, u.name AS user_name, u.email AS user_email
       FROM track_issue_activities a
       JOIN users u ON u.id = a.user_id
       WHERE a.issue_id = ? AND a.type != 'comment'
       UNION ALL
       -- Los comentarios se leen siempre de su tabla (texto vigente, editado o no).
       SELECT c.id, c.issue_id, c.user_id, 'comment' AS type,
         json_object('commentId', c.id, 'body', c.body, 'editedAt', c.updated_at) AS meta,
         c.created_at, u.name AS user_name, u.email AS user_email
       FROM track_issue_comments c
       JOIN users u ON u.id = c.user_id
       WHERE c.issue_id = ?
       ORDER BY created_at ASC`,
    )
    .all(issueId, issueId)) as TrackIssueActivityWithAuthor[];
}

export async function createIssueActivity(
  issueId: string,
  userId: string,
  type: TrackIssueActivityRow['type'],
  meta: Record<string, unknown>,
): Promise<TrackIssueActivityRow> {
  const db = getDb();
  const id = crypto.randomUUID();
  const now = nowIso();
  await db
    .prepare(
      'INSERT INTO track_issue_activities (id, issue_id, user_id, type, meta, created_at) VALUES (?, ?, ?, ?, ?, ?)',
    )
    .run(id, issueId, userId, type, JSON.stringify(meta), now);
  return (await db.prepare('SELECT * FROM track_issue_activities WHERE id = ?').get(id)) as TrackIssueActivityRow;
}

// ---------- Bloques de descripción ----------

export interface TrackTextBlock {
  type: 'text';
  text: string;
}

export type TrackCommentBlock = TrackTextBlock;
