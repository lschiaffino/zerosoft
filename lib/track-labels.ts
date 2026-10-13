/**
 * Track — labels del workspace (nombre + color). Los issues guardan una copia
 * {id, name, color} en track_issues.labels (JSON); los ids apuntan a
 * track_labels. Al renombrar o borrar un label se reescribe esa copia.
 *
 * workspace_id = team activo o, en el workspace personal, el id del dueño.
 */
import { getDb } from './db';
import type { TrackProjectRow } from './db';
import type { IssueLabel } from './track-schema';

export interface TrackLabel {
  id: string;
  workspace_id: string;
  name: string;
  color: string;
  created_at: string;
  issue_count?: number;
}

export function trackWorkspaceId(teamId: string | null, ownerId: string): string {
  return teamId ?? ownerId;
}

export function projectWorkspaceId(project: Pick<TrackProjectRow, 'team_id' | 'owner_id'>): string | null {
  return project.team_id ?? project.owner_id ?? null;
}

export function parseIssueLabels(raw: string | null | undefined): IssueLabel[] {
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? (parsed as IssueLabel[]) : [];
  } catch {
    return [];
  }
}

/** Issues del workspace (vía proyectos) cuyo JSON de labels menciona `labelId`. */
function workspaceIssuesWithLabelSql(): string {
  return `SELECT i.id, i.labels FROM track_issues i JOIN track_projects p ON p.id = i.project_id
          WHERE COALESCE(p.team_id, p.owner_id) = ? AND i.labels LIKE ?`;
}

export async function listLabels(workspaceId: string, withCounts = false): Promise<TrackLabel[]> {
  const db = getDb();
  const rows = (await db
    .prepare('SELECT * FROM track_labels WHERE workspace_id = ? ORDER BY name COLLATE NOCASE ASC')
    .all(workspaceId)) as TrackLabel[];
  if (!withCounts || rows.length === 0) return rows;
  const issues = (await db
    .prepare(
      `SELECT i.labels FROM track_issues i JOIN track_projects p ON p.id = i.project_id
       WHERE COALESCE(p.team_id, p.owner_id) = ? AND i.labels != '[]'`,
    )
    .all(workspaceId)) as Array<{ labels: string }>;
  const counts = new Map<string, number>();
  for (const i of issues) for (const l of parseIssueLabels(i.labels)) counts.set(l.id, (counts.get(l.id) ?? 0) + 1);
  return rows.map((r) => ({ ...r, issue_count: counts.get(r.id) ?? 0 }));
}

export async function getLabel(workspaceId: string, id: string): Promise<TrackLabel | undefined> {
  return (await getDb()
    .prepare('SELECT * FROM track_labels WHERE id = ? AND workspace_id = ?')
    .get(id, workspaceId)) as TrackLabel | undefined;
}

async function getLabelByName(workspaceId: string, name: string): Promise<TrackLabel | undefined> {
  return (await getDb()
    .prepare('SELECT * FROM track_labels WHERE workspace_id = ? AND name = ? COLLATE NOCASE')
    .get(workspaceId, name.trim())) as TrackLabel | undefined;
}

export type LabelResult = { ok: true; label: TrackLabel } | { ok: false; reason: 'duplicate' | 'not_found' };

export async function createLabel(
  workspaceId: string,
  input: { name: string; color?: string },
): Promise<LabelResult> {
  const name = input.name.trim().slice(0, 50);
  if (await getLabelByName(workspaceId, name)) return { ok: false, reason: 'duplicate' };
  const id = crypto.randomUUID();
  await getDb()
    .prepare('INSERT INTO track_labels (id, workspace_id, name, color) VALUES (?, ?, ?, ?)')
    .run(id, workspaceId, name, input.color?.trim() || '#666666');
  return { ok: true, label: (await getLabel(workspaceId, id)) as TrackLabel };
}

/** Busca por nombre (sin distinguir mayúsculas) o lo crea. */
export async function findOrCreateLabel(workspaceId: string, name: string, color?: string): Promise<TrackLabel> {
  const existing = await getLabelByName(workspaceId, name);
  if (existing) return existing;
  const res = await createLabel(workspaceId, { name, color });
  if (res.ok) return res.label;
  return (await getLabelByName(workspaceId, name)) as TrackLabel;
}

async function rewriteIssueLabels(
  workspaceId: string,
  labelId: string,
  map: (labels: IssueLabel[]) => IssueLabel[],
): Promise<void> {
  const db = getDb();
  const rows = (await db
    .prepare(workspaceIssuesWithLabelSql())
    .all(workspaceId, `%"id":"${labelId}"%`)) as Array<{ id: string; labels: string }>;
  for (const r of rows) {
    const next = map(parseIssueLabels(r.labels));
    await db.prepare('UPDATE track_issues SET labels = ? WHERE id = ?').run(JSON.stringify(next), r.id);
  }
}

export async function updateLabel(
  workspaceId: string,
  id: string,
  input: { name?: string; color?: string },
): Promise<LabelResult> {
  const existing = await getLabel(workspaceId, id);
  if (!existing) return { ok: false, reason: 'not_found' };
  const name = input.name !== undefined ? input.name.trim().slice(0, 50) : existing.name;
  const color = input.color !== undefined ? input.color.trim() || existing.color : existing.color;
  if (name.toLowerCase() !== existing.name.toLowerCase()) {
    const clash = await getLabelByName(workspaceId, name);
    if (clash && clash.id !== id) return { ok: false, reason: 'duplicate' };
  }
  await getDb().prepare('UPDATE track_labels SET name = ?, color = ? WHERE id = ?').run(name, color, id);
  await rewriteIssueLabels(workspaceId, id, (labels) =>
    labels.map((l) => (l.id === id ? { id, name, color } : l)),
  );
  return { ok: true, label: (await getLabel(workspaceId, id)) as TrackLabel };
}

export async function deleteLabel(workspaceId: string, id: string): Promise<boolean> {
  const existing = await getLabel(workspaceId, id);
  if (!existing) return false;
  await rewriteIssueLabels(workspaceId, id, (labels) => labels.filter((l) => l.id !== id));
  await getDb().prepare('DELETE FROM track_labels WHERE id = ?').run(id);
  return true;
}

/**
 * Convierte los labels que llegan en un payload de issue a labels del
 * workspace: ids conocidos se respetan (con nombre y color actuales); ids
 * desconocidos o ajenos se resuelven por nombre (creándolos si hace falta).
 * Así los clientes viejos que mandan labels libres siguen funcionando.
 */
export async function normalizeIssueLabels(
  workspaceId: string,
  input: Array<{ id?: string; name?: string; color?: string }>,
): Promise<IssueLabel[]> {
  const out: IssueLabel[] = [];
  for (const raw of input) {
    let label: TrackLabel | undefined;
    if (raw.id) label = await getLabel(workspaceId, raw.id);
    if (!label && raw.name?.trim()) label = await findOrCreateLabel(workspaceId, raw.name, raw.color);
    if (label && !out.some((l) => l.id === label!.id)) out.push({ id: label.id, name: label.name, color: label.color });
  }
  return out;
}

/** Labels del workspace por id (descarta los que no pertenecen). */
export async function labelsByIds(workspaceId: string, ids: string[]): Promise<IssueLabel[]> {
  if (ids.length === 0) return [];
  const ph = ids.map(() => '?').join(', ');
  const rows = (await getDb()
    .prepare(`SELECT id, name, color FROM track_labels WHERE workspace_id = ? AND id IN (${ph})`)
    .all(workspaceId, ...ids)) as IssueLabel[];
  return rows;
}
