/**
 * Track — labels del workspace (nombre + color). Los issues guardan una copia
 * {id, name, color} en track_issues.labels (JSON); los ids apuntan a
 * track_labels. Al renombrar o borrar un label se reescribe esa copia.
 *
 * workspace_id = team activo o, en el workspace personal, el id del dueño.
 */
import type { InStatement } from '@libsql/client';
import { getClient, getDb } from './db';
import type { TrackProjectRow } from './db';
import { safeHexColor } from './track-color';
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

export const DEFAULT_LABEL_COLOR = '#666666';

/**
 * Color seguro para un label: solo hex (#rgb o #rrggbb). Cualquier otra cosa
 * (p. ej. `url(...)`, que el navegador cargaría al pintar el fondo) vuelve al
 * color por defecto.
 */
export function safeLabelColor(color: string | null | undefined): string {
  return safeHexColor(color, DEFAULT_LABEL_COLOR);
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
  try {
    await getDb()
      .prepare('INSERT INTO track_labels (id, workspace_id, name, color) VALUES (?, ?, ?, ?)')
      .run(id, workspaceId, name, safeLabelColor(input.color));
  } catch (err) {
    // Otro request creó el mismo nombre entre la búsqueda y el INSERT
    // (idx_track_labels_name): es un duplicado, no un error del servidor.
    if (/UNIQUE constraint failed/i.test(String((err as Error)?.message ?? err))) {
      return { ok: false, reason: 'duplicate' };
    }
    throw err;
  }
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

/**
 * UPDATE que reescribe, en un solo statement, la copia del label `labelId` en
 * los issues del workspace: SQLite lee y escribe el JSON de cada fila en el
 * mismo paso, así que no pisa una edición concurrente con un JSON leído antes
 * (como hacía el SELECT + un UPDATE por issue) y no queda a medias si se corta.
 * `replacement` = null lo quita; si no, lo reemplaza por {id, name, color}.
 */
function rewriteIssueLabelsStmt(
  workspaceId: string,
  labelId: string,
  replacement: { name: string; color: string } | null,
): InStatement {
  const item = replacement
    ? `CASE WHEN json_extract(j.value, '$.id') = ? THEN json_object('id', ?, 'name', ?, 'color', ?) ELSE json(j.value) END`
    : 'json(j.value)';
  const filter = replacement ? '' : `WHERE json_extract(j.value, '$.id') IS NOT ?`;
  const itemArgs = replacement ? [labelId, labelId, replacement.name, replacement.color] : [labelId];
  return {
    sql: `UPDATE track_issues SET labels = (
            SELECT json_group_array(json(x)) FROM (
              SELECT ${item} AS x FROM json_each(track_issues.labels) j ${filter} ORDER BY j.key
            )
          )
          WHERE labels LIKE ? AND json_valid(labels)
            AND project_id IN (SELECT id FROM track_projects WHERE COALESCE(team_id, owner_id) = ?)`,
    args: [...itemArgs, `%"id":"${labelId}"%`, workspaceId],
  };
}

export async function updateLabel(
  workspaceId: string,
  id: string,
  input: { name?: string; color?: string },
): Promise<LabelResult> {
  const existing = await getLabel(workspaceId, id);
  if (!existing) return { ok: false, reason: 'not_found' };
  const name = input.name !== undefined ? input.name.trim().slice(0, 50) : existing.name;
  const color = safeLabelColor(input.color !== undefined ? input.color.trim() || existing.color : existing.color);
  if (name.toLowerCase() !== existing.name.toLowerCase()) {
    const clash = await getLabelByName(workspaceId, name);
    if (clash && clash.id !== id) return { ok: false, reason: 'duplicate' };
  }
  // El label y sus copias en los issues cambian en la misma transacción.
  try {
    await getClient().batch(
      [
        { sql: 'UPDATE track_labels SET name = ?, color = ? WHERE id = ?', args: [name, color, id] },
        rewriteIssueLabelsStmt(workspaceId, id, { name, color }),
      ],
      'write',
    );
  } catch (err) {
    if (/UNIQUE constraint failed/i.test(String((err as Error)?.message ?? err))) {
      return { ok: false, reason: 'duplicate' };
    }
    throw err;
  }
  return { ok: true, label: (await getLabel(workspaceId, id)) as TrackLabel };
}

export async function deleteLabel(workspaceId: string, id: string): Promise<boolean> {
  const existing = await getLabel(workspaceId, id);
  if (!existing) return false;
  await getClient().batch(
    [
      rewriteIssueLabelsStmt(workspaceId, id, null),
      { sql: 'DELETE FROM track_labels WHERE id = ?', args: [id] },
    ],
    'write',
  );
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
