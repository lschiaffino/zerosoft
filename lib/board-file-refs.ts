/**
 * Board — referencias a imágenes de la escena. Puro (sin DB ni fs): lo usan el
 * editor, el guardado y la ruta que sirve los archivos.
 *
 * Excalidraw guarda cada imagen en `files[<fileId>]` con un `dataURL`. Antes
 * era base64 dentro del JSON de la escena; ahora el archivo va a lib/uploads.ts
 * y el `dataURL` pasa a ser /api/boards/<pizarra>/files/<fileId>, que chequea el
 * acceso en cada request (la URL del storage nunca llega al navegador).
 */

/** Imágenes que se suben al storage. SVG queda en línea (uploads.ts lo rechaza). */
const UPLOADABLE_MIME = /^image\/(png|jpe?g|gif|webp|avif|bmp)$/i;

/** Tope por imagen: el body de una función de Vercel no pasa de 4.5 MB. */
export const BOARD_MAX_FILE_BYTES = 4 * 1024 * 1024;

const ID_RE = /^[A-Za-z0-9_-]{1,128}$/;
const HREF_RE = /^\/api\/boards\/([A-Za-z0-9_-]{1,64})\/files\/([A-Za-z0-9_-]{1,128})(?:\?.*)?$/;

// URL que devuelve saveUpload('boards', …): disco local o Vercel Blob. Solo
// estas pide el proxy (nada de SSRF).
const LOCAL_URL = /^\/uploads\/boards\/[A-Za-z0-9._-]+$/;
const BLOB_URL = /^https:\/\/[a-z0-9-]+\.public\.blob\.vercel-storage\.com\/boards\/[A-Za-z0-9._-]+$/;

export function isBoardUploadUrl(url: unknown): url is string {
  return typeof url === 'string' && (LOCAL_URL.test(url) || BLOB_URL.test(url));
}

export function isUploadableMime(mime: string | null | undefined): boolean {
  return UPLOADABLE_MIME.test(mime ?? '');
}

export function isFileId(id: unknown): id is string {
  return typeof id === 'string' && ID_RE.test(id);
}

/** URL (de nuestro origen) que sirve una imagen. `token`: link público de solo lectura. */
export function boardFileHref(boardId: string, fileId: string, token?: string | null): string {
  const base = `/api/boards/${encodeURIComponent(boardId)}/files/${encodeURIComponent(fileId)}`;
  return token ? `${base}?t=${encodeURIComponent(token)}` : base;
}

/** { boardId, fileId } de una URL armada con boardFileHref, o null. */
export function parseBoardFileHref(url: unknown): { boardId: string; fileId: string } | null {
  if (typeof url !== 'string') return null;
  const m = HREF_RE.exec(url);
  return m ? { boardId: m[1], fileId: m[2] } : null;
}

export function isDataUrl(url: unknown): url is string {
  return typeof url === 'string' && url.startsWith('data:');
}

/** data:<mime>;base64,<datos> → { mime, bytes }. Solo base64 (lo que arma Excalidraw). */
export function parseDataUrl(url: string): { mime: string; bytes: Buffer } | null {
  const m = /^data:([\w.+-]+\/[\w.+-]+)(?:;[\w=.+-]+)*;base64,([A-Za-z0-9+/=\s]*)$/.exec(url);
  if (!m) return null;
  const bytes = Buffer.from(m[2], 'base64');
  if (bytes.length === 0) return null;
  return { mime: m[1].toLowerCase(), bytes };
}

export function extensionFor(mime: string): string {
  const sub = mime.split('/')[1]?.toLowerCase() ?? 'bin';
  return sub === 'jpeg' ? 'jpg' : sub.replace(/[^a-z0-9]/g, '') || 'bin';
}

/** Entrada de `files` de Excalidraw (lo que importa acá). */
export interface SceneFile {
  id?: unknown;
  mimeType?: unknown;
  dataURL?: unknown;
  created?: unknown;
  lastRetrieved?: unknown;
}

/**
 * Reemplaza los dataURL en línea que ya están subidos (mapa fileId → URL). Lo
 * usa el editor antes de mandar la escena: una imagen viaja una sola vez.
 */
export function swapUploadedFiles(
  files: Record<string, unknown>,
  uploaded: ReadonlyMap<string, string>,
): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [id, raw] of Object.entries(files)) {
    const f = raw as SceneFile;
    const url = uploaded.get(id);
    out[id] = url && isDataUrl(f?.dataURL) ? { ...f, dataURL: url } : raw;
  }
  return out;
}

/** Cambia la pizarra de las URLs propias (copias, plantillas, restaurar). */
export function retargetFiles(files: Record<string, unknown>, boardId: string): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [id, raw] of Object.entries(files)) {
    const f = raw as SceneFile;
    const ref = parseBoardFileHref(f?.dataURL);
    out[id] = ref ? { ...f, dataURL: boardFileHref(boardId, ref.fileId) } : raw;
  }
  return out;
}

/** Suma el token del link público a las URLs propias (vista de solo lectura). */
export function withShareToken(files: Record<string, unknown>, boardId: string, token: string): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [id, raw] of Object.entries(files)) {
    const f = raw as SceneFile;
    const ref = parseBoardFileHref(f?.dataURL);
    out[id] = ref ? { ...f, dataURL: boardFileHref(boardId, ref.fileId, token) } : raw;
  }
  return out;
}

/** Ids de archivo con URL propia (los que hay que copiar junto con la escena). */
export function referencedFileIds(files: Record<string, unknown>): string[] {
  const out: string[] = [];
  for (const raw of Object.values(files)) {
    const ref = parseBoardFileHref((raw as SceneFile)?.dataURL);
    if (ref) out.push(ref.fileId);
  }
  return out;
}
