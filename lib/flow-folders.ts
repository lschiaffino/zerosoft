/**
 * Flow — carpetas del workspace para ordenar flows (como los proyectos o
 * carpetas de Zapier). Borrar una carpeta no borra sus flows: quedan sin
 * carpeta. Server-only.
 */
import { getDb, type FlowFolderRow } from './db';
import { nowIso } from './flow';

export const MAX_FLOW_FOLDERS = 200;

export interface FlowFolderDto {
  id: string;
  name: string;
  flowCount: number;
}

export async function listFolders(workspaceId: string): Promise<FlowFolderDto[]> {
  const rows = (await getDb()
    .prepare(
      `SELECT d.*, (SELECT COUNT(*) FROM flow_flows f WHERE f.user_id = d.user_id AND f.folder_id = d.id) AS n
       FROM flow_folders d WHERE d.user_id = ? ORDER BY d.name COLLATE NOCASE`,
    )
    .all(workspaceId)) as Array<FlowFolderRow & { n: number }>;
  return rows.map((r) => ({ id: r.id, name: r.name, flowCount: Number(r.n) }));
}

export type FolderResult = { ok: true; folder: FlowFolderDto } | { ok: false; error: 'invalid_name' | 'too_many_folders' | 'not_found' };

function cleanName(name: string): string | null {
  const n = name.trim().slice(0, 80);
  return n ? n : null;
}

export async function createFolder(workspaceId: string, actorId: string, name: string): Promise<FolderResult> {
  const n = cleanName(name);
  if (!n) return { ok: false, error: 'invalid_name' };
  const db = getDb();
  const count = (await db.prepare('SELECT COUNT(*) AS n FROM flow_folders WHERE user_id = ?').get(workspaceId)) as { n: number };
  if (Number(count.n) >= MAX_FLOW_FOLDERS) return { ok: false, error: 'too_many_folders' };
  const id = crypto.randomUUID();
  const ts = nowIso();
  await db
    .prepare('INSERT INTO flow_folders (id, user_id, name, created_by, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)')
    .run(id, workspaceId, n, actorId, ts, ts);
  return { ok: true, folder: { id, name: n, flowCount: 0 } };
}

export async function renameFolder(workspaceId: string, id: string, name: string): Promise<FolderResult> {
  const n = cleanName(name);
  if (!n) return { ok: false, error: 'invalid_name' };
  const res = await getDb()
    .prepare('UPDATE flow_folders SET name = ?, updated_at = ? WHERE id = ? AND user_id = ?')
    .run(n, nowIso(), id, workspaceId);
  if (res.changes === 0) return { ok: false, error: 'not_found' };
  const folder = (await listFolders(workspaceId)).find((f) => f.id === id)!;
  return { ok: true, folder };
}

/** Borra la carpeta; sus flows quedan sin carpeta. */
export async function deleteFolder(workspaceId: string, id: string): Promise<boolean> {
  const db = getDb();
  const res = await db.prepare('DELETE FROM flow_folders WHERE id = ? AND user_id = ?').run(id, workspaceId);
  if (res.changes > 0) await db.prepare('UPDATE flow_flows SET folder_id = NULL WHERE user_id = ? AND folder_id = ?').run(workspaceId, id);
  return res.changes > 0;
}
