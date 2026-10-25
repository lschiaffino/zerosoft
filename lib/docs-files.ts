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

export type DocsFileKind = 'image' | 'file';

/** Tope por archivo: el mismo MAX_UPLOAD_SIZE de lib/uploads.ts (el editor avisa antes de subir). */
export const DOCS_MAX_UPLOAD = 10 * 1024 * 1024;

export interface DocsUploadResult {
  url: string;
  name: string;
  size: number;
  mime: string;
}

/** Imágenes que se muestran en línea (el resto de los tipos van como archivo). */
const INLINE_IMAGE = /^image\/(png|jpe?g|gif|webp|avif|bmp)$/i;

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

export function isFileBlockType(type: string): type is DocsFileKind {
  return type === 'image' || type === 'file';
}

/** Tipo de bloque para un archivo soltado o pegado: imagen si se puede mostrar. */
export function fileKindFor(mime: string): DocsFileKind {
  return isInlineImageMime(mime) ? 'image' : 'file';
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
  if (!block) return findDatabaseFile(blocks, blockId);
  if (!isFileBlockType(block.type) || !isDocsUploadUrl(block.url)) return null;
  return block as DocsBlock & { url: string };
}

/** Archivo de una propiedad files de una base (por id de archivo), como bloque file para el proxy. */
function findDatabaseFile(blocks: DocsBlock[], fileId: string): (DocsBlock & { url: string }) | null {
  for (const b of blocks) {
    if (b.type !== 'database' || !b.db?.rows) continue;
    for (const r of b.db.rows) {
      for (const list of Object.values(r.files ?? {})) {
        const f = list.find((x) => x.id === fileId);
        if (f && isDocsUploadUrl(f.url)) {
          return { id: f.id, type: fileKindFor(f.mime ?? ''), content: '', url: f.url, name: f.name, size: f.size, mime: f.mime };
        }
      }
    }
  }
  return null;
}

/** Saca la URL del storage (para quien solo puede ver la página). */
export function stripFileUrls(blocks: DocsBlock[]): DocsBlock[] {
  return blocks.map((b) => {
    if (b.type === 'database' && b.db?.rows?.some((r) => r.body?.length || r.files)) {
      return {
        ...b,
        db: {
          ...b.db,
          rows: b.db.rows.map((r) => {
            if (!r.body?.length && !r.files) return r;
            const out = { ...r };
            if (r.body?.length) out.body = stripFileUrls(r.body);
            // Propiedades files: el nombre queda, la URL del storage no.
            if (r.files) out.files = Object.fromEntries(Object.entries(r.files).map(([k, list]) => [k, list.map((f) => ({ ...f, url: '' }))]));
            return out;
          }),
        },
      };
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
