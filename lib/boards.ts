/**
 * Board — pizarras estilo Miro (Excalidraw) del workspace.
 *
 * Las pizarras son del workspace (workspace_id = dueño): cualquier miembro
 * del team las ve y edita, salvo las restringidas a invitados
 * (lib/board-access.ts). Sin multiplayer en tiempo real: cada guardado
 * manda la versión sobre la que se editó y, si otro la cambió antes, el
 * guardado se rechaza (409) y el cliente muestra "cambió en otro lado".
 */
import { nanoid } from 'nanoid';
import { getDb, type BoardRow } from './db';
import { BOARD_MAX_SCENE_BYTES, BOARD_MAX_THUMB_BYTES, type BoardDetail, type BoardScene, type BoardSummary } from './boards-types';
import { referencedFileIds, retargetFiles, withShareToken } from './board-file-refs';
import { boardFileUrls, copyBoardFiles, deleteOrphanUploads, externalizeSceneFiles } from './board-files';
import { getSnapshot, maybeSnapshot } from './board-history';
import { boardVisibleSql, normalizeAccessMode, type BoardViewer } from './board-access';

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

type BoardListRow = Omit<BoardRow, 'scene' | 'edit_token'> & { updated_by_name: string | null; updated_by_email: string | null };

function toSummary(row: BoardListRow | BoardRow & { updated_by_name?: string | null; updated_by_email?: string | null }): BoardSummary {
  return {
    id: row.id,
    name: row.name,
    thumbnail: row.thumbnail,
    version: Number(row.version),
    shared: row.share_token != null,
    access: normalizeAccessMode(row.access),
    updated_at: row.updated_at,
    created_at: row.created_at,
    updated_by: row.updated_by_name ?? row.updated_by_email ?? null,
  };
}

/** Pizarras del workspace; con `viewer`, solo las que esa persona puede ver. */
export async function listBoards(workspaceId: string, viewer?: BoardViewer): Promise<BoardSummary[]> {
  const visible = viewer ? boardVisibleSql(viewer) : { sql: '1 = 1', args: [] };
  const rows = (await getDb()
    .prepare(
      `SELECT b.id, b.workspace_id, b.created_by, b.updated_by, b.name, b.scene_bytes, b.thumbnail, b.version,
              b.share_token, b.access, b.created_at, b.updated_at, u.name AS updated_by_name, u.email AS updated_by_email
       FROM boards b LEFT JOIN users u ON u.id = b.updated_by
       WHERE b.workspace_id = ? AND ${visible.sql} ORDER BY b.updated_at DESC LIMIT 500`,
    )
    .all(workspaceId, ...visible.args)) as BoardListRow[];
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

/**
 * Crea una pizarra, vacía o con una escena de arranque (plantilla, copia de
 * una versión). `id` se puede pasar para preparar la escena con sus URLs.
 */
export async function createBoard(
  workspaceId: string,
  personId: string,
  name: string,
  opts: { scene?: BoardScene; thumbnail?: string | null; id?: string } = {},
): Promise<BoardDetail> {
  const id = opts.id ?? crypto.randomUUID();
  const now = nowIso();
  const json = opts.scene ? serializeScene(opts.scene) : '';
  await getDb()
    .prepare(
      `INSERT INTO boards (id, workspace_id, created_by, updated_by, name, scene, scene_bytes, thumbnail, version, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, 1, ?, ?)`,
    )
    .run(id, workspaceId, personId, personId, name.trim().slice(0, 120) || 'Untitled board', json, sceneBytes(json), cleanThumbnail(opts.thumbnail), now, now);
  return (await getBoard(workspaceId, id))!;
}

function serializeScene(scene: BoardScene): string {
  return JSON.stringify({
    elements: scene.elements,
    appState: pickAppState(scene.appState ?? {}),
    files: scene.files ?? {},
  });
}

/**
 * Renombra y marca updated_at (y updated_by si viene): la lista ordena y
 * muestra "editado" por esa columna. La versión no cambia, así un rename no
 * hace chocar el guardado de la escena que esté en vuelo.
 */
export async function renameBoard(
  workspaceId: string,
  id: string,
  name: string,
  personId?: string,
): Promise<boolean> {
  const res = await getDb()
    .prepare(
      `UPDATE boards SET name = ?, updated_at = ?, updated_by = COALESCE(?, updated_by)
       WHERE id = ? AND workspace_id = ?`,
    )
    .run(name.trim() || 'Untitled board', nowIso(), personId ?? null, id, workspaceId);
  return res.changes > 0;
}

export async function deleteBoard(workspaceId: string, id: string): Promise<boolean> {
  const urls = await boardFileUrls(id);
  const res = await getDb().prepare('DELETE FROM boards WHERE id = ? AND workspace_id = ?').run(id, workspaceId);
  if (res.changes === 0) return false;
  // Por si la base no tiene las foreign keys prendidas: las filas se van igual.
  await getDb().prepare('DELETE FROM board_files WHERE board_id = ?').run(id);
  await deleteOrphanUploads(urls);
  return true;
}

export async function duplicateBoard(
  workspaceId: string,
  personId: string,
  id: string,
  copyName: (name: string) => string = (n) => `${n} (copy)`,
): Promise<BoardDetail | null> {
  const src = await getBoardRow(workspaceId, id);
  if (!src) return null;
  return copySceneToNewBoard(workspaceId, personId, id, src.scene, copyName(src.name), src.thumbnail);
}

/** Pizarra nueva con la escena (JSON guardado) de otra: copia las imágenes y apunta las URLs a la nueva. */
async function copySceneToNewBoard(
  workspaceId: string,
  personId: string,
  fromBoardId: string,
  sceneJson: string,
  name: string,
  thumbnail: string | null,
): Promise<BoardDetail> {
  const newId = crypto.randomUUID();
  const scene = parseScene(sceneJson);
  const board = await createBoard(workspaceId, personId, name, {
    id: newId,
    scene: { ...scene, files: retargetFiles(scene.files, newId) },
    thumbnail,
  });
  await copyBoardFiles(fromBoardId, newId, referencedFileIds(scene.files));
  return board;
}

/** Restaura una versión del historial como pizarra nueva (la original no se toca). */
export async function restoreSnapshotAsCopy(
  workspaceId: string,
  personId: string,
  boardId: string,
  snapshotId: string,
  name: string,
): Promise<BoardDetail | null> {
  const snap = await getSnapshot(workspaceId, boardId, snapshotId);
  if (!snap) return null;
  return copySceneToNewBoard(workspaceId, personId, boardId, snap.scene, name, snap.thumbnail);
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
 * Las imágenes van al storage (lib/board-files.ts); el tope de tamaño cuida lo
 * que queda en línea.
 */
export async function saveBoardScene(
  workspaceId: string,
  /** null = invitado con el link de edición (sin cuenta). */
  personId: string | null,
  id: string,
  scene: BoardScene,
  baseVersion: number,
  thumbnail?: string | null,
): Promise<SaveSceneResult> {
  const exists = await getDb().prepare('SELECT 1 AS x FROM boards WHERE id = ? AND workspace_id = ?').get(id, workspaceId);
  if (!exists) return { ok: false, code: 'not_found' };
  // Las imágenes en base64 salen al storage (migra de a poco las escenas viejas).
  const files = await externalizeSceneFiles(workspaceId, id, scene.files ?? {});
  const json = serializeScene({ ...scene, files });
  const bytes = sceneBytes(json);
  if (bytes > BOARD_MAX_SCENE_BYTES) return { ok: false, code: 'too_large', bytes, max: BOARD_MAX_SCENE_BYTES };
  // Foto del estado anterior para el historial (como mucho una por hora).
  await maybeSnapshot(workspaceId, id);
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
      ...([json, bytes, now, personId] as Array<string | number | null>),
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

/** Versión de la escena y quién la guardó último: lo que sondea el editor (sin traer la escena). */
export interface BoardVersionInfo {
  version: number;
  updated_by: string | null;
}

type VersionRow = { version: number; name: string | null; email: string | null };
const toVersionInfo = (r: VersionRow): BoardVersionInfo => ({ version: Number(r.version), updated_by: r.name ?? r.email ?? null });

export async function getBoardVersion(workspaceId: string, id: string): Promise<BoardVersionInfo | null> {
  const row = (await getDb()
    .prepare(
      `SELECT b.version, u.name AS name, u.email AS email
       FROM boards b LEFT JOIN users u ON u.id = b.updated_by WHERE b.id = ? AND b.workspace_id = ?`,
    )
    .get(id, workspaceId)) as VersionRow | undefined;
  return row ? toVersionInfo(row) : null;
}

/** ¿La pizarra existe en el workspace? (sin traer la escena). */
export async function boardExists(workspaceId: string, id: string): Promise<boolean> {
  return Boolean(await getDb().prepare('SELECT 1 AS x FROM boards WHERE id = ? AND workspace_id = ?').get(id, workspaceId));
}

/** Nombre de la pizarra (para notificaciones), o null. */
export async function getBoardName(workspaceId: string, id: string): Promise<string | null> {
  const row = (await getDb().prepare('SELECT name FROM boards WHERE id = ? AND workspace_id = ?').get(id, workspaceId)) as
    | { name: string }
    | undefined;
  return row?.name ?? null;
}

/**
 * Fija la miniatura sin tocar la escena ni la versión (una pizarra creada
 * desde una plantilla la genera al abrirse por primera vez).
 */
export async function setBoardThumbnail(workspaceId: string, id: string, thumbnail: string): Promise<boolean> {
  const clean = cleanThumbnail(thumbnail);
  if (!clean) return false;
  const res = await getDb()
    .prepare('UPDATE boards SET thumbnail = ? WHERE id = ? AND workspace_id = ?')
    .run(clean, id, workspaceId);
  return res.changes > 0;
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
  if (!row) return null;
  const detail = toDetail(row);
  // Las imágenes se piden con el token: el proxy no tiene sesión que chequear.
  return { ...detail, scene: { ...detail.scene, files: withShareToken(detail.scene.files, row.id, token) } };
}

// ---------- Link de invitado (edición sin login) ----------

const TOKEN_RE = /^[A-Za-z0-9_-]{10,64}$/;

/** Pizarra del link de invitado con edición, con su workspace (para guardar). */
/** Versión de la pizarra del link de invitado con edición (sondeo del editor). */
export async function getGuestBoardVersion(token: string): Promise<BoardVersionInfo | null> {
  if (!TOKEN_RE.test(token)) return null;
  const row = (await getDb()
    .prepare(
      `SELECT b.version, u.name AS name, u.email AS email
       FROM boards b LEFT JOIN users u ON u.id = b.updated_by WHERE b.edit_token = ?`,
    )
    .get(token)) as VersionRow | undefined;
  return row ? toVersionInfo(row) : null;
}

export async function getGuestBoard(token: string): Promise<{ board: BoardDetail; workspaceId: string } | null> {
  if (!TOKEN_RE.test(token)) return null;
  const row = (await getDb().prepare('SELECT * FROM boards WHERE edit_token = ?').get(token)) as BoardRow | undefined;
  if (!row) return null;
  const detail = toDetail(row);
  // El invitado no ve el link público de solo lectura (no lo gestiona).
  return {
    board: { ...detail, share_token: null, scene: { ...detail.scene, files: withShareToken(detail.scene.files, row.id, token) } },
    workspaceId: row.workspace_id,
  };
}
