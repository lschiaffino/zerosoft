/**
 * Time in status: lectura de la base (solo servidor). Lo puro está en
 * lib/track-status-time.ts, que también usan los componentes.
 */
import { getDb } from './db';
import { summarizeStatusPeriods, type StatusLogEntry, type StatusTime } from './track-status-time';

/** Períodos de un issue y su resumen. Quien llama ya validó el acceso al issue. */
export async function loadStatusTime(issueId: string, now: Date = new Date()): Promise<StatusTime> {
  const db = getDb();
  const [rows, statuses] = await Promise.all([
    db
      .prepare('SELECT status_id, status_name, status_category, entered_at FROM track_issue_status_log WHERE issue_id = ? ORDER BY entered_at ASC, id ASC')
      .all(issueId) as Promise<StatusLogEntry[]>,
    db
      .prepare(
        'SELECT s.id, s.name, s.color, s.category FROM track_statuses s WHERE s.project_id = (SELECT project_id FROM track_issues WHERE id = ?)',
      )
      .all(issueId) as Promise<Array<{ id: string; name: string; color: string; category: string }>>,
  ]);
  const current = new Map(statuses.map((s) => [s.id, { name: s.name, color: s.color, category: s.category }]));
  return summarizeStatusPeriods(rows, now, current);
}
