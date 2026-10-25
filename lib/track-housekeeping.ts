/**
 * Track — auto-cierre y auto-archivo por proyecto (como Linear, por team), y
 * cierre automático de cycles vencidos con rollover.
 *
 * - Auto-cierre: los issues en backlog o todo sin cambios hace N meses pasan
 *   a un status cancelado (deja actividad y avisa a los suscriptos). No toca
 *   issues de un cycle en curso ni de un plan planificado o en curso.
 * - Auto-archivo: los issues terminados o cancelados hace N meses se archivan
 *   (salen de las listas; se restauran desde Ajustes › Automatizaciones).
 * - Cycles: un cycle que ya terminó y no se completó se completa solo, y lo
 *   sin terminar pasa al cycle siguiente (si hay uno).
 *
 * Corre en el tick horario, una vez por día y proyecto (claim en
 * housekeeping_day por compare-and-set).
 */
import { getDb } from './db';
import type { TrackCycleRow, TrackProjectRow, TrackStatusRow } from './db';
import { completeCycle, createIssueActivity, getIssue, nextCycle, updateIssue } from './track-data';
import { createIssueStatusChangedNotifications } from './notifications';
import { listIssueSubscriberIds } from './track-subscriptions';
import { monthsAgo } from './track-planning-core';

export interface HousekeepingProject extends TrackProjectRow {
  auto_close_months: number;
  auto_close_status_id: string | null;
  auto_archive_months: number;
  housekeeping_day: string | null;
}

export interface HousekeepingResult {
  closed: number;
  archived: number;
  cyclesCompleted: number;
  rolledOver: number;
}

const BATCH = 200;

async function closeStatus(project: HousekeepingProject): Promise<TrackStatusRow | undefined> {
  const db = getDb();
  if (project.auto_close_status_id) {
    const s = (await db
      .prepare("SELECT * FROM track_statuses WHERE id = ? AND project_id = ? AND category IN ('cancelled', 'done')")
      .get(project.auto_close_status_id, project.id)) as TrackStatusRow | undefined;
    if (s) return s;
  }
  return (await db
    .prepare("SELECT * FROM track_statuses WHERE project_id = ? AND category = 'cancelled' ORDER BY position ASC LIMIT 1")
    .get(project.id)) as TrackStatusRow | undefined;
}

/** Issues que el auto-cierre cerraría hoy (para la vista previa en Ajustes y el cron). */
export async function staleIssueIds(project: HousekeepingProject, now: Date, limit = BATCH): Promise<string[]> {
  if (!project.auto_close_months) return [];
  const cutoff = monthsAgo(now, project.auto_close_months);
  const today = now.toISOString().slice(0, 10);
  const rows = (await getDb()
    .prepare(
      `SELECT i.id FROM track_issues i JOIN track_statuses s ON s.id = i.status_id
       WHERE i.project_id = ? AND i.triage = 0 AND i.archived_at IS NULL
         AND s.category IN ('backlog', 'todo') AND i.updated_at < ?
         AND (i.cycle_id IS NULL OR i.cycle_id NOT IN (
           SELECT c.id FROM track_cycles c WHERE c.project_id = i.project_id AND c.completed_at IS NULL AND substr(c.end_at, 1, 10) >= ?))
         AND (i.plan_id IS NULL OR i.plan_id NOT IN (SELECT p.id FROM track_plans p WHERE p.status IN ('planned', 'in_progress')))
       ORDER BY i.updated_at ASC LIMIT ?`,
    )
    .all(project.id, cutoff, today, limit)) as Array<{ id: string }>;
  return rows.map((r) => r.id);
}

export async function autoCloseIssues(project: HousekeepingProject, now: Date): Promise<number> {
  const status = await closeStatus(project);
  if (!status) return 0;
  const actor = project.owner_id;
  let closed = 0;
  for (const id of await staleIssueIds(project, now)) {
    const before = await getIssue(id);
    if (!before) continue;
    // Sin actor: updateIssue cambia la columna y emite issue.updated/status_changed
    // (webhooks y Flow); la actividad y el aviso se firman como Track.
    const updated = await updateIssue(id, { statusId: status.id });
    if (!updated || updated.status_id !== status.id) continue;
    closed++;
    if (actor) {
      await createIssueActivity(id, actor, 'status_change', {
        from: before.status_name ?? '',
        to: status.name,
        fromCategory: before.status_category ?? '',
        toCategory: status.category,
        via: 'auto_close',
        months: project.auto_close_months,
      });
      await createIssueActivity(id, actor, 'closed', { status: status.name, category: status.category, via: 'auto_close' });
    }
    await createIssueStatusChangedNotifications({
      issue: before,
      projectName: project.name,
      actor: { id: '', email: '', name: 'Track' },
      oldStatus: before.status_name ?? '',
      newStatus: status.name,
      recipients: await listIssueSubscriberIds(id),
    }).catch(() => undefined);
  }
  return closed;
}

export async function autoArchiveIssues(project: HousekeepingProject, now: Date): Promise<number> {
  if (!project.auto_archive_months) return 0;
  const cutoff = monthsAgo(now, project.auto_archive_months);
  const res = await getDb()
    .prepare(
      `UPDATE track_issues SET archived_at = ? WHERE id IN (
         SELECT i.id FROM track_issues i JOIN track_statuses s ON s.id = i.status_id
         WHERE i.project_id = ? AND i.archived_at IS NULL AND s.category IN ('done', 'cancelled') AND i.updated_at < ?
         LIMIT ?)`,
    )
    .run(now.toISOString(), project.id, cutoff, BATCH * 5);
  return res.changes;
}

/** Cycles que ya terminaron sin completarse: se completan solos hacia el siguiente. */
export async function autoCompleteCycles(project: HousekeepingProject, now: Date): Promise<{ completed: number; moved: number }> {
  const today = now.toISOString().slice(0, 10);
  const db = getDb();
  const ended = (await db
    .prepare('SELECT * FROM track_cycles WHERE project_id = ? AND completed_at IS NULL AND substr(end_at, 1, 10) < ? ORDER BY start_at ASC')
    .all(project.id, today)) as TrackCycleRow[];
  let completed = 0;
  let moved = 0;
  for (const c of ended) {
    const next = await nextCycle(c);
    // Sin cycle siguiente no hay adónde pasar lo sin terminar: queda para cerrar a mano.
    if (!next) continue;
    const claimed = await db
      .prepare('UPDATE track_cycles SET completed_at = ? WHERE id = ? AND completed_at IS NULL')
      .run(now.toISOString(), c.id);
    if (!claimed.changes) continue;
    const res = await completeCycle(c.id, next.id);
    if (res.ok) {
      completed++;
      moved += res.moved;
    }
  }
  return { completed, moved };
}

export async function runHousekeeping(opts: { now?: Date; limit?: number } = {}): Promise<HousekeepingResult & { projects: number }> {
  const now = opts.now ?? new Date();
  const day = now.toISOString().slice(0, 10);
  const db = getDb();
  const rows = (await db
    .prepare(
      `SELECT * FROM track_projects WHERE status = 'active' AND (housekeeping_day IS NULL OR housekeeping_day != ?) LIMIT ?`,
    )
    .all(day, Math.min(Math.max(opts.limit ?? 200, 1), 1000))) as HousekeepingProject[];
  const total = { closed: 0, archived: 0, cyclesCompleted: 0, rolledOver: 0, projects: 0 };
  for (const project of rows) {
    const claimed = await db
      .prepare('UPDATE track_projects SET housekeeping_day = ? WHERE id = ? AND (housekeeping_day IS NULL OR housekeeping_day != ?)')
      .run(day, project.id, day);
    if (!claimed.changes) continue;
    try {
      total.closed += await autoCloseIssues(project, now);
      total.archived += await autoArchiveIssues(project, now);
      // Con cycles automáticos ya los cierra lib/track-auto-cycles.
      if (!project.cycle_auto) {
        const c = await autoCompleteCycles(project, now);
        total.cyclesCompleted += c.completed;
        total.rolledOver += c.moved;
      }
      total.projects++;
    } catch {
      // Un proyecto con error no frena al resto; mañana se reintenta.
    }
  }
  return total;
}

// ---------- Ajustes y archivo ----------

export async function getAutomation(projectId: string): Promise<HousekeepingProject | undefined> {
  return (await getDb().prepare('SELECT * FROM track_projects WHERE id = ?').get(projectId)) as HousekeepingProject | undefined;
}

export async function setAutomation(
  projectId: string,
  payload: { autoCloseMonths?: number; autoCloseStatusId?: string | null; autoArchiveMonths?: number },
): Promise<{ ok: boolean; error?: 'invalid_status' }> {
  const db = getDb();
  const fields: string[] = [];
  const args: Array<string | number | null> = [];
  if (payload.autoCloseMonths !== undefined) {
    fields.push('auto_close_months = ?');
    args.push(payload.autoCloseMonths);
  }
  if (payload.autoCloseStatusId !== undefined) {
    if (payload.autoCloseStatusId) {
      const s = await db
        .prepare("SELECT id FROM track_statuses WHERE id = ? AND project_id = ? AND category IN ('cancelled', 'done')")
        .get(payload.autoCloseStatusId, projectId);
      if (!s) return { ok: false, error: 'invalid_status' };
    }
    fields.push('auto_close_status_id = ?');
    args.push(payload.autoCloseStatusId ?? null);
  }
  if (payload.autoArchiveMonths !== undefined) {
    fields.push('auto_archive_months = ?');
    args.push(payload.autoArchiveMonths);
  }
  if (fields.length) {
    // Un cambio de ajustes vuelve a correr hoy (como Linear, que aplica "en 24 h").
    fields.push('housekeeping_day = NULL');
    await db.prepare(`UPDATE track_projects SET ${fields.join(', ')} WHERE id = ?`).run(...args, projectId);
  }
  return { ok: true };
}

export interface ArchivedIssue {
  id: string;
  identifier: string;
  title: string;
  status_name: string | null;
  archived_at: string;
}

export async function listArchivedIssues(projectId: string, limit = 200): Promise<{ rows: ArchivedIssue[]; total: number }> {
  const db = getDb();
  const total = ((await db
    .prepare('SELECT COUNT(*) AS c FROM track_issues WHERE project_id = ? AND archived_at IS NOT NULL')
    .get(projectId)) as { c: number }).c;
  const rows = (await db
    .prepare(
      `SELECT i.id, i.identifier, i.title, s.name AS status_name, i.archived_at FROM track_issues i
       LEFT JOIN track_statuses s ON s.id = i.status_id
       WHERE i.project_id = ? AND i.archived_at IS NOT NULL ORDER BY i.archived_at DESC LIMIT ?`,
    )
    .all(projectId, limit)) as ArchivedIssue[];
  return { rows, total: Number(total) };
}

/** Restaura issues archivados; actualiza updated_at para que no se vuelvan a archivar enseguida. */
export async function restoreIssues(projectIds: string[], issueIds: string[]): Promise<number> {
  if (!projectIds.length || !issueIds.length) return 0;
  const q = (n: number) => `(${Array.from({ length: n }, () => '?').join(', ')})`;
  const res = await getDb()
    .prepare(
      `UPDATE track_issues SET archived_at = NULL, updated_at = ? WHERE archived_at IS NOT NULL
       AND project_id IN ${q(projectIds.length)} AND id IN ${q(issueIds.length)}`,
    )
    .run(new Date().toISOString(), ...projectIds, ...issueIds);
  return res.changes;
}
