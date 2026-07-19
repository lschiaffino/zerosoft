/**
 * Track — lógica de negocio para proyectos, status, cycles e issues.
 *
 * Nota: el módulo `lib/track.ts` ya existe para el tracking de clicks de
 * links, por lo que este feature vive en `lib/track-data.ts`.
 */
import { getDb, getClient, txDb } from './db';
import type {
  TrackCycleRow,
  TrackIssueCommentRow,
  TrackIssueRow,
  TrackIssueViewRow,
  TrackProjectRow,
  TrackStatusRow,
  UserRow,
} from './db';
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
}

export interface TrackProjectWithStats extends TrackProjectRow {
  open_issues: number;
}

export interface TrackCommentWithAuthor extends TrackIssueCommentRow {
  user_name: string | null;
  user_email: string;
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
  view_type: 'list' | 'board' | 'calendar';
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
      c.name AS cycle_name
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
      'INSERT INTO track_issues (id, project_id, identifier, title, description, status_id, priority, assignee_id, creator_id, cycle_id, estimate, parent_id, due_date, labels, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
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
      payload.dueDate ?? null,
      labelsToJson(payload.labels),
      now,
      now,
    );

  return (await getIssue(id)) as TrackIssueWithStatus;
}

export async function updateIssue(
  id: string,
  payload: IssueUpdatePayload,
): Promise<TrackIssueWithStatus | undefined> {
  const db = getDb();
  const existing = await getIssue(id);
  if (!existing) return undefined;

  const fields: string[] = [];
  const args: Array<string | number | null> = [];

  if (payload.title !== undefined) {
    fields.push('title = ?');
    args.push(payload.title.trim());
  }
  if (payload.description !== undefined) {
    fields.push('description = ?');
    args.push(blocksToJson(payload.description));
  }
  if (payload.statusId !== undefined) {
    fields.push('status_id = ?');
    args.push(payload.statusId ?? null);
  }
  if (payload.priority !== undefined) {
    fields.push('priority = ?');
    args.push(payload.priority);
  }
  if (payload.assigneeId !== undefined) {
    fields.push('assignee_id = ?');
    args.push(payload.assigneeId ?? null);
  }
  if (payload.cycleId !== undefined) {
    fields.push('cycle_id = ?');
    args.push(payload.cycleId ?? null);
  }
  if (payload.estimate !== undefined) {
    fields.push('estimate = ?');
    args.push(payload.estimate ?? null);
  }
  if (payload.parentId !== undefined) {
    fields.push('parent_id = ?');
    args.push(payload.parentId ?? null);
  }
  if (payload.dueDate !== undefined) {
    fields.push('due_date = ?');
    args.push(payload.dueDate ?? null);
  }
  if (payload.labels !== undefined) {
    fields.push('labels = ?');
    args.push(labelsToJson(payload.labels));
  }

  if (fields.length > 0) {
    fields.push('updated_at = ?');
    args.push(nowIso());
    args.push(id);
    await db.prepare(`UPDATE track_issues SET ${fields.join(', ')} WHERE id = ?`).run(...args);
  }

  return getIssue(id);
}

export async function deleteIssue(id: string): Promise<boolean> {
  const res = await getDb().prepare('DELETE FROM track_issues WHERE id = ?').run(id);
  return res.changes > 0;
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

  return (await db
    .prepare(
      `SELECT c.*, u.name AS user_name, u.email AS user_email
       FROM track_issue_comments c
       JOIN users u ON u.id = c.user_id
       WHERE c.id = ?`,
    )
    .get(id)) as TrackCommentWithAuthor;
}

export async function deleteIssueComment(id: string): Promise<boolean> {
  const res = await getDb().prepare('DELETE FROM track_issue_comments WHERE id = ?').run(id);
  return res.changes > 0;
}

// ---------- Relations ----------

export async function listIssueRelations(issueId: string): Promise<unknown[]> {
  return (await getDb()
    .prepare(
      `SELECT r.*, i.identifier, i.title
       FROM track_issue_relations r
       JOIN track_issues i ON i.id = r.related_issue_id
       WHERE r.issue_id = ?
       ORDER BY r.created_at DESC`,
    )
    .all(issueId)) as unknown[];
}

export async function createIssueRelation(
  issueId: string,
  relatedIssueId: string,
  type: 'blocks' | 'related' | 'duplicates' = 'related',
): Promise<unknown> {
  const db = getDb();
  const id = crypto.randomUUID();
  await db
    .prepare(
      'INSERT INTO track_issue_relations (id, issue_id, related_issue_id, type) VALUES (?, ?, ?, ?)',
    )
    .run(id, issueId, relatedIssueId, type);
  return listIssueRelations(issueId);
}

export async function deleteIssueRelation(id: string): Promise<boolean> {
  const res = await getDb().prepare('DELETE FROM track_issue_relations WHERE id = ?').run(id);
  return res.changes > 0;
}

// ---------- Bloques de descripción ----------

export interface TrackTextBlock {
  type: 'text';
  text: string;
}

export type TrackCommentBlock = TrackTextBlock;
