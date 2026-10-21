/**
 * Track — plantillas de issue por proyecto: un nombre y las propiedades que
 * se precargan al crear (título, descripción, status, prioridad, asignado,
 * estimación y labels). El quick-create las aplica sobre el borrador; nada
 * queda atado a la plantilla después de crear el issue.
 */
import { getDb } from './db';
import type { TrackIssueTemplateRow, TrackProjectRow } from './db';
import { normalizeIssueLabels, projectWorkspaceId } from './track-labels';
import type { TemplateCreatePayload, TemplateUpdatePayload } from './track-schema';
import { normalizeTemplateTitle } from './track-schema';

function nowIso(): string {
  return new Date().toISOString();
}

export async function listTemplates(projectId: string): Promise<TrackIssueTemplateRow[]> {
  return (await getDb()
    .prepare('SELECT * FROM track_issue_templates WHERE project_id = ? ORDER BY name COLLATE NOCASE ASC')
    .all(projectId)) as TrackIssueTemplateRow[];
}

export async function getTemplate(id: string): Promise<TrackIssueTemplateRow | undefined> {
  return (await getDb().prepare('SELECT * FROM track_issue_templates WHERE id = ?').get(id)) as
    | TrackIssueTemplateRow
    | undefined;
}

async function labelsJson(project: TrackProjectRow, labels: TemplateCreatePayload['labels']): Promise<string> {
  const ws = projectWorkspaceId(project);
  if (!labels || !ws) return '[]';
  return JSON.stringify(await normalizeIssueLabels(ws, labels));
}

export async function createTemplate(project: TrackProjectRow, payload: TemplateCreatePayload): Promise<TrackIssueTemplateRow> {
  const id = crypto.randomUUID();
  const now = nowIso();
  await getDb()
    .prepare(
      `INSERT INTO track_issue_templates (id, project_id, name, title, description, status_id, priority, assignee_id, estimate, labels, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(
      id,
      project.id,
      payload.name.trim(),
      normalizeTemplateTitle(payload.title ?? ''),
      payload.description?.trim() ?? '',
      payload.statusId ?? null,
      payload.priority ?? null,
      payload.assigneeId ?? null,
      payload.estimate ?? null,
      await labelsJson(project, payload.labels),
      now,
      now,
    );
  return (await getTemplate(id)) as TrackIssueTemplateRow;
}

export async function updateTemplate(
  project: TrackProjectRow,
  id: string,
  payload: TemplateUpdatePayload,
): Promise<TrackIssueTemplateRow | undefined> {
  const fields: string[] = [];
  const args: Array<string | number | null> = [];
  const set = (column: string, value: string | number | null) => {
    fields.push(`${column} = ?`);
    args.push(value);
  };
  if (payload.name !== undefined) set('name', payload.name.trim());
  if (payload.title !== undefined) set('title', normalizeTemplateTitle(payload.title));
  if (payload.description !== undefined) set('description', payload.description.trim());
  if (payload.statusId !== undefined) set('status_id', payload.statusId ?? null);
  if (payload.priority !== undefined) set('priority', payload.priority ?? null);
  if (payload.assigneeId !== undefined) set('assignee_id', payload.assigneeId ?? null);
  if (payload.estimate !== undefined) set('estimate', payload.estimate ?? null);
  if (payload.labels !== undefined) set('labels', await labelsJson(project, payload.labels));
  if (fields.length > 0) {
    set('updated_at', nowIso());
    args.push(id, project.id);
    await getDb()
      .prepare(`UPDATE track_issue_templates SET ${fields.join(', ')} WHERE id = ? AND project_id = ?`)
      .run(...args);
  }
  return getTemplate(id);
}

export async function deleteTemplate(projectId: string, id: string): Promise<boolean> {
  const res = await getDb().prepare('DELETE FROM track_issue_templates WHERE id = ? AND project_id = ?').run(id, projectId);
  return res.changes > 0;
}
