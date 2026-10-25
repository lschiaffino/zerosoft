import { withDatabaseBodies, type DocsBlock } from './docs-types';

/**
 * Bloques de imagen y archivo de Docs. Puro (sin DB ni fs): lo usan el editor,
 * el render de solo lectura, la sanitización y la ruta que sirve los archivos.
 *
 * El archivo se guarda con lib/uploads.ts (Vercel Blob o public/uploads, 10 MB
 * por archivo, sin HTML/SVG/JS). El navegador nunca usa la URL del storage: lo
 * pide a /api/docs/files/<página>/<bloque>, que chequea el acceso a la página
 * en cada request (un link copiado deja de andar si se pierde el acceso).
 */

export type DocsFileKind = 'image' | 'file' | 'video' | 'audio' | 'pdf';

/**
 * Tope por archivo cuando pasa por nuestro servidor (multipart a
 * /api/docs/pages/<id>/files): disco local en un servidor propio.
 */
export const DOCS_MAX_UPLOAD = 50 * 1024 * 1024;
/**
 * Tope con Vercel Blob: el navegador sube directo al storage (subida de
 * cliente, en partes para lo grande); el servidor solo firma el permiso.
 */
export const DOCS_MAX_BLOB_UPLOAD = 5 * 1024 * 1024 * 1024;

/** Cómo sube el editor: directo a Blob o por el servidor (y hasta cuánto). */
export interface DocsUploadConfig {
  mode: 'blob' | 'server';
  max: number;
}

export interface DocsUploadResult {
  url: string;
  name: string;
  size: number;
  mime: string;
}

/** Imágenes que se muestran en línea (el resto de los tipos van como archivo). */
const INLINE_IMAGE = /^image\/(png|jpe?g|gif|webp|avif|bmp)$/i;
/** Video y audio que el navegador reproduce con <video>/<audio>. */
const INLINE_VIDEO = /^video\/(mp4|webm|ogg|quicktime)$/i;
const INLINE_AUDIO = /^audio\/(mpeg|mp3|mp4|x-m4a|aac|ogg|wav|x-wav|webm|flac)$/i;
const PDF_MIME = /^application\/pdf$/i;

// URL que devuelve saveUpload('docs', …): disco local o Vercel Blob. Solo
// estas se aceptan en un bloque (y solo estas pide el proxy: nada de SSRF).
const LOCAL_URL = /^\/uploads\/docs\/[A-Za-z0-9._-]+$/;
const BLOB_URL = /^https:\/\/[a-z0-9-]+\.public\.blob\.vercel-storage\.com\/docs\/[A-Za-z0-9._-]+$/;

const MIME_RE = /^[\w.+-]+\/[\w.+-]+$/;

export function isDocsUploadUrl(url: unknown): url is string {
  return typeof url === 'string' && (LOCAL_URL.test(url) || BLOB_URL.test(url));
}

export function isInlineImageMime(mime: string | null | undefined): boolean {
  return INLINE_IMAGE.test(mime ?? '');
}

export function isInlineMediaMime(mime: string | null | undefined): boolean {
  return INLINE_VIDEO.test(mime ?? '') || INLINE_AUDIO.test(mime ?? '');
}

export function isPdfMime(mime: string | null | undefined): boolean {
  return PDF_MIME.test(mime ?? '');
}

export function isFileBlockType(type: string): type is DocsFileKind {
  return type === 'image' || type === 'file' || type === 'video' || type === 'audio' || type === 'pdf';
}

/** Tipo de bloque para un archivo soltado o pegado: imagen, video, audio o PDF si se puede mostrar. */
export function fileKindFor(mime: string): DocsFileKind {
  if (isInlineImageMime(mime)) return 'image';
  if (INLINE_VIDEO.test(mime)) return 'video';
  if (INLINE_AUDIO.test(mime)) return 'audio';
  if (PDF_MIME.test(mime)) return 'pdf';
  return 'file';
}

/** El tipo pedido ("/video", "/pdf") si el archivo lo soporta; si no, el que le corresponde. */
export function fileKindForRequest(requested: DocsFileKind | undefined, mime: string): DocsFileKind {
  const natural = fileKindFor(mime);
  if (!requested || requested === 'file') return requested === 'file' ? 'file' : natural;
  return requested === natural ? requested : natural;
}

/** Atributo accept del selector de archivos para cada "/comando". */
export function acceptFor(kind: DocsFileKind | undefined): string {
  switch (kind) {
    case 'image':
      return 'image/*';
    case 'video':
      return 'video/*';
    case 'audio':
      return 'audio/*';
    case 'pdf':
      return 'application/pdf,.pdf';
    default:
      return '';
  }
}

/** Nombre guardado en el storage: "<uuid>-<nombre saneado>" (lo que acepta isDocsUploadUrl). */
export function docsStoragePathname(name: string, uuid: string): string {
  const safe = name.replace(/[^a-zA-Z0-9._-]/g, '_').slice(-120) || 'upload';
  return `docs/${uuid}-${safe}`;
}

/** Pathname válido para una subida de cliente a Blob (el servidor lo chequea antes de firmar). */
export function isDocsStoragePathname(pathname: unknown): pathname is string {
  return typeof pathname === 'string' && /^docs\/[0-9a-f-]{36}-[A-Za-z0-9._-]{1,120}$/.test(pathname);
}

/** URL (de nuestro origen) que sirve el archivo de un bloque con chequeo de acceso. */
export function docsFileHref(pageId: string, blockId: string, opts: { download?: boolean } = {}): string {
  const base = `/api/docs/files/${encodeURIComponent(pageId)}/${encodeURIComponent(blockId)}`;
  return opts.download ? `${base}?download=1` : base;
}

/** "980 B", "12.4 KB", "3.1 MB". */
export function formatFileSize(bytes: number | null | undefined): string {
  const n = Math.max(0, Number(bytes) || 0);
  if (n < 1024) return `${n} B`;
  const units = ['KB', 'MB', 'GB'];
  let value = n / 1024;
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024;
    unit++;
  }
  return `${value >= 100 ? Math.round(value) : Math.round(value * 10) / 10} ${units[unit]}`;
}

/** Bloque nuevo a partir de lo que devolvió la subida. */
export function fileBlockFromUpload(upload: DocsUploadResult, kind?: DocsFileKind): DocsBlock {
  return {
    id: crypto.randomUUID(),
    type: kind ?? fileKindFor(upload.mime),
    content: '',
    url: upload.url,
    name: upload.name,
    size: upload.size,
    mime: upload.mime,
  };
}

/** Nombre visible saneado: sin tags ni controles, acotado. */
export function cleanFileName(name: unknown): string {
  return String(name ?? '')
    // eslint-disable-next-line no-control-regex
    .replace(/[\u0000-\u001f\u007f<>]/g, '')
    .trim()
    .slice(0, 255);
}

/**
 * Normaliza los campos de archivo de un bloque image/file: la URL solo si es
 * del storage de Docs, MIME con forma válida, tamaño numérico. En otros tipos
 * de bloque los campos se descartan.
 */
export function sanitizeFileFields(block: DocsBlock): DocsBlock {
  const { url, name, size, mime, ...rest } = block;
  if (!isFileBlockType(block.type)) return rest;
  const out: DocsBlock = { ...rest };
  if (isDocsUploadUrl(url)) out.url = url;
  const clean = cleanFileName(name);
  if (clean) out.name = clean;
  if (typeof size === 'number' && Number.isFinite(size) && size >= 0) out.size = Math.round(size);
  if (typeof mime === 'string' && MIME_RE.test(mime) && mime.length <= 255) out.mime = mime.toLowerCase();
  return out;
}

/** Bloque image/file con archivo válido, por id (lo que sirve el proxy). */
export function findFileBlock(blocks: DocsBlock[], blockId: string): (DocsBlock & { url: string }) | null {
  // También los del cuerpo de las filas de una base.
  const block = withDatabaseBodies(blocks).find((b) => b.id === blockId);
  if (!block || !isFileBlockType(block.type) || !isDocsUploadUrl(block.url)) return null;
  return block as DocsBlock & { url: string };
}

/** Saca la URL del storage (para quien solo puede ver la página). */
export function stripFileUrls(blocks: DocsBlock[]): DocsBlock[] {
  return blocks.map((b) => {
    if (b.type === 'database' && b.db?.rows?.some((r) => r.body?.length)) {
      return { ...b, db: { ...b.db, rows: b.db.rows.map((r) => (r.body?.length ? { ...r, body: stripFileUrls(r.body) } : r)) } };
    }
    if (!isFileBlockType(b.type) || b.url === undefined) return b;
    const { url, ...rest } = b;
    // El render solo necesita saber si hay archivo: se marca con un string vacío.
    return { ...rest, url: url ? '' : undefined };
  });
}

/** Content-Disposition con el nombre original (RFC 6266 / 5987). */
export function contentDisposition(name: string, inline: boolean): string {
  const clean = cleanFileName(name) || 'file';
  const ascii = clean.replace(/[^\x20-\x7e]/g, '_').replace(/["\\]/g, '_');
  return `${inline ? 'inline' : 'attachment'}; filename="${ascii}"; filename*=UTF-8''${encodeURIComponent(clean)}`;
}

/**
 * Dónde sube y desde dónde sirve los archivos el editor cuando no es una
 * página de Docs (Notes usa sus propias rutas, con chequeo de dueño).
 */
export interface DocsFileSource {
  uploadUrl: string;
  href: (blockId: string, opts?: { download?: boolean }) => string;
}

/** Prefijo del ícono de página subido (el resto del valor es la URL del storage). */
export const ICON_IMAGE_PREFIX = 'img:';

/** URL del storage de un ícono subido ("img:<url>"), o null si es un emoji. */
export function iconImageUrl(icon: string | null | undefined): string | null {
  if (!icon || !icon.startsWith(ICON_IMAGE_PREFIX)) return null;
  const url = icon.slice(ICON_IMAGE_PREFIX.length);
  return isDocsUploadUrl(url) ? url : null;
}

/** Portada: color o degradé de la galería ("color:<clave>"). */
export const COVER_COLOR_PREFIX = 'color:';

/**
 * Bloque "virtual" para servir el ícono o la portada subidos de una página por
 * /api/docs/files/<página>/icon|cover (mismo chequeo de acceso que un bloque).
 */
export function pageImageBlock(value: string | null | undefined, kind: 'icon' | 'cover'): (DocsBlock & { url: string }) | null {
  const url = kind === 'icon' ? iconImageUrl(value) : isDocsUploadUrl(value) ? value : null;
  if (!url) return null;
  const ext = url.toLowerCase().split('.').pop() ?? '';
  const mime = ext === 'png' ? 'image/png' : ext === 'gif' ? 'image/gif' : ext === 'webp' ? 'image/webp' : ext === 'avif' ? 'image/avif' : 'image/jpeg';
  return { id: kind, type: 'image', content: '', url, name: kind, mime };
}

/** Hash corto de un string (para que el navegador no muestre un ícono o portada viejos). */
function shortHash(s: string): string {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (Math.imul(31, h) + s.charCodeAt(i)) | 0;
  return (h >>> 0).toString(36);
}

/** URL (con chequeo de acceso) del ícono o la portada subidos de una página. */
export function pageImageHref(pageId: string, kind: 'icon' | 'cover', value: string): string {
  return `${docsFileHref(pageId, kind)}?v=${shortHash(value)}`;
}
