/**
 * Guardas de las páginas de detalle de Analytics. El id tiene que ser de un
 * proyecto vivo del workspace de la sesión: un registro de otro workspace
 * responde igual que uno que no existe.
 */
import { getDb } from '../db';

const TABLES = {
  insights: 'analytics_insights',
  flags: 'analytics_flags',
  dashboards: 'analytics_dashboards',
  persons: 'analytics_persons',
  cohorts: 'analytics_cohorts',
} as const;

export type AnalyticsRecordKind = keyof typeof TABLES;

/** Proyecto dueño del registro, solo si es de este workspace. */
export async function recordProjectId(kind: AnalyticsRecordKind, id: string, workspaceId: string): Promise<string | null> {
  const row = (await getDb()
    .prepare(
      `SELECT r.project_id FROM ${TABLES[kind]} r JOIN analytics_projects p ON p.id = r.project_id
       WHERE r.id = ? AND p.workspace_id = ? AND p.deleted_at IS NULL`,
    )
    .get(id, workspaceId)) as { project_id: string } | undefined;
  return row?.project_id ?? null;
}
