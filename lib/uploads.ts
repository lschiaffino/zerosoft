import { existsSync } from 'fs';
import { copyFile, mkdir, readdir, rename, rmdir, stat, unlink, writeFile } from 'fs/promises';
import path from 'path';
import { del, put } from '@vercel/blob';

/**
 * Almacenamiento de archivos subidos (adjuntos de Chat, Track, tareas del CRM,
 * bloques de imagen/archivo de Docs y Notes, imágenes de Board y de Design,
 * media del CRM y archivos de Robots).
 * - Con BLOB_READ_WRITE_TOKEN → Vercel Blob (lo que usa producción).
 * - Sin token y fuera de Vercel → disco local en UPLOADS_DIR (por defecto
 *   data/uploads), fuera de public/: nada se sirve como archivo estático.
 *   Todo se lee por rutas de la app que chequean acceso y ponen headers seguros.
 * - Sin token en Vercel → error: el filesystem es read-only y efímero.
 *
 * La URL guardada en la base sigue siendo /uploads/<carpeta>/<nombre>; la
 * resuelve localUploadPath (y next.config reescribe /uploads/* a la ruta que
 * sirve las carpetas públicas por diseño).
 *
 * Solo se aceptan tipos de una lista permitida: imágenes raster, video, audio,
 * PDF, documentos de oficina, texto plano y comprimidos.
 */

export const MAX_UPLOAD_SIZE = 10 * 1024 * 1024; // 10 MB

export type UploadFolder = 'chat' | 'track' | 'tasks' | 'robots' | 'docs' | 'boards' | 'crm' | 'rec' | 'workspace' | 'design' | 'shop' | 'social';
const FOLDERS = new Set<string>(['chat', 'track', 'tasks', 'robots', 'docs', 'boards', 'crm', 'rec', 'workspace', 'design', 'shop', 'social']);

/** Extensión permitida → tipo con el que se guarda (y se sirve, si es de los que se muestran). */
const ALLOWED: Record<string, string> = {
  // Imágenes raster
  png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', gif: 'image/gif', webp: 'image/webp',
  avif: 'image/avif', bmp: 'image/bmp', heic: 'image/heic', heif: 'image/heif', tif: 'image/tiff', tiff: 'image/tiff',
  ico: 'image/x-icon',
  // Video
  mp4: 'video/mp4', m4v: 'video/mp4', webm: 'video/webm', mov: 'video/quicktime', ogv: 'video/ogg',
  // Audio
  mp3: 'audio/mpeg', m4a: 'audio/mp4', aac: 'audio/aac', wav: 'audio/wav', ogg: 'audio/ogg', oga: 'audio/ogg',
  opus: 'audio/ogg', flac: 'audio/flac', weba: 'audio/webm',
  // Documentos
  pdf: 'application/pdf',
  doc: 'application/msword', docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  xls: 'application/vnd.ms-excel', xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  ppt: 'application/vnd.ms-powerpoint', pptx: 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  odt: 'application/vnd.oasis.opendocument.text', ods: 'application/vnd.oasis.opendocument.spreadsheet',
  odp: 'application/vnd.oasis.opendocument.presentation', rtf: 'application/rtf', epub: 'application/epub+zip',
  pages: 'application/octet-stream', numbers: 'application/octet-stream', key: 'application/octet-stream',
  // Texto plano y datos
  txt: 'text/plain', md: 'text/markdown', csv: 'text/csv', tsv: 'text/tab-separated-values', json: 'application/json',
  vtt: 'text/vtt', srt: 'text/plain', log: 'text/plain', ics: 'text/calendar', vcf: 'text/vcard',
  // Comprimidos
  zip: 'application/zip', gz: 'application/gzip', tgz: 'application/gzip', tar: 'application/x-tar',
  '7z': 'application/x-7z-compressed', rar: 'application/vnd.rar',
  // Fuentes
  woff: 'font/woff', woff2: 'font/woff2', ttf: 'font/ttf', otf: 'font/otf',
};

/** Tipo declarado que el navegador podría interpretar como documento o script: nunca. */
const DANGEROUS_MIME = /(html|xhtml|svg|xml|javascript|ecmascript|x-php|shockwave|x-sh\b|multipart\/related|message\/rfc822)/i;
/** Excepciones: tipos de oficina que llevan "xml" en el nombre y no se ejecutan. */
const OFFICE_MIME = /^application\/vnd\.(openxmlformats-officedocument|oasis\.opendocument)\./i;
/** Tipo declarado → extensión, para nombres sin extensión (p. ej. "upload" del portapapeles). */
const EXT_FOR_MIME: Record<string, string> = {
  'image/png': 'png', 'image/jpeg': 'jpg', 'image/gif': 'gif', 'image/webp': 'webp', 'image/avif': 'avif',
  'audio/webm': 'weba', 'audio/mpeg': 'mp3', 'audio/ogg': 'ogg', 'audio/mp4': 'm4a', 'audio/wav': 'wav',
  'video/webm': 'webm', 'video/mp4': 'mp4', 'application/pdf': 'pdf', 'text/plain': 'txt',
};

export class UploadError extends Error {
  constructor(
    public code: 'file_type_not_allowed' | 'storage_unavailable',
    public status: number,
  ) {
    super(code);
  }
}

function safeFilename(filename: string): string {
  return filename.replace(/[^a-zA-Z0-9._-]/g, '_').slice(-120) || 'upload';
}

function extOf(filename: string): string | null {
  const base = filename.split(/[\\/]/).pop() ?? '';
  const i = base.lastIndexOf('.');
  return i > 0 && i < base.length - 1 ? base.slice(i + 1).toLowerCase() : null;
}

function baseMime(contentType: string): string {
  return (contentType || '').split(';')[0].trim().toLowerCase();
}

/** Extensión con la que se guarda el archivo, o null si el tipo no está permitido. */
function storedExtension(filename: string, contentType: string): string | null {
  const mime = baseMime(contentType);
  if (mime && DANGEROUS_MIME.test(mime) && !OFFICE_MIME.test(mime)) return null;
  const ext = extOf(filename);
  if (ext) return ext in ALLOWED ? ext : null;
  return EXT_FOR_MIME[mime] ?? null;
}

export function isAllowedUpload(filename: string, contentType: string): boolean {
  return storedExtension(filename, contentType) !== null;
}

/** Tipo según la extensión (solo de la lista permitida); octet-stream si no. */
export function mimeForUploadName(name: string): string {
  const ext = extOf(name);
  return (ext && ALLOWED[ext]) || 'application/octet-stream';
}

/** Carpeta del disco donde van las subidas locales (fuera de public/). */
export function uploadsRoot(): string {
  const env = process.env.UPLOADS_DIR?.trim();
  return env ? path.resolve(env) : path.join(process.cwd(), 'data', 'uploads');
}

/** Donde guardaban las versiones anteriores: solo se lee (y se migra), nunca se sirve estático. */
export function legacyUploadsRoot(): string {
  return path.join(process.cwd(), 'public', 'uploads');
}

const LOCAL_NAME = /^[A-Za-z0-9_-][A-Za-z0-9._-]{0,199}$/;

/** "/uploads/<carpeta>/<nombre>" → [carpeta, nombre], o null si no tiene esa forma exacta. */
export function parseLocalUploadUrl(url: string): [UploadFolder, string] | null {
  const m = /^\/uploads\/([a-z]+)\/([^/]+)$/.exec(url);
  if (!m || !FOLDERS.has(m[1]) || !LOCAL_NAME.test(m[2]) || m[2].includes('..')) return null;
  return [m[1] as UploadFolder, m[2]];
}

/**
 * Ruta en disco de una subida local (/uploads/<carpeta>/<nombre>). Busca
 * primero en UPLOADS_DIR y, si no está, en el public/uploads de versiones
 * anteriores. null si la URL no es una subida local válida (o no es de `folder`).
 */
export function localUploadPath(url: string, folder?: UploadFolder): string | null {
  const parsed = parseLocalUploadUrl(url);
  if (!parsed || (folder && parsed[0] !== folder)) return null;
  const [dir, name] = parsed;
  const current = path.join(uploadsRoot(), dir, name);
  if (existsSync(current)) return current;
  const legacy = path.join(legacyUploadsRoot(), dir, name);
  return existsSync(legacy) ? legacy : current;
}

/** Guarda el archivo y devuelve su URL. */
export async function saveUpload(
  folder: UploadFolder,
  filename: string,
  contentType: string,
  buffer: Buffer,
): Promise<string> {
  const ext = storedExtension(filename, contentType);
  if (!ext) throw new UploadError('file_type_not_allowed', 415);

  let safe = safeFilename(filename);
  if (extOf(safe) !== ext) safe = `${safe}.${ext}`;
  const name = `${crypto.randomUUID()}-${safe}`;
  const type = ALLOWED[ext];

  if (process.env.BLOB_READ_WRITE_TOKEN) {
    const blob = await put(`${folder}/${name}`, buffer, {
      access: 'public',
      // El tipo sale de la extensión permitida, no del que mandó el cliente.
      contentType: type,
    });
    return blob.url;
  }

  if (process.env.VERCEL) throw new UploadError('storage_unavailable', 503);

  await migrateLegacyUploads();
  const dir = path.join(uploadsRoot(), folder);
  await mkdir(dir, { recursive: true });
  await writeFile(path.join(dir, name), buffer);
  return `/uploads/${folder}/${name}`;
}

/**
 * Borra archivos guardados con saveUpload (best effort: un fallo no corta el
 * borrado de las filas). Sin esto, el blob público seguía accesible con la URL
 * después de borrar el adjunto.
 */
export async function deleteUploads(urls: string[]): Promise<void> {
  const blobs = urls.filter((u) => /^https:\/\//.test(u));
  if (blobs.length > 0 && process.env.BLOB_READ_WRITE_TOKEN) {
    await del(blobs).catch(() => undefined);
  }
  for (const url of urls) {
    const parsed = parseLocalUploadUrl(url);
    if (!parsed) continue;
    for (const root of [uploadsRoot(), legacyUploadsRoot()]) {
      await unlink(path.join(root, parsed[0], parsed[1])).catch(() => undefined);
    }
  }
}

let migration: Promise<void> | null = null;

/**
 * Mueve lo que quedó en public/uploads (versiones anteriores) a UPLOADS_DIR,
 * una vez por proceso. Las URLs no cambian. Si algo no se puede mover, se
 * sigue leyendo desde ahí por localUploadPath (nunca como estático: next.config
 * reescribe /uploads/* antes de mirar public/).
 */
export function migrateLegacyUploads(): Promise<void> {
  if (process.env.VERCEL) return Promise.resolve();
  migration ??= (async () => {
    const legacy = legacyUploadsRoot();
    const target = uploadsRoot();
    if (path.resolve(legacy) === path.resolve(target)) return;
    for (const folder of FOLDERS) {
      const from = path.join(legacy, folder);
      const names = await readdir(from).catch(() => [] as string[]);
      if (names.length === 0) continue;
      const to = path.join(target, folder);
      await mkdir(to, { recursive: true });
      for (const name of names) {
        if (!LOCAL_NAME.test(name)) continue;
        const src = path.join(from, name);
        const dst = path.join(to, name);
        try {
          if (!(await stat(src)).isFile()) continue;
          if (existsSync(dst)) {
            await unlink(src);
            continue;
          }
          await rename(src, dst).catch(async (err: NodeJS.ErrnoException) => {
            if (err.code !== 'EXDEV') throw err;
            await copyFile(src, dst);
            await unlink(src);
          });
        } catch {
          // Se queda en public/uploads y se sigue leyendo desde ahí.
        }
      }
      await rmdir(from).catch(() => undefined);
    }
    await rmdir(legacy).catch(() => undefined);
  })();
  return migration;
}
