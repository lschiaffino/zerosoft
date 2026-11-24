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
import type { TrackFormField } from './track-forms';

function fieldsJson(fields: TrackFormField[] | undefined): string {
  return JSON.stringify(fields ?? []);
}

function nowIso(): string {
  return new Date().toISOString();
}

export async function listTemplates(projectId: string): Promise<TrackIssueTemplateRow[]> {
  return (await getDb()
    .prepare('SELECT * FROM track_issue_templates WHERE project_id = ? ORDER BY is_default DESC, name COLLATE NOCASE ASC')
    .all(projectId)) as TrackIssueTemplateRow[];
}

/**
 * Formularios de pedidos del workspace (plantillas con campos), con su team.
 * Sin filtrar por acceso: el llamador descarta los teams que la persona no ve.
 */
export async function listWorkspaceFormTemplates(
  teamId: string | null,
  ownerId: string,
): Promise<Array<TrackIssueTemplateRow & { team_name: string; team_slug: string }>> {
  return (await getDb()
    .prepare(
      `SELECT t.*, p.name AS team_name, p.slug AS team_slug
         FROM track_issue_templates t
         JOIN track_projects p ON p.id = t.project_id
        WHERE t.fields <> '[]' AND p.status = 'active' AND ${teamId ? 'p.team_id = ?' : 'p.team_id IS NULL AND p.owner_id = ?'}
        ORDER BY p.name COLLATE NOCASE, t.name COLLATE NOCASE
        LIMIT 500`,
    )
    .all(teamId ?? ownerId)) as Array<TrackIssueTemplateRow & { team_name: string; team_slug: string }>;
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

/** Solo una plantilla por proyecto es la predeterminada: al marcar otra se desmarca la anterior. */
async function clearDefault(projectId: string): Promise<void> {
  await getDb().prepare('UPDATE track_issue_templates SET is_default = 0 WHERE project_id = ? AND is_default = 1').run(projectId);
}

export async function createTemplate(project: TrackProjectRow, payload: TemplateCreatePayload): Promise<TrackIssueTemplateRow> {
  const id = crypto.randomUUID();
  const now = nowIso();
  // Un formulario no es la plantilla predeterminada: el alta rápida no lo precarga.
  const isDefault = Boolean(payload.isDefault) && !payload.fields?.length;
  if (isDefault) await clearDefault(project.id);
  await getDb()
    .prepare(
      `INSERT INTO track_issue_templates (id, project_id, name, title, description, status_id, priority, assignee_id, estimate, labels, is_default, fields, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
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
      isDefault ? 1 : 0,
      fieldsJson(payload.fields),
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
  if (payload.fields !== undefined) set('fields', fieldsJson(payload.fields));
  // Un formulario no es la plantilla predeterminada: el alta rápida no lo precarga.
  if (payload.fields?.length) set('is_default', 0);
  else if (payload.isDefault !== undefined) {
    if (payload.isDefault) await clearDefault(project.id);
    set('is_default', payload.isDefault ? 1 : 0);
  }
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
