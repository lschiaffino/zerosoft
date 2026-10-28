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
import { sanitizeElements } from './board-import';

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
    folder_id: row.folder_id ?? null,
    ...(row.deleted_at ? { deleted_at: row.deleted_at } : {}),
  };
}

/** Pizarras del workspace; con `viewer`, solo las que esa persona puede ver. */
export async function listBoards(workspaceId: string, viewer?: BoardViewer): Promise<BoardSummary[]> {
  const visible = viewer ? boardVisibleSql(viewer) : { sql: 'b.deleted_at IS NULL', args: [] };
  const rows = (await getDb()
    .prepare(
      `SELECT ${LIST_COLUMNS}
       FROM boards b LEFT JOIN users u ON u.id = b.updated_by
       WHERE b.workspace_id = ? AND ${visible.sql} ORDER BY b.updated_at DESC LIMIT 500`,
    )
    .all(workspaceId, ...visible.args)) as BoardListRow[];
  return rows.map(toSummary);
}

const LIST_COLUMNS = `b.id, b.workspace_id, b.created_by, b.updated_by, b.name, b.scene_bytes, b.thumbnail, b.version,
              b.share_token, b.access, b.folder_id, b.deleted_at, b.created_at, b.updated_at,
              u.name AS updated_by_name, u.email AS updated_by_email`;

/** Término para LIKE con ESCAPE '\\' (escapa %, _ y \). */
function likeTerm(q: string): string {
  return `%${q.replace(/[\\%_]/g, (c) => `\\${c}`)}%`;
}

/**
 * Busca por nombre y por el texto de adentro (stickies, textos, etiquetas de
 * formas, nombres de frames). Si coincidió por el contenido, cada resultado
 * trae la línea que coincidió (`match`).
 */
export async function searchBoards(workspaceId: string, viewer: BoardViewer, q: string, limit = 50): Promise<BoardSummary[]> {
  const term = q.trim().slice(0, 100);
  if (!term) return listBoards(workspaceId, viewer);
  const visible = boardVisibleSql(viewer);
  const like = likeTerm(term);
  const rows = (await getDb()
    .prepare(
      `SELECT ${LIST_COLUMNS}, b.search_text
       FROM boards b LEFT JOIN users u ON u.id = b.updated_by
       WHERE b.workspace_id = ? AND ${visible.sql} AND (b.name LIKE ? ESCAPE '\\' OR b.search_text LIKE ? ESCAPE '\\')
       ORDER BY (b.name LIKE ? ESCAPE '\\') DESC, b.updated_at DESC LIMIT ?`,
    )
    .all(workspaceId, ...visible.args, like, like, like, Math.min(Math.max(limit, 1), 200))) as Array<BoardListRow & { search_text: string }>;
  return rows.map((r) => {
    const summary = toSummary(r);
    const match = r.name.toLowerCase().includes(term.toLowerCase()) ? null : snippet(r.search_text ?? '', term);
    return match ? { ...summary, match } : summary;
  });
}

/** La línea del texto de la pizarra donde aparece `term`, recortada. */
export function snippet(text: string, term: string): string | null {
  const lower = term.toLowerCase();
  const line = text.split('\n').find((l) => l.toLowerCase().includes(lower));
  if (!line) return null;
  if (line.length <= 90) return line;
  const at = line.toLowerCase().indexOf(lower);
  const start = Math.max(0, at - 30);
  return `${start > 0 ? '…' : ''}${line.slice(start, start + 90)}${start + 90 < line.length ? '…' : ''}`;
}

/** Texto buscable de una escena: textos, etiquetas y nombres de frames, una línea cada uno. */
export function sceneSearchText(elements: readonly unknown[]): string {
  const out: string[] = [];
  let size = 0;
  for (const raw of elements as Array<Record<string, unknown>>) {
    if (!raw || raw.isDeleted) continue;
    const text = raw.type === 'text' ? (raw.originalText ?? raw.text) : raw.type === 'frame' || raw.type === 'magicframe' ? raw.name : null;
    if (typeof text !== 'string') continue;
    const clean = text.replace(/\s+/g, ' ').trim();
    if (!clean) continue;
    out.push(clean);
    size += clean.length + 1;
    if (size > 20_000) break;
  }
  return out.join('\n').slice(0, 20_000);
}

async function getBoardRow(workspaceId: string, id: string): Promise<BoardRow | undefined> {
  return (await getDb()
    .prepare('SELECT * FROM boards WHERE id = ? AND workspace_id = ? AND deleted_at IS NULL')
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
  opts: { scene?: BoardScene; thumbnail?: string | null; id?: string; folderId?: string | null } = {},
): Promise<BoardDetail> {
  const id = opts.id ?? crypto.randomUUID();
  const now = nowIso();
  const json = opts.scene ? serializeScene(opts.scene) : '';
  await getDb()
    .prepare(
      `INSERT INTO boards (id, workspace_id, created_by, updated_by, name, scene, scene_bytes, thumbnail, version, folder_id, search_text, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, 1, ?, ?, ?, ?)`,
    )
    .run(
      id,
      workspaceId,
      personId,
      personId,
      name.trim().slice(0, 120) || 'Untitled board',
      json,
      sceneBytes(json),
      cleanThumbnail(opts.thumbnail),
      opts.folderId ?? null,
      sceneSearchText(opts.scene?.elements ?? []),
      now,
      now,
    );
  return (await getBoard(workspaceId, id))!;
}

function serializeScene(scene: BoardScene): string {
  return JSON.stringify({
    elements: sanitizeElements(scene.elements as Array<Record<string, unknown>>),
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
       WHERE id = ? AND workspace_id = ? AND deleted_at IS NULL`,
    )
    .run(name.trim() || 'Untitled board', nowIso(), personId ?? null, id, workspaceId);
  return res.changes > 0;
}

/** Cuántos días queda una pizarra en la papelera antes de borrarse sola. */
export const BOARD_TRASH_DAYS = 30;

/** Manda la pizarra a la papelera: deja de aparecer y sus links dejan de andar, pero se puede restaurar. */
export async function trashBoard(workspaceId: string, id: string, personId: string | null): Promise<boolean> {
  const res = await getDb()
    .prepare('UPDATE boards SET deleted_at = ?, deleted_by = ? WHERE id = ? AND workspace_id = ? AND deleted_at IS NULL')
    .run(nowIso(), personId, id, workspaceId);
  return res.changes > 0;
}

/** Saca la pizarra de la papelera (vuelve con su escena, comentarios, historial y links). */
export async function restoreBoard(workspaceId: string, id: string): Promise<boolean> {
  const res = await getDb()
    .prepare('UPDATE boards SET deleted_at = NULL, deleted_by = NULL WHERE id = ? AND workspace_id = ? AND deleted_at IS NOT NULL')
    .run(id, workspaceId);
  return res.changes > 0;
}

export type TrashedBoard = BoardSummary & { deleted_at: string; deleted_by: string | null };

/** Papelera: las pizarras borradas que la persona puede ver, la más reciente primero. */
export async function listTrash(workspaceId: string, viewer: BoardViewer): Promise<TrashedBoard[]> {
  const visible = boardVisibleSql(viewer, { trash: true });
  const rows = (await getDb()
    .prepare(
      `SELECT ${LIST_COLUMNS}, d.name AS deleted_by_name, d.email AS deleted_by_email
       FROM boards b LEFT JOIN users u ON u.id = b.updated_by LEFT JOIN users d ON d.id = b.deleted_by
       WHERE b.workspace_id = ? AND ${visible.sql} ORDER BY b.deleted_at DESC LIMIT 500`,
    )
    .all(workspaceId, ...visible.args)) as Array<BoardListRow & { deleted_by_name: string | null; deleted_by_email: string | null }>;
  return rows.map((r) => ({ ...toSummary(r), deleted_at: r.deleted_at as string, deleted_by: r.deleted_by_name ?? r.deleted_by_email ?? null }));
}

/** Borra del todo lo que lleva más de BOARD_TRASH_DAYS en la papelera (cron). */
export async function purgeExpiredTrash(now = Date.now()): Promise<number> {
  const cutoff = new Date(now - BOARD_TRASH_DAYS * 24 * 60 * 60 * 1000).toISOString();
  const rows = (await getDb()
    .prepare('SELECT id, workspace_id FROM boards WHERE deleted_at IS NOT NULL AND deleted_at < ? LIMIT 200')
    .all(cutoff)) as Array<{ id: string; workspace_id: string }>;
  let n = 0;
  for (const r of rows) if (await deleteBoard(r.workspace_id, r.id, { trashed: true })) n++;
  return n;
}

/** Mueve la pizarra a una carpeta del workspace (null = sin carpeta). */
export async function moveBoardToFolder(workspaceId: string, id: string, folderId: string | null): Promise<'ok' | 'not_found' | 'no_folder'> {
  if (folderId) {
    const folder = await getDb().prepare('SELECT 1 AS x FROM board_folders WHERE id = ? AND workspace_id = ?').get(folderId, workspaceId);
    if (!folder) return 'no_folder';
  }
  const res = await getDb()
    .prepare('UPDATE boards SET folder_id = ? WHERE id = ? AND workspace_id = ? AND deleted_at IS NULL')
    .run(folderId, id, workspaceId);
  return res.changes > 0 ? 'ok' : 'not_found';
}

/**
 * Borra la pizarra del todo (escena, imágenes, comentarios, historial).
 * `trashed`: solo si está en la papelera (borrar para siempre, poda).
 */
export async function deleteBoard(workspaceId: string, id: string, opts: { trashed?: boolean } = {}): Promise<boolean> {
  if (opts.trashed) {
    const inTrash = await getDb().prepare('SELECT 1 AS x FROM boards WHERE id = ? AND workspace_id = ? AND deleted_at IS NOT NULL').get(id, workspaceId);
    if (!inTrash) return false;
  }
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
  return copySceneToNewBoard(workspaceId, personId, id, src.scene, copyName(src.name), src.thumbnail, src.folder_id ?? null);
}

/** Pizarra nueva con la escena (JSON guardado) de otra: copia las imágenes y apunta las URLs a la nueva. */
async function copySceneToNewBoard(
  workspaceId: string,
  personId: string,
  fromBoardId: string,
  sceneJson: string,
  name: string,
  thumbnail: string | null,
  folderId: string | null = null,
): Promise<BoardDetail> {
  const newId = crypto.randomUUID();
  const scene = parseScene(sceneJson);
  const board = await createBoard(workspaceId, personId, name, {
    id: newId,
    scene: { ...scene, files: retargetFiles(scene.files, newId) },
    thumbnail,
    folderId,
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
  const exists = await getDb().prepare('SELECT 1 AS x FROM boards WHERE id = ? AND workspace_id = ? AND deleted_at IS NULL').get(id, workspaceId);
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
      `UPDATE boards SET scene = ?, scene_bytes = ?, search_text = ?, version = version + 1, updated_at = ?, updated_by = ?
         ${thumb !== undefined ? ', thumbnail = ?' : ''}
       WHERE id = ? AND workspace_id = ? AND version = ? AND deleted_at IS NULL`,
    )
    .run(
      ...([json, bytes, sceneSearchText(scene.elements), now, personId] as Array<string | number | null>),
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
  const row = (await getDb().prepare('SELECT * FROM boards WHERE share_token = ? AND deleted_at IS NULL').get(token)) as BoardRow | undefined;
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
       FROM boards b LEFT JOIN users u ON u.id = b.updated_by WHERE b.edit_token = ? AND b.deleted_at IS NULL`,
    )
    .get(token)) as VersionRow | undefined;
  return row ? toVersionInfo(row) : null;
}

export async function getGuestBoard(token: string): Promise<{ board: BoardDetail; workspaceId: string } | null> {
  if (!TOKEN_RE.test(token)) return null;
  const row = (await getDb().prepare('SELECT * FROM boards WHERE edit_token = ? AND deleted_at IS NULL').get(token)) as BoardRow | undefined;
  if (!row) return null;
  const detail = toDetail(row);
  // El invitado no ve el link público de solo lectura (no lo gestiona).
  return {
    board: { ...detail, share_token: null, scene: { ...detail.scene, files: withShareToken(detail.scene.files, row.id, token) } },
    workspaceId: row.workspace_id,
  };
}
