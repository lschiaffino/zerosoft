/**
 * Time: clientes, proyectos, tareas y entradas de horas. Server-only.
 *
 * Alcance:
 * - Todo se lee y se escribe dentro del workspace del actor (`ws`).
 * - Cada persona carga, edita y borra solo sus entradas.
 * - Clientes, proyectos, tareas y la moneda los maneja quien administra.
 * - Los reportes de un miembro muestran solo sus horas; los de un admin, las de todos.
 */
import { randomBytes } from 'crypto';
import { getDb } from '../db';
import { CURRENCIES, MAX_ENTRY_MINUTES, MAX_NOTES, TimeError, cleanName, isIsoDate, liveMinutes, type Currency, type ReportEntry, type TimeActor } from './types';

const now = () => new Date().toISOString();

export function newTimeId(prefix: 'tcl' | 'tpr' | 'ttk' | 'ten'): string {
  return `${prefix}_${randomBytes(9).toString('base64url')}`;
}

function requireAdmin(actor: TimeActor) {
  if (!actor.admin) throw new TimeError('forbidden', 403);
}

/* ---------- Clientes ---------- */

export interface ClientDto {
  id: string;
  name: string;
  archived: boolean;
  projects: number;
}

export async function listClients(actor: TimeActor): Promise<ClientDto[]> {
  const rows = (await getDb()
    .prepare(
      `SELECT c.id, c.name, c.archived_at, (SELECT COUNT(*) FROM time_projects p WHERE p.client_id = c.id) AS projects
       FROM time_clients c WHERE c.workspace_id = ? ORDER BY c.archived_at IS NOT NULL, c.name COLLATE NOCASE`,
    )
    .all(actor.ws)) as Array<{ id: string; name: string; archived_at: string | null; projects: number }>;
  return rows.map((r) => ({ id: r.id, name: r.name, archived: Boolean(r.archived_at), projects: Number(r.projects) }));
}

async function clientRow(ws: string, id: string) {
  return (await getDb().prepare('SELECT id, name, archived_at FROM time_clients WHERE id = ? AND workspace_id = ?').get(id, ws)) as
    | { id: string; name: string; archived_at: string | null }
    | undefined;
}

export async function createClient(actor: TimeActor, rawName: string): Promise<ClientDto> {
  requireAdmin(actor);
  const name = cleanName(rawName);
  if (!name) throw new TimeError('invalid_input', 400);
  const dup = await getDb().prepare('SELECT id FROM time_clients WHERE workspace_id = ? AND name = ? COLLATE NOCASE').get(actor.ws, name);
  if (dup) throw new TimeError('duplicate', 409);
  const id = newTimeId('tcl');
  const t = now();
  await getDb().prepare('INSERT INTO time_clients (id, workspace_id, name, created_at, updated_at) VALUES (?, ?, ?, ?, ?)').run(id, actor.ws, name, t, t);
  return { id, name, archived: false, projects: 0 };
}

export async function updateClient(actor: TimeActor, id: string, patch: { name?: string; archived?: boolean }): Promise<void> {
  requireAdmin(actor);
  const row = await clientRow(actor.ws, id);
  if (!row) throw new TimeError('not_found', 404);
  const name = patch.name !== undefined ? cleanName(patch.name) : row.name;
  if (!name) throw new TimeError('invalid_input', 400);
  if (name.toLowerCase() !== row.name.toLowerCase()) {
    const dup = await getDb().prepare('SELECT id FROM time_clients WHERE workspace_id = ? AND name = ? COLLATE NOCASE AND id != ?').get(actor.ws, name, id);
    if (dup) throw new TimeError('duplicate', 409);
  }
  const archived = patch.archived === undefined ? row.archived_at : patch.archived ? (row.archived_at ?? now()) : null;
  await getDb().prepare('UPDATE time_clients SET name = ?, archived_at = ?, updated_at = ? WHERE id = ? AND workspace_id = ?').run(name, archived, now(), id, actor.ws);
}

/** Borra un cliente; sus proyectos quedan sin cliente. */
export async function deleteClient(actor: TimeActor, id: string): Promise<void> {
  requireAdmin(actor);
  if (!(await clientRow(actor.ws, id))) throw new TimeError('not_found', 404);
  await getDb().prepare('UPDATE time_projects SET client_id = NULL WHERE client_id = ? AND workspace_id = ?').run(id, actor.ws);
  await getDb().prepare('DELETE FROM time_clients WHERE id = ? AND workspace_id = ?').run(id, actor.ws);
}

/* ---------- Tareas ---------- */

export interface TaskDto {
  id: string;
  name: string;
  billable: boolean;
  archived: boolean;
}

const DEFAULT_TASKS: Record<'en' | 'es' | 'pt', Array<[string, boolean]>> = {
  en: [
    ['Design', true],
    ['Development', true],
    ['Meetings', true],
    ['Project management', true],
    ['Admin', false],
  ],
  es: [
    ['Diseño', true],
    ['Desarrollo', true],
    ['Reuniones', true],
    ['Gestión del proyecto', true],
    ['Administración', false],
  ],
  pt: [
    ['Design', true],
    ['Desenvolvimento', true],
    ['Reuniões', true],
    ['Gestão do projeto', true],
    ['Administração', false],
  ],
};

/** Un workspace sin tareas arranca con cinco, en el idioma de quien abre Time por primera vez. */
export async function ensureDefaultTasks(ws: string, locale: string): Promise<void> {
  const db = getDb();
  const any = await db.prepare('SELECT 1 AS x FROM time_tasks WHERE workspace_id = ? LIMIT 1').get(ws);
  if (any) return;
  const list = DEFAULT_TASKS[(locale in DEFAULT_TASKS ? locale : 'en') as 'en' | 'es' | 'pt'];
  const t = now();
  for (const [i, [name, billable]] of list.entries()) {
    // Id fijo por workspace y posición: dos pedidos a la vez no duplican las tareas.
    await db.prepare('INSERT OR IGNORE INTO time_tasks (id, workspace_id, name, billable, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)').run(`ttk_${ws}_${i}`, ws, name, billable ? 1 : 0, t, t);
  }
}

export async function listTasks(actor: TimeActor): Promise<TaskDto[]> {
  const rows = (await getDb().prepare('SELECT id, name, billable, archived_at FROM time_tasks WHERE workspace_id = ? ORDER BY archived_at IS NOT NULL, name COLLATE NOCASE').all(actor.ws)) as Array<{
    id: string;
    name: string;
    billable: number;
    archived_at: string | null;
  }>;
  return rows.map((r) => ({ id: r.id, name: r.name, billable: Boolean(r.billable), archived: Boolean(r.archived_at) }));
}

async function taskRow(ws: string, id: string) {
  return (await getDb().prepare('SELECT id, name, billable, archived_at FROM time_tasks WHERE id = ? AND workspace_id = ?').get(id, ws)) as
    | { id: string; name: string; billable: number; archived_at: string | null }
    | undefined;
}

export async function createTask(actor: TimeActor, input: { name: string; billable?: boolean }): Promise<TaskDto> {
  requireAdmin(actor);
  const name = cleanName(input.name);
  if (!name) throw new TimeError('invalid_input', 400);
  const dup = await getDb().prepare('SELECT id FROM time_tasks WHERE workspace_id = ? AND name = ? COLLATE NOCASE').get(actor.ws, name);
  if (dup) throw new TimeError('duplicate', 409);
  const id = newTimeId('ttk');
  const t = now();
  const billable = input.billable ?? true;
  await getDb()
    .prepare('INSERT INTO time_tasks (id, workspace_id, name, billable, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)')
    .run(id, actor.ws, name, billable ? 1 : 0, t, t);
  return { id, name, billable, archived: false };
}

export async function updateTask(actor: TimeActor, id: string, patch: { name?: string; billable?: boolean; archived?: boolean }): Promise<void> {
  requireAdmin(actor);
  const row = await taskRow(actor.ws, id);
  if (!row) throw new TimeError('not_found', 404);
  const name = patch.name !== undefined ? cleanName(patch.name) : row.name;
  if (!name) throw new TimeError('invalid_input', 400);
  if (name.toLowerCase() !== row.name.toLowerCase()) {
    const dup = await getDb().prepare('SELECT id FROM time_tasks WHERE workspace_id = ? AND name = ? COLLATE NOCASE AND id != ?').get(actor.ws, name, id);
    if (dup) throw new TimeError('duplicate', 409);
  }
  const billable = patch.billable ?? Boolean(row.billable);
  const archived = patch.archived === undefined ? row.archived_at : patch.archived ? (row.archived_at ?? now()) : null;
  await getDb()
    .prepare('UPDATE time_tasks SET name = ?, billable = ?, archived_at = ?, updated_at = ? WHERE id = ? AND workspace_id = ?')
    .run(name, billable ? 1 : 0, archived, now(), id, actor.ws);
}

/** Una tarea con horas no se borra (se archiva). */
export async function deleteTask(actor: TimeActor, id: string): Promise<void> {
  requireAdmin(actor);
  if (!(await taskRow(actor.ws, id))) throw new TimeError('not_found', 404);
  const used = await getDb().prepare('SELECT 1 AS x FROM time_entries WHERE task_id = ? AND workspace_id = ? LIMIT 1').get(id, actor.ws);
  if (used) throw new TimeError('in_use', 409);
  await getDb().prepare('DELETE FROM time_tasks WHERE id = ? AND workspace_id = ?').run(id, actor.ws);
}

/* ---------- Proyectos ---------- */

export interface ProjectDto {
  id: string;
  name: string;
  code: string;
  clientId: string | null;
  clientName: string | null;
  billable: boolean;
  rateCents: number | null;
  budgetMinutes: number | null;
  archived: boolean;
  /** Minutos cargados por todo el equipo (para el presupuesto). */
  spentMinutes: number;
  updatedAt: string;
}

interface ProjectRow {
  id: string;
  name: string;
  code: string;
  client_id: string | null;
  client_name: string | null;
  billable: number;
  rate_cents: number | null;
  budget_minutes: number | null;
  archived_at: string | null;
  spent: number | null;
  updated_at: string;
}

const PROJECT_SELECT = `SELECT p.id, p.name, p.code, p.client_id, c.name AS client_name, p.billable, p.rate_cents, p.budget_minutes, p.archived_at, p.updated_at,
  (SELECT COALESCE(SUM(e.minutes), 0) FROM time_entries e WHERE e.project_id = p.id) AS spent
  FROM time_projects p LEFT JOIN time_clients c ON c.id = p.client_id`;

function projectDto(r: ProjectRow): ProjectDto {
  return {
    id: r.id,
    name: r.name,
    code: r.code,
    clientId: r.client_id,
    clientName: r.client_name,
    billable: Boolean(r.billable),
    rateCents: r.rate_cents === null ? null : Number(r.rate_cents),
    budgetMinutes: r.budget_minutes === null ? null : Number(r.budget_minutes),
    archived: Boolean(r.archived_at),
    spentMinutes: Number(r.spent ?? 0),
    updatedAt: r.updated_at,
  };
}

export async function listProjects(actor: TimeActor, opts: { q?: string } = {}): Promise<ProjectDto[]> {
  const q = (opts.q ?? '').trim();
  const like = `%${q.replace(/[\\%_]/g, (ch) => `\\${ch}`)}%`;
  const rows = (await getDb()
    .prepare(
      `${PROJECT_SELECT} WHERE p.workspace_id = ? ${q ? `AND (p.name LIKE ? ESCAPE '\\' OR p.code LIKE ? ESCAPE '\\' OR c.name LIKE ? ESCAPE '\\')` : ''}
       ORDER BY p.archived_at IS NOT NULL, c.name IS NULL, c.name COLLATE NOCASE, p.name COLLATE NOCASE`,
    )
    .all(...(q ? [actor.ws, like, like, like] : [actor.ws]))) as unknown as ProjectRow[];
  return rows.map(projectDto);
}

export async function getProject(actor: TimeActor, id: string): Promise<ProjectDto | null> {
  const row = (await getDb().prepare(`${PROJECT_SELECT} WHERE p.id = ? AND p.workspace_id = ?`).get(id, actor.ws)) as unknown as ProjectRow | undefined;
  return row ? projectDto(row) : null;
}

export interface ProjectInput {
  name?: string;
  code?: string;
  clientId?: string | null;
  billable?: boolean;
  rateCents?: number | null;
  budgetMinutes?: number | null;
  archived?: boolean;
}

async function checkClient(ws: string, clientId: string | null | undefined): Promise<string | null> {
  if (!clientId) return null;
  if (!(await clientRow(ws, clientId))) throw new TimeError('not_found', 404);
  return clientId;
}

export async function createProject(actor: TimeActor, input: ProjectInput): Promise<ProjectDto> {
  requireAdmin(actor);
  const name = cleanName(input.name);
  if (!name) throw new TimeError('invalid_input', 400);
  const clientId = await checkClient(actor.ws, input.clientId);
  const id = newTimeId('tpr');
  const t = now();
  await getDb()
    .prepare('INSERT INTO time_projects (id, workspace_id, client_id, name, code, billable, rate_cents, budget_minutes, created_by, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)')
    .run(id, actor.ws, clientId, name, cleanName(input.code, 24), input.billable === false ? 0 : 1, input.rateCents ?? null, input.budgetMinutes ?? null, actor.person, t, t);
  return (await getProject(actor, id))!;
}

export async function updateProject(actor: TimeActor, id: string, patch: ProjectInput): Promise<ProjectDto> {
  requireAdmin(actor);
  const cur = await getProject(actor, id);
  if (!cur) throw new TimeError('not_found', 404);
  const name = patch.name !== undefined ? cleanName(patch.name) : cur.name;
  if (!name) throw new TimeError('invalid_input', 400);
  const clientId = patch.clientId !== undefined ? await checkClient(actor.ws, patch.clientId) : cur.clientId;
  const archivedAt = patch.archived === undefined ? (cur.archived ? 'keep' : null) : patch.archived ? 'set' : null;
  await getDb()
    .prepare(
      `UPDATE time_projects SET name = ?, code = ?, client_id = ?, billable = ?, rate_cents = ?, budget_minutes = ?,
       archived_at = CASE ? WHEN 'keep' THEN archived_at WHEN 'set' THEN COALESCE(archived_at, ?) ELSE NULL END, updated_at = ?
       WHERE id = ? AND workspace_id = ?`,
    )
    .run(
      name,
      patch.code !== undefined ? cleanName(patch.code, 24) : cur.code,
      clientId,
      (patch.billable ?? cur.billable) ? 1 : 0,
      patch.rateCents !== undefined ? patch.rateCents : cur.rateCents,
      patch.budgetMinutes !== undefined ? patch.budgetMinutes : cur.budgetMinutes,
      archivedAt ?? 'clear',
      now(),
      now(),
      id,
      actor.ws,
    );
  return (await getProject(actor, id))!;
}

/** Borra el proyecto y sus horas. La interfaz pide confirmarlo y ofrece archivar. */
export async function deleteProject(actor: TimeActor, id: string): Promise<void> {
  requireAdmin(actor);
  if (!(await getProject(actor, id))) throw new TimeError('not_found', 404);
  await getDb().prepare('DELETE FROM time_entries WHERE project_id = ? AND workspace_id = ?').run(id, actor.ws);
  await getDb().prepare('DELETE FROM time_projects WHERE id = ? AND workspace_id = ?').run(id, actor.ws);
}

/* ---------- Entradas ---------- */

export interface EntryDto {
  id: string;
  date: string;
  projectId: string;
  projectName: string;
  clientName: string | null;
  taskId: string;
  taskName: string;
  notes: string;
  minutes: number;
  billable: boolean;
  /** ISO del arranque del cronómetro si corre. */
  timerStartedAt: string | null;
}

interface EntryRow {
  id: string;
  spent_date: string;
  project_id: string;
  project_name: string;
  client_name: string | null;
  task_id: string;
  task_name: string;
  notes: string;
  minutes: number;
  billable: number;
  timer_started_at: string | null;
}

const ENTRY_SELECT = `SELECT e.id, e.spent_date, e.project_id, p.name AS project_name, c.name AS client_name, e.task_id, t.name AS task_name,
  e.notes, e.minutes, e.billable, e.timer_started_at
  FROM time_entries e JOIN time_projects p ON p.id = e.project_id LEFT JOIN time_clients c ON c.id = p.client_id JOIN time_tasks t ON t.id = e.task_id`;

function entryDto(r: EntryRow): EntryDto {
  return {
    id: r.id,
    date: r.spent_date,
    projectId: r.project_id,
    projectName: r.project_name,
    clientName: r.client_name,
    taskId: r.task_id,
    taskName: r.task_name,
    notes: r.notes,
    minutes: Number(r.minutes),
    billable: Boolean(r.billable),
    timerStartedAt: r.timer_started_at,
  };
}

/** Entradas de la persona entre dos fechas (inclusive), más nuevas primero dentro de cada día. */
export async function listMyEntries(actor: TimeActor, from: string, to: string): Promise<EntryDto[]> {
  if (!isIsoDate(from) || !isIsoDate(to)) throw new TimeError('invalid_input', 400);
  const rows = (await getDb()
    .prepare(`${ENTRY_SELECT} WHERE e.workspace_id = ? AND e.person_id = ? AND e.spent_date BETWEEN ? AND ? ORDER BY e.spent_date, e.created_at`)
    .all(actor.ws, actor.person, from, to)) as unknown as EntryRow[];
  return rows.map(entryDto);
}

async function myEntryRow(actor: TimeActor, id: string) {
  return (await getDb().prepare('SELECT id, project_id, task_id, minutes, timer_started_at FROM time_entries WHERE id = ? AND workspace_id = ? AND person_id = ?').get(id, actor.ws, actor.person)) as
    | { id: string; project_id: string; task_id: string; minutes: number; timer_started_at: string | null }
    | undefined;
}

async function activeProjectAndTask(ws: string, projectId: string, taskId: string, allowArchived: { project?: string; task?: string } = {}) {
  const db = getDb();
  const p = (await db.prepare('SELECT id, billable, archived_at FROM time_projects WHERE id = ? AND workspace_id = ?').get(projectId, ws)) as
    | { id: string; billable: number; archived_at: string | null }
    | undefined;
  const t = await taskRow(ws, taskId);
  if (!p || !t) throw new TimeError('not_found', 404);
  if (p.archived_at && allowArchived.project !== projectId) throw new TimeError('project_archived', 409);
  if (t.archived_at && allowArchived.task !== taskId) throw new TimeError('task_archived', 409);
  return { billable: Boolean(p.billable) && Boolean(t.billable) };
}

/** Para el cronómetro de la persona que esté corriendo (si hay), sumando lo que corrió. */
export async function stopRunning(actor: TimeActor, at = Date.now()): Promise<void> {
  const db = getDb();
  const running = (await db
    .prepare('SELECT id, minutes, timer_started_at FROM time_entries WHERE workspace_id = ? AND person_id = ? AND timer_started_at IS NOT NULL')
    .all(actor.ws, actor.person)) as Array<{ id: string; minutes: number; timer_started_at: string }>;
  for (const r of running) {
    const minutes = liveMinutes({ minutes: Number(r.minutes), timerStartedAt: r.timer_started_at }, at);
    // Compara el arranque: si otro pedido ya lo paró, no se suma dos veces.
    await db
      .prepare('UPDATE time_entries SET minutes = ?, timer_started_at = NULL, updated_at = ? WHERE id = ? AND timer_started_at = ?')
      .run(minutes, new Date(at).toISOString(), r.id, r.timer_started_at);
  }
}

export interface EntryInput {
  date: string;
  projectId: string;
  taskId: string;
  notes?: string;
  /** null o ausente con `start`: arranca el cronómetro en 0. */
  minutes?: number | null;
  start?: boolean;
}

export async function createEntry(actor: TimeActor, input: EntryInput): Promise<EntryDto> {
  if (!isIsoDate(input.date)) throw new TimeError('invalid_input', 400);
  const minutes = input.minutes ?? 0;
  if (!Number.isInteger(minutes) || minutes < 0) throw new TimeError('invalid_input', 400);
  if (minutes > MAX_ENTRY_MINUTES) throw new TimeError('too_long', 400);
  const { billable } = await activeProjectAndTask(actor.ws, input.projectId, input.taskId);
  const start = Boolean(input.start) || input.minutes == null;
  if (start) await stopRunning(actor);
  const id = newTimeId('ten');
  const t = now();
  await getDb()
    .prepare(
      `INSERT INTO time_entries (id, workspace_id, person_id, project_id, task_id, spent_date, minutes, notes, billable, timer_started_at, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(id, actor.ws, actor.person, input.projectId, input.taskId, input.date, minutes, String(input.notes ?? '').slice(0, MAX_NOTES), billable ? 1 : 0, start ? t : null, t, t);
  return (await getEntry(actor, id))!;
}

export async function getEntry(actor: TimeActor, id: string): Promise<EntryDto | null> {
  const row = (await getDb().prepare(`${ENTRY_SELECT} WHERE e.id = ? AND e.workspace_id = ? AND e.person_id = ?`).get(id, actor.ws, actor.person)) as unknown as EntryRow | undefined;
  return row ? entryDto(row) : null;
}

export interface EntryPatch {
  date?: string;
  projectId?: string;
  taskId?: string;
  notes?: string;
  minutes?: number;
  /** true arranca el cronómetro de esta entrada; false lo para. */
  running?: boolean;
}

export async function updateEntry(actor: TimeActor, id: string, patch: EntryPatch): Promise<EntryDto> {
  const row = await myEntryRow(actor, id);
  if (!row) throw new TimeError('not_found', 404);
  if (patch.date !== undefined && !isIsoDate(patch.date)) throw new TimeError('invalid_input', 400);
  if (patch.minutes !== undefined && (!Number.isInteger(patch.minutes) || patch.minutes < 0)) throw new TimeError('invalid_input', 400);
  if (patch.minutes !== undefined && patch.minutes > MAX_ENTRY_MINUTES) throw new TimeError('too_long', 400);
  const db = getDb();
  const sets: string[] = [];
  const args: Array<string | number | null> = [];
  if (patch.projectId !== undefined || patch.taskId !== undefined) {
    const projectId = patch.projectId ?? row.project_id;
    const taskId = patch.taskId ?? row.task_id;
    // Una entrada vieja de un proyecto archivado se puede seguir editando sin moverla.
    const { billable } = await activeProjectAndTask(actor.ws, projectId, taskId, { project: row.project_id, task: row.task_id });
    sets.push('project_id = ?', 'task_id = ?', 'billable = ?');
    args.push(projectId, taskId, billable ? 1 : 0);
  }
  if (patch.date !== undefined) {
    sets.push('spent_date = ?');
    args.push(patch.date);
  }
  if (patch.notes !== undefined) {
    sets.push('notes = ?');
    args.push(String(patch.notes).slice(0, MAX_NOTES));
  }
  if (patch.running === true && !row.timer_started_at) {
    await stopRunning(actor);
    sets.push('timer_started_at = ?');
    args.push(now());
  }
  if (patch.minutes !== undefined) {
    // Escribir la duración a mano reemplaza lo que corrió; el cronómetro sigue desde ahí si corre.
    sets.push('minutes = ?');
    args.push(patch.minutes);
    if (row.timer_started_at && patch.running !== false) {
      sets.push('timer_started_at = ?');
      args.push(now());
    }
  }
  if (sets.length) {
    sets.push('updated_at = ?');
    args.push(now());
    await db.prepare(`UPDATE time_entries SET ${sets.join(', ')} WHERE id = ? AND workspace_id = ? AND person_id = ?`).run(...args, id, actor.ws, actor.person);
  }
  if (patch.running === false && row.timer_started_at) {
    const fresh = await myEntryRow(actor, id);
    if (fresh?.timer_started_at) {
      const minutes = liveMinutes({ minutes: Number(fresh.minutes), timerStartedAt: fresh.timer_started_at }, Date.now());
      await db.prepare('UPDATE time_entries SET minutes = ?, timer_started_at = NULL, updated_at = ? WHERE id = ? AND timer_started_at = ?').run(minutes, now(), id, fresh.timer_started_at);
    }
  }
  return (await getEntry(actor, id))!;
}

export async function deleteEntry(actor: TimeActor, id: string): Promise<void> {
  const row = await myEntryRow(actor, id);
  if (!row) throw new TimeError('not_found', 404);
  await getDb().prepare('DELETE FROM time_entries WHERE id = ? AND workspace_id = ? AND person_id = ?').run(id, actor.ws, actor.person);
}

/* ---------- Ajustes y reportes ---------- */

export async function getCurrency(ws: string): Promise<Currency> {
  const row = (await getDb().prepare('SELECT currency FROM time_settings WHERE workspace_id = ?').get(ws)) as { currency: string } | undefined;
  return (CURRENCIES as readonly string[]).includes(row?.currency ?? '') ? (row!.currency as Currency) : 'USD';
}

export async function setCurrency(actor: TimeActor, currency: string): Promise<void> {
  requireAdmin(actor);
  if (!(CURRENCIES as readonly string[]).includes(currency)) throw new TimeError('invalid_input', 400);
  await getDb()
    .prepare('INSERT INTO time_settings (workspace_id, currency, updated_at) VALUES (?, ?, ?) ON CONFLICT(workspace_id) DO UPDATE SET currency = excluded.currency, updated_at = excluded.updated_at')
    .run(actor.ws, currency, now());
}

export interface ReportFilter {
  from: string;
  to: string;
  projectId?: string;
  clientId?: string;
  personId?: string;
}

/**
 * Entradas del reporte con nombres. Un miembro ve solo las suyas; un admin, las
 * de todo el workspace (o las de una persona con `personId`). El cronómetro que
 * corre cuenta hasta ahora.
 */
export async function reportEntries(actor: TimeActor, f: ReportFilter): Promise<ReportEntry[]> {
  if (!isIsoDate(f.from) || !isIsoDate(f.to) || f.from > f.to) throw new TimeError('invalid_input', 400);
  const where = ['e.workspace_id = ?', 'e.spent_date BETWEEN ? AND ?'];
  const args: string[] = [actor.ws, f.from, f.to];
  const person = actor.admin ? f.personId : actor.person;
  if (person) {
    where.push('e.person_id = ?');
    args.push(person);
  }
  if (f.projectId) {
    where.push('e.project_id = ?');
    args.push(f.projectId);
  }
  if (f.clientId) {
    where.push('p.client_id = ?');
    args.push(f.clientId);
  }
  const rows = (await getDb()
    .prepare(
      `SELECT e.id, e.spent_date, e.person_id, COALESCE(NULLIF(u.name, ''), u.email, '') AS person_name, e.project_id, p.name AS project_name,
         p.client_id, c.name AS client_name, e.task_id, t.name AS task_name, e.notes, e.minutes, e.billable, e.timer_started_at, p.rate_cents
       FROM time_entries e JOIN time_projects p ON p.id = e.project_id LEFT JOIN time_clients c ON c.id = p.client_id
       JOIN time_tasks t ON t.id = e.task_id LEFT JOIN users u ON u.id = e.person_id
       WHERE ${where.join(' AND ')} ORDER BY e.spent_date, e.created_at`,
    )
    .all(...args)) as Array<Record<string, unknown>>;
  const at = Date.now();
  return rows.map((r) => ({
    id: String(r.id),
    date: String(r.spent_date),
    personId: String(r.person_id),
    personName: String(r.person_name ?? ''),
    projectId: String(r.project_id),
    projectName: String(r.project_name),
    clientId: (r.client_id as string | null) ?? null,
    clientName: (r.client_name as string | null) ?? null,
    taskId: String(r.task_id),
    taskName: String(r.task_name),
    notes: String(r.notes ?? ''),
    minutes: liveMinutes({ minutes: Number(r.minutes), timerStartedAt: (r.timer_started_at as string | null) ?? null }, at),
    billable: Boolean(r.billable),
    rateCents: r.rate_cents === null || r.rate_cents === undefined ? null : Number(r.rate_cents),
  }));
}

/** Para Cmd+K: proyectos por nombre, código o cliente. */
export async function searchTime(actor: TimeActor, q: string, limit = 8): Promise<Array<{ id: string; label: string; meta: string; href: string }>> {
  if (!q.trim()) return [];
  const rows = await listProjects(actor, { q });
  return rows.slice(0, limit).map((p) => ({ id: p.id, label: p.name, meta: p.clientName ? `Time · ${p.clientName}` : 'Time', href: `/app/time/projects/${p.id}` }));
}
