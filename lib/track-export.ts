/**
 * Track — export de issues a CSV (todos los proyectos del workspace o uno).
 * Mismas columnas que entiende el import de CSV genérico, así un export se
 * puede volver a importar (o abrir en una planilla).
 */
import { getDb } from './db';
import { parseIssueLabels } from './track-labels';
import { EXPORT_COLUMNS, toCsv } from './track-import-map';

interface ExportRow {
  identifier: string;
  title: string;
  description: string;
  status_name: string | null;
  priority: string;
  assignee_email: string | null;
  labels: string;
  estimate: number | null;
  cycle_name: string | null;
  milestone_name: string | null;
  parent_identifier: string | null;
  due_date: string | null;
  created_at: string;
  updated_at: string;
  project_name: string;
}

function descriptionText(raw: string): string {
  try {
    const parsed = JSON.parse(raw);
    if (Array.isArray(parsed)) return parsed.map((b: { text?: string }) => b.text ?? '').join('\n');
  } catch {
    // Texto plano heredado.
  }
  return raw;
}

/** Issues del workspace (o de un proyecto) en CSV. Sin los de triage pendientes. */
export async function exportIssuesCsv(teamId: string | null, ownerId: string, projectId?: string | null): Promise<string> {
  const scope = teamId ? 'p.team_id = ?' : '(p.team_id IS NULL AND p.owner_id = ?)';
  const args: string[] = [teamId ?? ownerId];
  if (projectId) args.push(projectId);
  const rows = (await getDb()
    .prepare(
      `SELECT i.identifier, i.title, i.description, s.name AS status_name, i.priority, u.email AS assignee_email, i.labels,
              i.estimate, c.name AS cycle_name, m.name AS milestone_name, parent.identifier AS parent_identifier,
              i.due_date, i.created_at, i.updated_at, p.name AS project_name
       FROM track_issues i
       JOIN track_projects p ON p.id = i.project_id
       LEFT JOIN track_statuses s ON s.id = i.status_id
       LEFT JOIN users u ON u.id = i.assignee_id
       LEFT JOIN track_cycles c ON c.id = i.cycle_id
       LEFT JOIN track_milestones m ON m.id = i.milestone_id
       LEFT JOIN track_issues parent ON parent.id = i.parent_id
       WHERE ${scope} ${projectId ? 'AND p.id = ?' : ''} AND i.triage = 0
       ORDER BY p.name, i.created_at`,
    )
    .all(...args)) as ExportRow[];
  return toCsv(
    EXPORT_COLUMNS,
    rows.map((r) => [
      r.identifier,
      r.title,
      descriptionText(r.description),
      r.status_name ?? '',
      r.priority,
      r.assignee_email ?? '',
      parseIssueLabels(r.labels)
        .map((l) => l.name)
        .join(', '),
      r.estimate ?? '',
      r.cycle_name ?? '',
      r.milestone_name ?? '',
      r.parent_identifier ?? '',
      r.due_date ?? '',
      r.created_at,
      r.updated_at,
      r.project_name,
    ]),
  );
}
