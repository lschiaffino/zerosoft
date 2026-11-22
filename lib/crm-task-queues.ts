/**
 * CRM, colas de tareas con nombre (bloque A3), como las de HubSpot: una
 * persona arma una cola ("Llamadas de la mañana"), le suma tareas y después
 * la trabaja una por una en la cola de trabajo. Server-only.
 *
 * Quién ve una cola: la privada (`shared = 0`) solo quien la creó; la
 * compartida, todo el workspace. Quién la edita o la borra: quien la creó, o
 * un admin si es compartida. Una tarea está en una sola cola; quien no ve esa
 * cola ve la tarea sin cola (ni el nombre ni el id). Todo va acotado al
 * workspace (`user_id`).
 */
import crypto from 'node:crypto';
import { getDb, type Db } from './db';
import type { CrmTaskQueueRow } from './schema/types';
import { roleAtLeast, type TeamRole } from './teams';

export interface QueueViewer {
  workspaceId: string;
  personId: string;
  role: TeamRole;
}

export interface TaskQueueDto {
  id: string;
  name: string;
  shared: boolean;
  mine: boolean;
  canEdit: boolean;
  /** Tareas abiertas en la cola que quien mira ve (lo completa la página). */
  openCount?: number;
}

export const MAX_QUEUES = 100;

export function sessionQueueViewer(user: { id: string; role: TeamRole; actingUser?: { id: string } | null }): QueueViewer {
  return { workspaceId: user.id, personId: user.actingUser?.id ?? user.id, role: user.role };
}

function isAdmin(viewer: QueueViewer): boolean {
  return viewer.personId === viewer.workspaceId || roleAtLeast(viewer.role, 'admin');
}

export function canSeeQueue(row: Pick<CrmTaskQueueRow, 'person_id' | 'shared'>, viewer: QueueViewer): boolean {
  return row.shared === 1 || row.person_id === viewer.personId;
}

function canEditQueue(row: Pick<CrmTaskQueueRow, 'person_id' | 'shared'>, viewer: QueueViewer): boolean {
  return row.person_id === viewer.personId || (row.shared === 1 && isAdmin(viewer));
}

function toDto(row: CrmTaskQueueRow, viewer: QueueViewer): TaskQueueDto {
  return {
    id: row.id,
    name: row.name,
    shared: row.shared === 1,
    mine: row.person_id === viewer.personId,
    canEdit: canEditQueue(row, viewer),
  };
}

/** Las colas que la persona ve, por nombre. */
export async function listQueues(viewer: QueueViewer, db: Db = getDb()): Promise<TaskQueueDto[]> {
  const rows = (await db
    .prepare('SELECT * FROM crm_task_queues WHERE user_id = ? AND (shared = 1 OR person_id = ?) ORDER BY name COLLATE NOCASE ASC, id ASC')
    .all(viewer.workspaceId, viewer.personId)) as CrmTaskQueueRow[];
  return rows.map((r) => toDto(r, viewer));
}

/** Ids de las colas que la persona ve (para filtrar y para esconder las demás). */
export async function visibleQueueIds(viewer: QueueViewer, db: Db = getDb()): Promise<Set<string>> {
  return new Set((await listQueues(viewer, db)).map((q) => q.id));
}

/** La cola si existe en el workspace y la persona la ve; si no, null. */
export async function getQueue(viewer: QueueViewer, id: string, db: Db = getDb()): Promise<TaskQueueDto | null> {
  const row = (await db.prepare('SELECT * FROM crm_task_queues WHERE id = ? AND user_id = ?').get(id, viewer.workspaceId)) as
    | CrmTaskQueueRow
    | undefined;
  return row && canSeeQueue(row, viewer) ? toDto(row, viewer) : null;
}

export type QueueWriteError = 'not_found' | 'forbidden' | 'too_many';

export async function createQueue(
  viewer: QueueViewer,
  input: { name: string; shared?: boolean },
  db: Db = getDb(),
): Promise<{ ok: true; queue: TaskQueueDto } | { ok: false; error: QueueWriteError }> {
  // Tope por persona: las colas privadas de alguien no le quitan lugar a los demás.
  const count = (await db
    .prepare('SELECT COUNT(*) AS c FROM crm_task_queues WHERE user_id = ? AND person_id = ?')
    .get(viewer.workspaceId, viewer.personId)) as { c: number };
  if (Number(count.c) >= MAX_QUEUES) return { ok: false, error: 'too_many' };
  const id = crypto.randomUUID();
  await db
    .prepare('INSERT INTO crm_task_queues (id, user_id, person_id, name, shared) VALUES (?, ?, ?, ?, ?)')
    .run(id, viewer.workspaceId, viewer.personId, input.name.trim().slice(0, 100), input.shared ? 1 : 0);
  const row = (await db.prepare('SELECT * FROM crm_task_queues WHERE id = ?').get(id)) as CrmTaskQueueRow;
  return { ok: true, queue: toDto(row, viewer) };
}

async function editable(
  viewer: QueueViewer,
  id: string,
  db: Db,
): Promise<{ ok: true; row: CrmTaskQueueRow } | { ok: false; error: QueueWriteError }> {
  const row = (await db.prepare('SELECT * FROM crm_task_queues WHERE id = ? AND user_id = ?').get(id, viewer.workspaceId)) as
    | CrmTaskQueueRow
    | undefined;
  // Una cola privada de otra persona no existe para quien mira (ni para un admin).
  if (!row || !canSeeQueue(row, viewer)) return { ok: false, error: 'not_found' };
  if (!canEditQueue(row, viewer)) return { ok: false, error: 'forbidden' };
  return { ok: true, row };
}

export async function updateQueue(
  viewer: QueueViewer,
  id: string,
  patch: { name?: string; shared?: boolean },
  db: Db = getDb(),
): Promise<{ ok: true; queue: TaskQueueDto } | { ok: false; error: QueueWriteError }> {
  const found = await editable(viewer, id, db);
  if (!found.ok) return found;
  const name = patch.name !== undefined ? patch.name.trim().slice(0, 100) : found.row.name;
  const shared = patch.shared !== undefined ? (patch.shared ? 1 : 0) : found.row.shared;
  await db
    .prepare("UPDATE crm_task_queues SET name = ?, shared = ?, updated_at = datetime('now') WHERE id = ? AND user_id = ?")
    .run(name, shared, id, viewer.workspaceId);
  const row = (await db.prepare('SELECT * FROM crm_task_queues WHERE id = ?').get(id)) as CrmTaskQueueRow;
  return { ok: true, queue: toDto(row, viewer) };
}

/** Borra la cola; sus tareas quedan, sin cola. */
export async function deleteQueue(
  viewer: QueueViewer,
  id: string,
  db: Db = getDb(),
): Promise<{ ok: true } | { ok: false; error: QueueWriteError }> {
  const found = await editable(viewer, id, db);
  if (!found.ok) return found;
  await db.prepare('UPDATE crm_activities SET queue_id = NULL WHERE user_id = ? AND queue_id = ?').run(viewer.workspaceId, id);
  await db.prepare('DELETE FROM crm_task_queues WHERE id = ? AND user_id = ?').run(id, viewer.workspaceId);
  return { ok: true };
}

/**
 * Filas de tareas como las ve la persona: la cola que no ve sale vacía (sin
 * id ni nombre). `queue_name` lo completa con el nombre de las que ve.
 */
export async function withQueueNames<T extends { queue_id?: string | null }>(
  viewer: QueueViewer,
  rows: T[],
  db: Db = getDb(),
): Promise<Array<T & { queue_name: string | null }>> {
  if (!rows.length) return rows.map((r) => ({ ...r, queue_name: null }));
  const names = new Map((await listQueues(viewer, db)).map((q) => [q.id, q.name]));
  return rows.map((r) => {
    const name = r.queue_id ? names.get(r.queue_id) : undefined;
    return name !== undefined ? { ...r, queue_name: name } : { ...r, queue_id: null, queue_name: null };
  });
}

/** El viewer de una API key (actúa como la persona que la creó). */
export function apiQueueViewer(auth: { user: { id: string }; personId: string; role: TeamRole }): QueueViewer {
  return { workspaceId: auth.user.id, personId: auth.personId, role: auth.role };
}

/** Las filas sin el id de una cola que la persona no ve (para las respuestas JSON de actividades). */
export async function maskQueueRefs<T extends { queue_id?: string | null }>(viewer: QueueViewer, rows: T[], db: Db = getDb()): Promise<T[]> {
  if (!rows.some((r) => r.queue_id)) return rows;
  const visible = await visibleQueueIds(viewer, db);
  return rows.map((r) => (r.queue_id && !visible.has(r.queue_id) ? { ...r, queue_id: null } : r));
}

/**
 * ¿La persona puede cambiar la cola de esta tarea? Solo si la tarea no está en
 * una cola o está en una que ve: sacar una tarea de la cola privada de otra
 * persona (que ni siquiera ve) no se permite.
 */
export async function canChangeTaskQueue(viewer: QueueViewer, activityId: string, db: Db = getDb()): Promise<boolean> {
  const row = (await db.prepare('SELECT queue_id FROM crm_activities WHERE id = ? AND user_id = ?').get(activityId, viewer.workspaceId)) as
    | { queue_id: string | null }
    | undefined;
  if (!row) return false;
  if (!row.queue_id) return true;
  return (await visibleQueueIds(viewer, db)).has(row.queue_id);
}
