/**
 * Board: carpetas del workspace (como las colecciones de Excalidraw+ o los
 * espacios de Miro). Planas, sin anidar. Borrar una carpeta no borra sus
 * pizarras: quedan sin carpeta. Server-only.
 */
import { getDb } from './db';
import { boardVisibleSql, type BoardViewer } from './board-access';
import type { BoardFolder } from './boards-types';

export const BOARD_MAX_FOLDERS = 200;

const nowIso = () => new Date().toISOString();

/** Carpetas con cuántas pizarras (que esta persona ve) tiene cada una. */
export async function listBoardFolders(workspaceId: string, viewer: BoardViewer): Promise<BoardFolder[]> {
  const visible = boardVisibleSql(viewer);
  const rows = (await getDb()
    .prepare(
      `SELECT f.id, f.name, f.created_at,
              (SELECT COUNT(*) FROM boards b WHERE b.workspace_id = f.workspace_id AND b.folder_id = f.id AND ${visible.sql}) AS count
       FROM board_folders f WHERE f.workspace_id = ? ORDER BY f.name COLLATE NOCASE LIMIT ?`,
    )
    .all(...visible.args, workspaceId, BOARD_MAX_FOLDERS)) as Array<{ id: string; name: string; created_at: string; count: number }>;
  return rows.map((r) => ({ id: r.id, name: r.name, created_at: r.created_at, count: Number(r.count) }));
}

export async function getBoardFolder(workspaceId: string, id: string): Promise<{ id: string; name: string } | null> {
  const row = (await getDb().prepare('SELECT id, name FROM board_folders WHERE id = ? AND workspace_id = ?').get(id, workspaceId)) as
    | { id: string; name: string }
    | undefined;
  return row ?? null;
}

export type CreateFolderResult = { ok: true; folder: BoardFolder } | { ok: false; code: 'too_many' };

export async function createBoardFolder(workspaceId: string, personId: string, name: string): Promise<CreateFolderResult> {
  const n = (await getDb().prepare('SELECT COUNT(*) AS n FROM board_folders WHERE workspace_id = ?').get(workspaceId)) as { n: number };
  if (Number(n.n) >= BOARD_MAX_FOLDERS) return { ok: false, code: 'too_many' };
  const id = crypto.randomUUID();
  const now = nowIso();
  const clean = name.trim().slice(0, 80) || 'Untitled folder';
  await getDb()
    .prepare('INSERT INTO board_folders (id, workspace_id, name, created_by, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)')
    .run(id, workspaceId, clean, personId, now, now);
  return { ok: true, folder: { id, name: clean, count: 0, created_at: now } };
}

export async function renameBoardFolder(workspaceId: string, id: string, name: string): Promise<string | null> {
  const clean = name.trim().slice(0, 80);
  if (!clean) return null;
  const res = await getDb()
    .prepare('UPDATE board_folders SET name = ?, updated_at = ? WHERE id = ? AND workspace_id = ?')
    .run(clean, nowIso(), id, workspaceId);
  return res.changes > 0 ? clean : null;
}

/** Borra la carpeta; sus pizarras (también las de la papelera) quedan sin carpeta. */
export async function deleteBoardFolder(workspaceId: string, id: string): Promise<boolean> {
  const res = await getDb().prepare('DELETE FROM board_folders WHERE id = ? AND workspace_id = ?').run(id, workspaceId);
  if (res.changes === 0) return false;
  await getDb().prepare('UPDATE boards SET folder_id = NULL WHERE workspace_id = ? AND folder_id = ?').run(workspaceId, id);
  return true;
}
