/**
 * Board — imágenes de las pizarras en el storage de uploads (Vercel Blob o
 * public/uploads), una fila por (pizarra, fileId de Excalidraw).
 *
 * La migración de las escenas viejas es perezosa: cada guardado saca de la
 * escena los dataURL en base64 que encuentre, los sube y deja la URL propia.
 * Los fileId de Excalidraw son hash del contenido, así que la misma imagen
 * guardada dos veces no se sube de nuevo.
 *
 * Una misma URL del storage puede estar en varias pizarras (duplicar,
 * restaurar como copia, plantillas, pegar entre pizarras): se borra recién
 * cuando ya ninguna fila la usa.
 */
import { readFile } from 'fs/promises';
import path from 'path';
import { getDb, type BoardFileRow } from './db';
import { deleteUploads, saveUpload } from './uploads';
import {
  BOARD_MAX_FILE_BYTES,
  boardFileHref,
  extensionFor,
  isDataUrl,
  isBoardUploadUrl,
  isFileId,
  isUploadableMime,
  parseBoardFileHref,
  parseDataUrl,
  type SceneFile,
} from './board-file-refs';

const nowIso = () => new Date().toISOString();

export async function getBoardFile(boardId: string, fileId: string): Promise<BoardFileRow | undefined> {
  return (await getDb()
    .prepare('SELECT * FROM board_files WHERE board_id = ? AND file_id = ?')
    .get(boardId, fileId)) as BoardFileRow | undefined;
}

async function insertFileRow(row: Omit<BoardFileRow, 'created_at'>): Promise<void> {
  await getDb()
    .prepare(
      `INSERT OR IGNORE INTO board_files (board_id, file_id, workspace_id, url, mime, size, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(row.board_id, row.file_id, row.workspace_id, row.url, row.mime, row.size, nowIso());
}

export type StoreFileResult =
  | { ok: true; url: string }
  | { ok: false; code: 'invalid_input' | 'file_type_not_allowed' | 'too_large' | 'storage_unavailable' };

/**
 * Sube una imagen en base64 (si no estaba ya) y devuelve la URL propia que va
 * en el dataURL de la escena.
 */
export async function storeBoardFile(
  workspaceId: string,
  boardId: string,
  fileId: string,
  dataURL: string,
): Promise<StoreFileResult> {
  if (!isFileId(fileId)) return { ok: false, code: 'invalid_input' };
  const existing = await getBoardFile(boardId, fileId);
  if (existing) return { ok: true, url: boardFileHref(boardId, fileId) };
  const parsed = parseDataUrl(dataURL);
  if (!parsed) return { ok: false, code: 'invalid_input' };
  if (!isUploadableMime(parsed.mime)) return { ok: false, code: 'file_type_not_allowed' };
  if (parsed.bytes.length > BOARD_MAX_FILE_BYTES) return { ok: false, code: 'too_large' };
  let url: string;
  try {
    url = await saveUpload('boards', `${fileId}.${extensionFor(parsed.mime)}`, parsed.mime, parsed.bytes);
  } catch {
    return { ok: false, code: 'storage_unavailable' };
  }
  await insertFileRow({ board_id: boardId, file_id: fileId, workspace_id: workspaceId, url, mime: parsed.mime, size: parsed.bytes.length });
  // Dos guardados en paralelo con la misma imagen: gana la primera fila y la otra subida sobra.
  const row = await getBoardFile(boardId, fileId);
  if (row && row.url !== url) await deleteUploads([url]);
  return { ok: true, url: boardFileHref(boardId, fileId) };
}

/** Copia las filas de imágenes de una pizarra a otra (mismo archivo del storage). */
export async function copyBoardFiles(fromBoardId: string, toBoardId: string, fileIds?: string[]): Promise<void> {
  const rows = (await getDb()
    .prepare('SELECT * FROM board_files WHERE board_id = ?')
    .all(fromBoardId)) as BoardFileRow[];
  const want = fileIds ? new Set(fileIds) : null;
  for (const r of rows) {
    if (want && !want.has(r.file_id)) continue;
    await insertFileRow({ ...r, board_id: toBoardId });
  }
}

/**
 * Normaliza los `files` de una escena antes de guardarla:
 * - base64 subible → al storage, queda la URL propia;
 * - base64 que no se puede subir (SVG, storage caído) → queda en línea;
 * - URL propia de esta pizarra → solo si la fila existe;
 * - URL propia de otra pizarra del workspace (pegar entre pizarras) → se copia la fila;
 * - cualquier otra cosa → afuera (nada de URLs de terceros en la escena).
 */
export async function externalizeSceneFiles(
  workspaceId: string,
  boardId: string,
  files: Record<string, unknown>,
): Promise<Record<string, unknown>> {
  const out: Record<string, unknown> = {};
  for (const [key, raw] of Object.entries(files)) {
    if (!raw || typeof raw !== 'object') continue;
    const f = raw as SceneFile;
    const fileId = typeof f.id === 'string' ? f.id : key;
    if (!isFileId(fileId) || fileId !== key) continue;
    if (isDataUrl(f.dataURL)) {
      const stored = await storeBoardFile(workspaceId, boardId, fileId, f.dataURL);
      out[key] = stored.ok ? { ...f, dataURL: stored.url } : f;
      continue;
    }
    const ref = parseBoardFileHref(f.dataURL);
    if (!ref || ref.fileId !== fileId) continue;
    if (ref.boardId !== boardId) {
      const src = (await getDb()
        .prepare('SELECT * FROM board_files WHERE board_id = ? AND file_id = ? AND workspace_id = ?')
        .get(ref.boardId, fileId, workspaceId)) as BoardFileRow | undefined;
      if (src) await insertFileRow({ ...src, board_id: boardId });
    }
    if (await getBoardFile(boardId, fileId)) out[key] = { ...f, dataURL: boardFileHref(boardId, fileId) };
  }
  return out;
}

/** URLs del storage de una pizarra (para borrar después de borrar la fila de la pizarra). */
export async function boardFileUrls(boardId: string): Promise<string[]> {
  const rows = (await getDb().prepare('SELECT url FROM board_files WHERE board_id = ?').all(boardId)) as Array<{ url: string }>;
  return [...new Set(rows.map((r) => r.url))];
}

/** Borra del storage las URLs que ya no usa ninguna pizarra. */
export async function deleteOrphanUploads(urls: string[]): Promise<void> {
  const orphans: string[] = [];
  for (const url of urls) {
    const used = await getDb().prepare('SELECT 1 AS x FROM board_files WHERE url = ? LIMIT 1').get(url);
    if (!used) orphans.push(url);
  }
  if (orphans.length) await deleteUploads(orphans);
}

/**
 * ¿Puede ver las imágenes de la pizarra? Alguien del workspace dueño, o quien
 * trae el token vigente del link público. Cortar el link corta las imágenes.
 */
export async function canReadBoardFiles(boardId: string, workspaceId: string | null, token: string | null): Promise<boolean> {
  const row = (await getDb().prepare('SELECT workspace_id, share_token FROM boards WHERE id = ?').get(boardId)) as
    | { workspace_id: string; share_token: string | null }
    | undefined;
  if (!row) return false;
  if (workspaceId && row.workspace_id === workspaceId) return true;
  return Boolean(token && row.share_token && token === row.share_token);
}

/** Bytes de una imagen guardada (disco local o Blob), o null. */
export async function readBoardFile(row: BoardFileRow): Promise<Uint8Array | null> {
  if (!isBoardUploadUrl(row.url)) return null;
  if (row.url.startsWith('/uploads/')) {
    const root = path.join(process.cwd(), 'public', 'uploads');
    const file = path.join(process.cwd(), 'public', row.url);
    if (!file.startsWith(root + path.sep)) return null;
    try {
      return new Uint8Array(await readFile(file));
    } catch {
      return null;
    }
  }
  // isBoardUploadUrl solo deja pasar URLs del Blob de Board (nada de SSRF).
  const res = await fetch(row.url).catch(() => null);
  if (!res?.ok) return null;
  return new Uint8Array(await res.arrayBuffer());
}
