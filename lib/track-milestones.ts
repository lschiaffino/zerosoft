/**
 * Track — milestones dentro de un proyecto: nombre, fecha objetivo y progreso
 * (issues terminados / totales). Un issue pertenece a lo sumo a uno
 * (track_issues.milestone_id); borrar el milestone deja sus issues sin
 * milestone (ON DELETE SET NULL).
 */
import { getDb } from './db';
import type { TrackMilestoneRow } from './db';
import type { MilestoneCreatePayload, MilestoneUpdatePayload } from './track-schema';

export interface TrackMilestoneWithProgress extends TrackMilestoneRow {
  total: number;
  done: number;
}

function nowIso(): string {
  return new Date().toISOString();
}

/** Milestones del proyecto con progreso; primero los que tienen fecha (la más cercana arriba). */
export async function listMilestones(projectId: string): Promise<TrackMilestoneWithProgress[]> {
  return (await getDb()
    .prepare(
      `SELECT m.*,
         (SELECT COUNT(*) FROM track_issues i WHERE i.milestone_id = m.id AND i.triage = 0) AS total,
         (SELECT COUNT(*) FROM track_issues i JOIN track_statuses s ON s.id = i.status_id
            WHERE i.milestone_id = m.id AND i.triage = 0 AND s.category IN ('done', 'cancelled')) AS done
       FROM track_milestones m
       WHERE m.project_id = ?
       ORDER BY m.target_date IS NULL, m.target_date ASC, m.created_at ASC`,
    )
    .all(projectId)) as TrackMilestoneWithProgress[];
}

export async function getMilestone(id: string): Promise<TrackMilestoneRow | undefined> {
  return (await getDb().prepare('SELECT * FROM track_milestones WHERE id = ?').get(id)) as TrackMilestoneRow | undefined;
}

export async function createMilestone(projectId: string, payload: MilestoneCreatePayload): Promise<TrackMilestoneRow> {
  const id = crypto.randomUUID();
  const now = nowIso();
  await getDb()
    .prepare(
      'INSERT INTO track_milestones (id, project_id, name, description, target_date, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)',
    )
    .run(id, projectId, payload.name.trim(), payload.description?.trim() ?? '', payload.targetDate ?? null, now, now);
  return (await getMilestone(id)) as TrackMilestoneRow;
}

export async function updateMilestone(id: string, payload: MilestoneUpdatePayload): Promise<TrackMilestoneRow | undefined> {
  const fields: string[] = [];
  const args: Array<string | null> = [];
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
  if (fields.length > 0) {
    fields.push('updated_at = ?');
    args.push(nowIso(), id);
    await getDb().prepare(`UPDATE track_milestones SET ${fields.join(', ')} WHERE id = ?`).run(...args);
  }
  return getMilestone(id);
}

export async function deleteMilestone(id: string): Promise<boolean> {
  const db = getDb();
  // Por si la base no tiene FKs activas: los issues quedan sin milestone igual.
  await db.prepare('UPDATE track_issues SET milestone_id = NULL WHERE milestone_id = ?').run(id);
  const res = await db.prepare('DELETE FROM track_milestones WHERE id = ?').run(id);
  return res.changes > 0;
}
