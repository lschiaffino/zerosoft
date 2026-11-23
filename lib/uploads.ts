import { existsSync } from 'fs';
import { copyFile, mkdir, readdir, rename, rmdir, stat, unlink } from 'fs/promises';
import path from 'path';
import { del } from '@vercel/blob';
import { currentFileOwner } from './files/owner-context';
import { deleteFileUrls, fileUrl, FileStoreError, isFileUrl, putFile, type FileAccess, type FileOwner } from './files/store';

/**
 * Almacenamiento de archivos subidos (adjuntos de Chat, Track, tareas del CRM,
 * bloques de imagen/archivo de Docs y Notes, imágenes de Board y de Design,
 * media del CRM y archivos de Robots).
 * Los bytes van a lib/files/store.ts (store privado de Blob, cifrado en el
 * store de la suite o disco local cifrado) y la URL que se guarda es
 * /api/files/<id>/<nombre>, que chequea sesión y permiso en cada pedido.
 *
 * Archivos de antes: URLs públicas de Blob o /uploads/<carpeta>/<nombre>
 * (disco local, los resuelve localUploadPath). El script
 * scripts/migrate-private-files.ts los pasa al storage privado.
 *
 * Solo se aceptan tipos de una lista permitida: imágenes raster, video, audio,
 * PDF, documentos de oficina, texto plano y comprimidos.
 */

export const MAX_UPLOAD_SIZE = 10 * 1024 * 1024; // 10 MB

export type UploadFolder = 'chat' | 'track' | 'tasks' | 'robots' | 'docs' | 'boards' | 'crm' | 'rec' | 'workspace' | 'design' | 'shop' | 'social' | 'people' | 'inbox';
const FOLDERS = new Set<string>(['chat', 'track', 'tasks', 'robots', 'docs', 'boards', 'crm', 'rec', 'workspace', 'design', 'shop', 'social', 'people', 'inbox']);

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
  // Lo que manda WhatsApp sin nombre de archivo (todos ya permitidos arriba).
  'image/heic': 'heic', 'audio/aac': 'aac', 'video/quicktime': 'mov', 'text/csv': 'csv', 'application/zip': 'zip',
  'application/msword': 'doc', 'application/vnd.ms-excel': 'xls', 'application/vnd.ms-powerpoint': 'ppt',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document': 'docx',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': 'xlsx',
  'application/vnd.openxmlformats-officedocument.presentationml.presentation': 'pptx',
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

export interface SaveUploadOptions {
  /** Workspace (id del owner) del archivo. Sin él, el de la sesión; sin sesión (webhooks, crons) es obligatorio. */
  workspaceId?: string;
  /** Persona que lo sube (la dueña, si access es 'user'). Sin él, la de la sesión. */
  userId?: string | null;
  /** App cuyo acceso se chequea al servirlo ('workspace'). */
  app?: string | null;
  /** Quién lo puede leer (lib/files/store.ts). Por defecto, el de la carpeta. */
  access?: FileAccess;
  /** Permiso más fino dentro del workspace (lib/files/scopes.ts), p. ej. "chat-widget:<id>". */
  scope?: string | null;
}

/**
 * Quién lee lo de cada carpeta si quien guarda no lo dice. Público solo lo
 * que lo es por diseño: logos de workspace, fotos de la tienda y lo que sale
 * a redes (las redes lo bajan por URL). Inbox es de una persona.
 */
const DEFAULT_ACCESS: Record<UploadFolder, FileAccess> = {
  chat: 'workspace',
  track: 'workspace',
  tasks: 'workspace',
  robots: 'workspace',
  docs: 'internal',
  boards: 'internal',
  crm: 'internal',
  rec: 'internal',
  workspace: 'public',
  design: 'internal',
  shop: 'public',
  social: 'public',
  people: 'workspace',
  inbox: 'user',
};

/**
 * Guarda el archivo y devuelve su URL: /api/files/<id>/<nombre>, de nuestro
 * dominio. Los bytes van al storage privado (lib/files/store.ts): nunca hay
 * una URL pública del storage.
 */
export async function saveUpload(
  folder: UploadFolder,
  filename: string,
  contentType: string,
  buffer: Buffer,
  opts: SaveUploadOptions = {},
): Promise<string> {
  const ext = storedExtension(filename, contentType);
  if (!ext) throw new UploadError('file_type_not_allowed', 415);

  let safe = safeFilename(filename);
  if (extOf(safe) !== ext) safe = `${safe}.${ext}`;
  // El tipo sale de la extensión permitida, no del que mandó el cliente.
  const type = ALLOWED[ext];

  let workspaceId = opts.workspaceId;
  let userId = opts.userId;
  // Dentro de un trabajo sin sesión (import, webhook, cron): el dueño que dejó quien lo corre.
  const ctx = !workspaceId ? currentFileOwner() : null;
  if (ctx) {
    workspaceId = ctx.workspaceId;
    if (userId === undefined) userId = ctx.userId;
  }
  if (!workspaceId || userId === undefined) {
    const { getCurrentUser } = await import('./session');
    const user = await getCurrentUser().catch(() => null);
    if (user) {
      workspaceId ??= user.id;
      if (userId === undefined) userId = user.actingUser?.id ?? user.id;
    }
  }
  if (!workspaceId) throw new Error('saveUpload: falta el workspace del archivo');
  try {
    const row = await putFile(buffer, {
      workspaceId,
      userId: userId ?? null,
      app: opts.app ?? null,
      folder,
      access: opts.access ?? DEFAULT_ACCESS[folder],
      scope: opts.scope ?? null,
      name: safe,
      mime: type,
    });
    return fileUrl(row);
  } catch (err) {
    if (err instanceof FileStoreError && err.code === 'storage_unavailable') throw new UploadError('storage_unavailable', 503);
    throw err;
  }
}

/**
 * Borra archivos guardados con saveUpload (best effort: un fallo no corta el
 * borrado de las filas). Acepta las URLs de /api/files y las de antes
 * (Blob público o /uploads/…).
 */
export async function deleteUploads(urls: string[]): Promise<void> {
  const own = urls.filter((u) => isFileUrl(u));
  if (own.length) await deleteFileUrls(own).catch(() => undefined);
  const blobs = urls.filter((u) => /^https:\/\//.test(u) && !isFileUrl(u));
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

/**
 * deleteUploads para URLs que llegaron del cliente (o se guardaron desde él):
 * un archivo de /api/files se borra solo si es de `owner` (ownedFileRow) y,
 * con `folder`, si está en esa carpeta (lo de una app no se borra desde
 * otra); uno ajeno queda como está. Las URLs de antes (Blob, /uploads) siguen igual.
 */
export async function deleteOwnedUploads(owner: FileOwner, urls: string[], opts: { folder?: string } = {}): Promise<void> {
  const { ownedFileRow } = await import('./files/store');
  const keep: string[] = [];
  for (const url of urls) {
    if (!url) continue;
    if (!isFileUrl(url)) {
      keep.push(url);
      continue;
    }
    const row = await ownedFileRow(url, owner);
    if (row && (!opts.folder || row.folder === opts.folder)) keep.push(url);
  }
  if (keep.length) await deleteUploads(keep);
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

/**
 * Bytes de un archivo guardado, sea de ahora (/api/files/…) o de antes
 * (/uploads/… o el Blob público de la suite), con tope. Para lo que procesa
 * el servidor (mandar por WhatsApp, transcribir, armar un PDF). Nada de hosts
 * arbitrarios: null si la URL no es nuestra, no está o pasa de `max`.
 *
 * `owner`: el workspace (o la persona) del registro que tenía la URL. Un
 * archivo de /api/files solo se lee si es suyo (o público por diseño): la URL
 * la pudo escribir el cliente y no puede servir para leer archivos ajenos.
 */
export async function readUploadBytes(url: string, owner: FileOwner | null, max = 64 * 1024 * 1024): Promise<Buffer | null> {
  if (!url) return null;
  if (isFileUrl(url)) {
    const { fileRowForUrl, readFileBytes } = await import('./files/store');
    const row = await fileRowForUrl(url);
    if (!row) return null;
    const mine = (owner?.workspaceId && row.workspace_id === owner.workspaceId) || (owner?.userId && row.user_id === owner.userId);
    if (!mine && row.access !== 'public') return null;
    return readFileBytes(row, max);
  }
  if (url.startsWith('/uploads/')) {
    const file = localUploadPath(url);
    if (!file) return null;
    const st = await stat(file).catch(() => null);
    if (!st?.isFile() || st.size > max) return null;
    const { readFile } = await import('fs/promises');
    return readFile(file).catch(() => null);
  }
  let u: URL;
  try {
    u = new URL(url);
  } catch {
    return null;
  }
  if (u.protocol !== 'https:' || !/^[a-z0-9-]+\.public\.blob\.vercel-storage\.com$/i.test(u.hostname)) return null;
  const res = await fetch(u, { signal: AbortSignal.timeout(30_000) }).catch(() => null);
  if (!res?.ok) return null;
  const len = Number(res.headers.get('content-length') ?? 0);
  if (len > max) return null;
  const buf = Buffer.from(await res.arrayBuffer());
  return buf.length <= max ? buf : null;
}

/** ¿Es una URL de un archivo guardado por nosotros (de ahora o de antes)? `folder` solo filtra las de antes. */
export function isOwnUploadUrl(url: string | null | undefined, folder?: UploadFolder): boolean {
  if (!url) return false;
  if (isFileUrl(url)) return true;
  if (url.startsWith('/uploads/')) {
    const parsed = parseLocalUploadUrl(url);
    return parsed !== null && (!folder || parsed[0] === folder);
  }
  try {
    const u = new URL(url);
    return u.protocol === 'https:' && /^[a-z0-9-]+\.public\.blob\.vercel-storage\.com$/i.test(u.hostname) && (!folder || u.pathname.startsWith(`/${folder}/`));
  } catch {
    return false;
  }
}
