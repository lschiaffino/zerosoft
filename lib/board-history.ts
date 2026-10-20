/**
 * Board — historial de versiones. Antes de guardar, si la última foto tiene
 * más de una hora (o no hay ninguna), se guarda la escena tal como estaba: el
 * historial queda con una versión por hora de edición. Restaurar nunca pisa la
 * pizarra: crea una copia (ver restoreSnapshotAsCopy en lib/boards.ts).
 *
 * Se guardan 30 días y hasta 200 fotos por pizarra; lo más viejo se poda al
 * sacar una nueva.
 */
import { getDb, type BoardSnapshotRow } from './db';

export const SNAPSHOT_EVERY_MS = 60 * 60 * 1000;
export const SNAPSHOT_KEEP_DAYS = 30;
export const SNAPSHOT_MAX = 200;

export interface BoardSnapshotSummary {
  id: string;
  version: number;
  element_count: number;
  thumbnail: string | null;
  content_at: string;
  edited_by: string | null;
}

function countElements(scene: string): number {
  try {
    const s = JSON.parse(scene) as { elements?: unknown[] };
    return Array.isArray(s.elements) ? s.elements.length : 0;
  } catch {
    return 0;
  }
}

/**
 * Foto del estado actual de la pizarra si toca (última foto de hace más de una
 * hora y algo cambió desde entonces). `now` se inyecta para los tests.
 */
export async function maybeSnapshot(workspaceId: string, boardId: string, now = new Date()): Promise<boolean> {
  const db = getDb();
  const board = (await db
    .prepare('SELECT scene, scene_bytes, thumbnail, version, updated_by, updated_at FROM boards WHERE id = ? AND workspace_id = ?')
    .get(boardId, workspaceId)) as
    | { scene: string; scene_bytes: number; thumbnail: string | null; version: number; updated_by: string | null; updated_at: string }
    | undefined;
  if (!board || !board.scene) return false;
  const last = (await db
    .prepare('SELECT version, taken_at FROM board_snapshots WHERE board_id = ? ORDER BY taken_at DESC LIMIT 1')
    .get(boardId)) as { version: number; taken_at: string } | undefined;
  if (last && now.getTime() - new Date(last.taken_at).getTime() < SNAPSHOT_EVERY_MS) return false;
  if (last && Number(last.version) === Number(board.version)) return false;
  const elements = countElements(board.scene);
  if (elements === 0) return false;
  await db
    .prepare(
      `INSERT INTO board_snapshots (id, board_id, workspace_id, scene, scene_bytes, element_count, thumbnail, version, edited_by, content_at, taken_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(
      crypto.randomUUID(),
      boardId,
      workspaceId,
      board.scene,
      Number(board.scene_bytes),
      elements,
      board.thumbnail,
      Number(board.version),
      board.updated_by,
      board.updated_at,
      now.toISOString(),
    );
  await pruneSnapshots(boardId, now);
  return true;
}

export async function pruneSnapshots(boardId: string, now = new Date()): Promise<void> {
  const db = getDb();
  const cutoff = new Date(now.getTime() - SNAPSHOT_KEEP_DAYS * 86_400_000).toISOString();
  await db.prepare('DELETE FROM board_snapshots WHERE board_id = ? AND taken_at < ?').run(boardId, cutoff);
  await db
    .prepare(
      `DELETE FROM board_snapshots WHERE board_id = ? AND id NOT IN (
         SELECT id FROM board_snapshots WHERE board_id = ? ORDER BY taken_at DESC LIMIT ?
       )`,
    )
    .run(boardId, boardId, SNAPSHOT_MAX);
}

export async function listSnapshots(workspaceId: string, boardId: string): Promise<BoardSnapshotSummary[]> {
  const rows = (await getDb()
    .prepare(
      `SELECT s.id, s.version, s.element_count, s.thumbnail, s.content_at, u.name AS name, u.email AS email
       FROM board_snapshots s LEFT JOIN users u ON u.id = s.edited_by
       WHERE s.board_id = ? AND s.workspace_id = ?
       ORDER BY s.taken_at DESC LIMIT ?`,
    )
    .all(boardId, workspaceId, SNAPSHOT_MAX)) as Array<
    Omit<BoardSnapshotSummary, 'edited_by'> & { name: string | null; email: string | null }
  >;
  return rows.map((r) => ({
    id: r.id,
    version: Number(r.version),
    element_count: Number(r.element_count),
    thumbnail: r.thumbnail,
    content_at: r.content_at,
    edited_by: r.name ?? r.email ?? null,
  }));
}

export async function getSnapshot(workspaceId: string, boardId: string, snapshotId: string): Promise<BoardSnapshotRow | undefined> {
  return (await getDb()
    .prepare('SELECT * FROM board_snapshots WHERE id = ? AND board_id = ? AND workspace_id = ?')
    .get(snapshotId, boardId, workspaceId)) as BoardSnapshotRow | undefined;
}
