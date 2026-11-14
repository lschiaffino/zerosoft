/**
 * Board: pizarras destacadas. Cada persona marca las suyas con una estrella y
 * quedan arriba de la lista. Es una preferencia personal: no cambia nada para
 * el resto del equipo. Quien mira la pizarra (view) puede destacarla.
 */
import { getDb } from './db';

/** Ids destacados por esta persona entre las pizarras del workspace. */
export async function listStarredIds(workspaceId: string, personId: string): Promise<string[]> {
  const rows = (await getDb()
    .prepare(
      `SELECT s.board_id FROM board_stars s JOIN boards b ON b.id = s.board_id
       WHERE s.user_id = ? AND b.workspace_id = ? ORDER BY s.created_at DESC`,
    )
    .all(personId, workspaceId)) as Array<{ board_id: string }>;
  return rows.map((r) => String(r.board_id));
}

/** Destaca o quita la estrella. Devuelve false si la pizarra no es del workspace. */
export async function setBoardStarred(workspaceId: string, personId: string, boardId: string, starred: boolean): Promise<boolean> {
  const db = getDb();
  const exists = await db.prepare('SELECT 1 AS ok FROM boards WHERE id = ? AND workspace_id = ? AND deleted_at IS NULL').get(boardId, workspaceId);
  if (!exists) return false;
  if (starred) {
    await db
      .prepare('INSERT OR IGNORE INTO board_stars (user_id, board_id, created_at) VALUES (?, ?, ?)')
      .run(personId, boardId, new Date().toISOString());
  } else {
    await db.prepare('DELETE FROM board_stars WHERE user_id = ? AND board_id = ?').run(personId, boardId);
  }
  return true;
}

export { starredFirst } from './board-stars-order';
