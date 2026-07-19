/**
 * Track — lógica de negocio para proyectos, status, cycles e issues.
 *
 * Nota: el módulo `lib/track.ts` ya existe para el tracking de clicks de
 * links, por lo que este feature vive en `lib/track-data.ts`.
 */
import { getDb, getClient, txDb, getUserById } from './db';
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
} from './notifications';
import type {
  CommentCreatePayload,
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

// ---------- Tipos públicos ----------

export interface TrackIssueWithStatus extends TrackIssueRow {
  status_name: string | null;
  status_color: string | null;
  status_category: TrackStatusRow['category'] | null;
  assignee_name: string | null;
  assignee_email: string | null;
  cycle_name: string | null;
  child_count: number;
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
  sort?: 'newest' | 'oldest' | 'priority' | 'identifier';
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
  sort: 'newest' | 'oldest' | 'priority' | 'identifier';
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

function labelsToJson(value: unknown): string {
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

async function nextIdentifier(projectId: string): Promise<string> {
  const db = getDb();
  const prefixRow = (await db
    .prepare('SELECT slug FROM track_projects WHERE id = ?')
    .get(projectId)) as { slug: string } | undefined;
  const prefix = (prefixRow?.slug ?? 'project').toUpperCase();

  const row = (await db
    .prepare(
      "SELECT COALESCE(MAX(CAST(SUBSTR(identifier, ?) AS INTEGER)), 0) AS n FROM track_issues WHERE project_id = ? AND identifier LIKE ?",
    )
    .get(prefix.length + 2, projectId, `${prefix}-%`)) as { n: number } | undefined;

  return `${prefix}-${(row?.n ?? 0) + 1}`;
}

// ---------- Projects ----------

export async function listProjects(
  teamId: string | null,
  userId: string,
  options: ListProjectsOptions = {},
): Promise<{ rows: TrackProjectWithStats[]; total: number; page: number; pageSize: number }> {
  const db = getDb();
  const pageSize = Math.min(Math.max(options.pageSize ?? 50, 1), 100);
  const page = Math.max(options.page ?? 1, 1);

  const where = teamId ? 'team_id = ?' : '(team_id IS NULL OR team_id = ?)';
  const args: Array<string | number> = [teamId ?? userId];

  const total = (
    (await db.prepare(`SELECT COUNT(*) AS c FROM track_projects WHERE ${where}`).get(...args)) as {
      c: number;
    }
  ).c;

  const rows = (await db
    .prepare(
      `SELECT p.*,
        (SELECT COUNT(*) FROM track_issues i WHERE i.project_id = p.id AND i.status_id IN (
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

export async function createProject(
  userId: string,
  teamId: string | null,
  payload: ProjectCreatePayload,
): Promise<TrackProjectRow> {
  const db = getDb();
  const id = crypto.randomUUID();
  const slug = payload.slug ?? slugify(payload.name);
  const now = nowIso();

  await db
    .prepare(
      'INSERT INTO track_projects (id, team_id, name, slug, description, icon, color, status, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
    )
    .run(
      id,
      teamId,
      payload.name.trim(),
      slug,
      payload.description?.trim() ?? '',
      payload.icon?.trim() ?? null,
      payload.color?.trim() ?? '#000000',
      'active',
      now,
      now,
    );

  // Crear estados por defecto
  const defaults: Array<{ name: string; category: TrackStatusRow['category']; color: string }> = [
    { name: 'Backlog', category: 'backlog', color: '#666666' },
    { name: 'Todo', category: 'todo', color: '#000000' },
    { name: 'In progress', category: 'in_progress', color: '#000000' },
    { name: 'Done', category: 'done', color: '#000000' },
    { name: 'Cancelled', category: 'cancelled', color: '#999999' },
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
    args.push(payload.slug);
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
    args.push(payload.color?.trim() ?? '#000000');
  }
  if (payload.status !== undefined) {
    fields.push('status = ?');
    args.push(payload.status);
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
  const res = await getDb().prepare('DELETE FROM track_projects WHERE id = ?').run(id);
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
      payload.color?.trim() ?? '#666666',
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
    args.push(payload.color?.trim() ?? '#666666');
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
      (SELECT COUNT(*) FROM track_issues child WHERE child.parent_id = i.id) AS child_count
    FROM track_issues i
    LEFT JOIN track_statuses s ON s.id = i.status_id
    LEFT JOIN users u ON u.id = i.assignee_id
    LEFT JOIN track_cycles c ON c.id = i.cycle_id
    ${extraWhere}
  `;
}

export async function listIssues(
  projectId: string,
  options: ListIssuesOptions = {},
): Promise<ListIssuesResult> {
  const db = getDb();
  const pageSize = Math.min(Math.max(options.pageSize ?? 50, 1), 100);
  const page = Math.max(options.page ?? 1, 1);

  const where: string[] = ['i.project_id = ?'];
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
  if (options.q) {
    where.push('(i.title LIKE ? OR i.identifier LIKE ?)');
    const like = `%${options.q}%`;
    args.push(like, like);
  }

  const labelIds = toArray(options.labelIds);
  if (labelIds) {
    const placeholders = labelIds.map(() => 'i.labels LIKE ?').join(' OR ');
    where.push(`(${placeholders})`);
    args.push(...labelIds.map((id) => `%"id":"${id}"%`));
  }

  const whereSql = where.join(' AND ');

  const orderMap: Record<NonNullable<ListIssuesOptions['sort']>, string> = {
    newest: 'i.created_at DESC',
    oldest: 'i.created_at ASC',
    priority:
      "CASE i.priority WHEN 'urgent' THEN 0 WHEN 'high' THEN 1 WHEN 'medium' THEN 2 ELSE 3 END",
    identifier: 'i.identifier ASC',
  };
  const orderBy = orderMap[options.sort ?? 'newest'];

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

  const projectWhere = teamId ? 'team_id = ?' : '(team_id IS NULL OR team_id = ?)';
  const projectArg = teamId ?? userId;

  const where: string[] = ['i.project_id IN (SELECT id FROM track_projects WHERE ' + projectWhere + ')'];
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
  if (options.q) {
    where.push('(i.title LIKE ? OR i.identifier LIKE ?)');
    const like = `%${options.q}%`;
    args.push(like, like);
  }

  const labelIds = toArray(options.labelIds);
  if (labelIds) {
    const placeholders = labelIds.map(() => 'i.labels LIKE ?').join(' OR ');
    where.push(`(${placeholders})`);
    args.push(...labelIds.map((id) => `%"id":"${id}"%`));
  }

  const whereSql = where.join(' AND ');

  const orderMap: Record<NonNullable<ListIssuesOptions['sort']>, string> = {
    newest: 'i.created_at DESC',
    oldest: 'i.created_at ASC',
    priority:
      "CASE i.priority WHEN 'urgent' THEN 0 WHEN 'high' THEN 1 WHEN 'medium' THEN 2 ELSE 3 END",
    identifier: 'i.identifier ASC',
  };
  const orderBy = orderMap[options.sort ?? 'newest'];

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

export async function getIssue(id: string): Promise<TrackIssueWithStatus | undefined> {
  return (await getDb().prepare(`${issueSelect('WHERE i.id = ?')}`).get(id)) as
    | TrackIssueWithStatus
    | undefined;
}

export async function getIssueByIdentifier(
  projectId: string,
  identifier: string,
): Promise<TrackIssueWithStatus | undefined> {
  return (await getDb().prepare(`${issueSelect('WHERE i.project_id = ? AND i.identifier = ?')}`).get(projectId, identifier)) as
    | TrackIssueWithStatus
    | undefined;
}

export async function createIssue(
  projectId: string,
  creatorId: string,
  payload: IssueCreatePayload,
): Promise<TrackIssueWithStatus> {
  const db = getDb();
  const id = crypto.randomUUID();
  const identifier = await nextIdentifier(projectId);
  const now = nowIso();

  // Si no se provee status, tomar el primero del proyecto
  let statusId = payload.statusId ?? null;
  if (!statusId) {
    const first = (await db
      .prepare(
        'SELECT id FROM track_statuses WHERE project_id = ? ORDER BY position ASC LIMIT 1',
      )
      .get(projectId)) as { id: string } | undefined;
    statusId = first?.id ?? null;
  }

  await db
    .prepare(
      'INSERT INTO track_issues (id, project_id, identifier, title, description, status_id, priority, assignee_id, creator_id, cycle_id, estimate, parent_id, start_date, due_date, labels, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
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
      labelsToJson(payload.labels),
      now,
      now,
    );

  await createIssueActivity(id, creatorId, 'created', {});
  if (payload.parentId) {
    await createIssueActivity(id, creatorId, 'subtask_added', { parentId: payload.parentId });
  }

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

export async function updateIssue(
  id: string,
  payload: IssueUpdatePayload,
  actorId?: string,
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
  // Sin activity type dedicado en el CHECK de track_issue_activity: se
  // actualiza la columna sin registrar actividad (igual que parent_id).
  if (payload.startDate !== undefined && payload.startDate !== existing.start_date) {
    fields.push('start_date = ?');
    args.push(payload.startDate ?? null);
  }
  if (payload.labels !== undefined && labelsToJson(payload.labels) !== existing.labels) {
    fields.push('labels = ?');
    args.push(labelsToJson(payload.labels));
  }

  if (fields.length > 0) {
    fields.push('updated_at = ?');
    args.push(nowIso());
    args.push(id);
    await db.prepare(`UPDATE track_issues SET ${fields.join(', ')} WHERE id = ?`).run(...args);

    if (actorId) {
      for (const activity of activities) {
        await createIssueActivity(id, actorId, activity.type, activity.meta);
      }

      const [actor, project] = await Promise.all([
        getUserById(actorId),
        getProject(existing.project_id),
      ]);
      if (actor && project) {
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
          });
        }
      }
    }
  }

  return getIssue(id);
}

export async function deleteIssue(id: string): Promise<boolean> {
  const db = getDb();
  // Eliminar descendientes en cascada (las filas hijas se borran por FK).
  const children = (await db
    .prepare('SELECT id FROM track_issues WHERE parent_id = ?')
    .all(id)) as Array<{ id: string }>;
  for (const child of children) {
    await db.prepare('DELETE FROM track_issues WHERE id = ?').run(child.id);
  }
  const res = await db.prepare('DELETE FROM track_issues WHERE id = ?').run(id);
  return res.changes > 0;
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

  await createIssueActivity(issueId, userId, 'comment', { commentId: id, body: payload.body.trim() });

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
    });
  }

  return comment;
}

export async function deleteIssueComment(id: string): Promise<boolean> {
  const res = await getDb().prepare('DELETE FROM track_issue_comments WHERE id = ?').run(id);
  return res.changes > 0;
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

export async function deleteIssueRelation(id: string, issueId: string, userId: string): Promise<boolean> {
  const db = getDb();
  const row = (await db
    .prepare('SELECT issue_id, related_issue_id, type FROM track_issue_relations WHERE id = ?')
    .get(id)) as { issue_id: string; related_issue_id: string; type: string } | undefined;
  if (!row) return false;
  const otherIssueId = row.issue_id === issueId ? row.related_issue_id : row.issue_id;
  const related = (await db.prepare('SELECT identifier, title FROM track_issues WHERE id = ?').get(otherIssueId)) as
    | { identifier: string; title: string }
    | undefined;
  const res = await db.prepare('DELETE FROM track_issue_relations WHERE id = ?').run(id);
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

export async function deleteIssueAttachment(id: string): Promise<boolean> {
  const res = await getDb().prepare('DELETE FROM track_issue_attachments WHERE id = ?').run(id);
  return res.changes > 0;
}

// ---------- Activity ----------

export async function listIssueActivities(issueId: string): Promise<TrackIssueActivityWithAuthor[]> {
  return (await getDb()
    .prepare(
      `SELECT a.*, u.name AS user_name, u.email AS user_email
       FROM track_issue_activities a
       JOIN users u ON u.id = a.user_id
       WHERE a.issue_id = ?
       UNION ALL
       SELECT c.id, c.issue_id, c.user_id, 'comment' AS type,
         json_object('commentId', c.id, 'body', c.body) AS meta,
         c.created_at, u.name AS user_name, u.email AS user_email
       FROM track_issue_comments c
       JOIN users u ON u.id = c.user_id
       WHERE c.issue_id = ?
         AND c.id NOT IN (
           SELECT json_extract(meta, '$.commentId')
           FROM track_issue_activities
           WHERE issue_id = ? AND type = 'comment'
         )
       ORDER BY created_at ASC`,
    )
    .all(issueId, issueId, issueId)) as TrackIssueActivityWithAuthor[];
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
