/**
 * Board — pizarras estilo Miro (Excalidraw) del workspace.
 *
 * Las pizarras son del workspace (workspace_id = dueño): cualquier miembro
 * del team las ve y edita. Sin multiplayer en tiempo real: cada guardado
 * manda la versión sobre la que se editó y, si otro la cambió antes, el
 * guardado se rechaza (409) y el cliente muestra "cambió en otro lado".
 */
import { nanoid } from 'nanoid';
import { getDb, type BoardRow } from './db';
import { BOARD_MAX_SCENE_BYTES, BOARD_MAX_THUMB_BYTES, type BoardDetail, type BoardScene, type BoardSummary } from './boards-types';

const nowIso = () => new Date().toISOString();

function parseScene(raw: string): BoardScene {
  if (!raw) return { elements: [], appState: {}, files: {} };
  try {
    const s = JSON.parse(raw) as Partial<BoardScene>;
    return {
      elements: Array.isArray(s.elements) ? s.elements : [],
      appState: s.appState && typeof s.appState === 'object' ? s.appState : {},
      files: s.files && typeof s.files === 'object' ? s.files : {},
    };
  } catch {
    return { elements: [], appState: {}, files: {} };
  }
}

type BoardListRow = Omit<BoardRow, 'scene'> & { updated_by_name: string | null; updated_by_email: string | null };

function toSummary(row: BoardListRow | BoardRow & { updated_by_name?: string | null; updated_by_email?: string | null }): BoardSummary {
  return {
    id: row.id,
    name: row.name,
    thumbnail: row.thumbnail,
    version: Number(row.version),
    shared: row.share_token != null,
    updated_at: row.updated_at,
    created_at: row.created_at,
    updated_by: row.updated_by_name ?? row.updated_by_email ?? null,
  };
}

export async function listBoards(workspaceId: string): Promise<BoardSummary[]> {
  const rows = (await getDb()
    .prepare(
      `SELECT b.id, b.workspace_id, b.created_by, b.updated_by, b.name, b.scene_bytes, b.thumbnail, b.version,
              b.share_token, b.created_at, b.updated_at, u.name AS updated_by_name, u.email AS updated_by_email
       FROM boards b LEFT JOIN users u ON u.id = b.updated_by
       WHERE b.workspace_id = ? ORDER BY b.updated_at DESC LIMIT 500`,
    )
    .all(workspaceId)) as BoardListRow[];
  return rows.map(toSummary);
}

async function getBoardRow(workspaceId: string, id: string): Promise<BoardRow | undefined> {
  return (await getDb()
    .prepare('SELECT * FROM boards WHERE id = ? AND workspace_id = ?')
    .get(id, workspaceId)) as BoardRow | undefined;
}

function toDetail(row: BoardRow): BoardDetail {
  return { ...toSummary(row), scene: parseScene(row.scene), share_token: row.share_token };
}

export async function getBoard(workspaceId: string, id: string): Promise<BoardDetail | null> {
  const row = await getBoardRow(workspaceId, id);
  return row ? toDetail(row) : null;
}

export async function createBoard(workspaceId: string, personId: string, name: string): Promise<BoardDetail> {
  const id = crypto.randomUUID();
  const now = nowIso();
  await getDb()
    .prepare(
      `INSERT INTO boards (id, workspace_id, created_by, updated_by, name, scene, scene_bytes, version, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, '', 0, 1, ?, ?)`,
    )
    .run(id, workspaceId, personId, personId, name.trim() || 'Untitled board', now, now);
  return (await getBoard(workspaceId, id))!;
}

export async function renameBoard(workspaceId: string, id: string, name: string): Promise<boolean> {
  const res = await getDb()
    .prepare('UPDATE boards SET name = ? WHERE id = ? AND workspace_id = ?')
    .run(name.trim() || 'Untitled board', id, workspaceId);
  return res.changes > 0;
}

export async function deleteBoard(workspaceId: string, id: string): Promise<boolean> {
  const res = await getDb().prepare('DELETE FROM boards WHERE id = ? AND workspace_id = ?').run(id, workspaceId);
  return res.changes > 0;
}

export async function duplicateBoard(
  workspaceId: string,
  personId: string,
  id: string,
  copyName: (name: string) => string = (n) => `${n} (copy)`,
): Promise<BoardDetail | null> {
  const src = await getBoardRow(workspaceId, id);
  if (!src) return null;
  const newId = crypto.randomUUID();
  const now = nowIso();
  await getDb()
    .prepare(
      `INSERT INTO boards (id, workspace_id, created_by, updated_by, name, scene, scene_bytes, thumbnail, version, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, 1, ?, ?)`,
    )
    .run(newId, workspaceId, personId, personId, copyName(src.name).slice(0, 120), src.scene, src.scene_bytes, src.thumbnail, now, now);
  return getBoard(workspaceId, newId);
}

/** Subconjunto de appState que se persiste (lo demás es estado de la sesión). */
const APP_STATE_KEYS = ['viewBackgroundColor', 'gridSize', 'gridStep', 'gridModeEnabled'] as const;

export function pickAppState(appState: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const k of APP_STATE_KEYS) if (appState[k] !== undefined) out[k] = appState[k];
  return out;
}

export function sceneBytes(json: string): number {
  return Buffer.byteLength(json, 'utf8');
}

export type SaveSceneResult =
  | { ok: true; version: number; updated_at: string }
  | { ok: false; code: 'not_found' }
  | { ok: false; code: 'too_large'; bytes: number; max: number }
  | { ok: false; code: 'conflict'; version: number; updated_at: string; updated_by: string | null };

/** Miniatura SVG aceptable: chica y sin scripts (se muestra como <img>, igual se filtra). */
export function cleanThumbnail(svg: string | null | undefined): string | null {
  if (!svg) return null;
  const s = svg.trim();
  if (!s.startsWith('<svg') || Buffer.byteLength(s, 'utf8') > BOARD_MAX_THUMB_BYTES) return null;
  if (/<script|\son\w+\s*=|javascript:|<foreignObject/i.test(s)) return null;
  return s;
}

/**
 * Guarda la escena si `baseVersion` es la versión actual (si no → conflict).
 * El tope de tamaño evita que imágenes pegadas inflen la base.
 */
export async function saveBoardScene(
  workspaceId: string,
  personId: string,
  id: string,
  scene: BoardScene,
  baseVersion: number,
  thumbnail?: string | null,
): Promise<SaveSceneResult> {
  const json = JSON.stringify({
    elements: scene.elements,
    appState: pickAppState(scene.appState ?? {}),
    files: scene.files ?? {},
  });
  const bytes = sceneBytes(json);
  if (bytes > BOARD_MAX_SCENE_BYTES) return { ok: false, code: 'too_large', bytes, max: BOARD_MAX_SCENE_BYTES };
  const now = nowIso();
  // undefined = no tocar la miniatura; null = borrarla (pizarra vacía); una
  // miniatura inválida o muy grande se ignora y queda la anterior.
  const thumb =
    thumbnail === undefined ? undefined : thumbnail === null ? null : (cleanThumbnail(thumbnail) ?? undefined);
  const res = await getDb()
    .prepare(
      `UPDATE boards SET scene = ?, scene_bytes = ?, version = version + 1, updated_at = ?, updated_by = ?
         ${thumb !== undefined ? ', thumbnail = ?' : ''}
       WHERE id = ? AND workspace_id = ? AND version = ?`,
    )
    .run(
      ...([json, bytes, now, personId] as Array<string | number>),
      ...(thumb !== undefined ? [thumb] : []),
      id,
      workspaceId,
      baseVersion,
    );
  if (res.changes > 0) return { ok: true, version: baseVersion + 1, updated_at: now };
  const current = (await getDb()
    .prepare(
      `SELECT b.version, b.updated_at, u.name AS name, u.email AS email
       FROM boards b LEFT JOIN users u ON u.id = b.updated_by WHERE b.id = ? AND b.workspace_id = ?`,
    )
    .get(id, workspaceId)) as { version: number; updated_at: string; name: string | null; email: string | null } | undefined;
  if (!current) return { ok: false, code: 'not_found' };
  return {
    ok: false,
    code: 'conflict',
    version: Number(current.version),
    updated_at: current.updated_at,
    updated_by: current.name ?? current.email ?? null,
  };
}

// ---------- Link público (solo lectura) ----------

export async function setBoardShared(workspaceId: string, id: string, shared: boolean): Promise<string | null | false> {
  const row = await getBoardRow(workspaceId, id);
  if (!row) return false;
  if (!shared) {
    await getDb().prepare('UPDATE boards SET share_token = NULL WHERE id = ? AND workspace_id = ?').run(id, workspaceId);
    return null;
  }
  if (row.share_token) return row.share_token;
  const token = nanoid(24);
  await getDb().prepare('UPDATE boards SET share_token = ? WHERE id = ? AND workspace_id = ?').run(token, id, workspaceId);
  return token;
}

export async function getSharedBoard(token: string): Promise<BoardDetail | null> {
  if (!/^[A-Za-z0-9_-]{10,64}$/.test(token)) return null;
  const row = (await getDb().prepare('SELECT * FROM boards WHERE share_token = ?').get(token)) as BoardRow | undefined;
  return row ? toDetail(row) : null;
}
