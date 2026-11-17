/**
 * Subida directa del navegador al storage (archivos más grandes que el tope
 * de 4,5 MB del cuerpo de una función de Vercel), sin que quede nada público.
 * Server-only. El cliente es lib/files/direct-upload-client.ts.
 *
 *   GET  /api/files/upload           → { mode, access, prefix, max } (mode 'server': subir por la ruta de la app)
 *   POST /api/files/upload           → protocolo de @vercel/blob/client (firma un token para un solo pathname)
 *   POST /api/files/upload/finalize  → { url } de /api/files: el archivo ya registrado y privado
 *
 * Con store privado (FILES_BLOB_READ_WRITE_TOKEN) el navegador sube con
 * `access: 'private'` y al terminar solo se registra: nada se copia. Sin store
 * privado sube al store de la suite bajo incoming/<persona>/<azar>, una ruta
 * que no se muestra nunca; al terminar, el servidor lo pasa en stream a
 * cifrado (lib/files/store.ts), relee el tamaño y borra el original. El
 * archivo en claro existe solo lo que dura la subida y esa copia, con un
 * nombre que nadie más conoce. El cron de la cola borra lo que quedó sin
 * terminar.
 *
 * Cada `purpose` fija tope, tipos, app y quién lo lee.
 */
import { createHmac } from 'crypto';
import { WA_MEDIA_LIMITS } from '../groups-media';
import { isAllowedUpload } from '../uploads';
import { fileBackend, fileUrl, FileStoreError, privateFilesToken, putFile, newFileId, type FileAccess, type StoredFileRow } from './store';
import { getDb } from '../db';

export const DIRECT_PURPOSES = ['lines-media', 'inbox-media', 'inbox-schedule', 'crm-media', 'docs', 'notes', 'inbox-import', 'import-zip'] as const;
export type DirectPurpose = (typeof DIRECT_PURPOSES)[number];

const MB = 1024 * 1024;

/** Nada que el navegador ejecute (HTML, SVG, JS, XML). */
const MEDIA_TYPES = [
  'image/png', 'image/jpeg', 'image/gif', 'image/webp', 'image/avif', 'image/bmp', 'image/heic', 'image/heif', 'image/tiff',
  'video/*', 'audio/*', 'application/pdf', 'application/zip', 'application/x-zip-compressed', 'application/gzip',
  'application/msword', 'application/vnd.ms-excel', 'application/vnd.ms-powerpoint',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  'application/vnd.oasis.opendocument.text', 'application/vnd.oasis.opendocument.spreadsheet',
  'application/vnd.oasis.opendocument.presentation', 'application/rtf', 'application/epub+zip',
  'application/json', 'application/octet-stream', 'application/x-7z-compressed', 'application/vnd.rar', 'application/x-tar',
  'text/plain', 'text/csv', 'text/markdown', 'text/calendar', 'text/vcard',
];

interface PurposeRule {
  max: number;
  types: string[];
  folder: 'chat' | 'inbox' | 'crm' | 'docs' | 'imports';
  app: string;
  access: FileAccess;
  /** Solo estas extensiones (si no, las de la lista general de subidas). */
  exts?: string[];
}

export const PURPOSES: Record<DirectPurpose, PurposeRule> = {
  // Lo ve quien lo sube; ya mandado, el chat lo sirve por /api/groups/media/<mensaje>.
  'lines-media': { max: WA_MEDIA_LIMITS.document, types: MEDIA_TYPES, folder: 'chat', app: 'groups', access: 'user' },
  'inbox-media': { max: WA_MEDIA_LIMITS.document, types: MEDIA_TYPES, folder: 'inbox', app: 'inbox', access: 'user' },
  'inbox-schedule': { max: 16 * MB, types: MEDIA_TYPES, folder: 'inbox', app: 'inbox', access: 'user' },
  // CRM, Docs y Notes: solo por la ruta del registro (documento, video, página, nota).
  'crm-media': { max: 500 * MB, types: ['application/pdf', 'video/*'], folder: 'crm', app: 'crm', access: 'internal' },
  docs: { max: 100 * MB, types: MEDIA_TYPES, folder: 'docs', app: 'docs', access: 'internal' },
  notes: { max: 100 * MB, types: MEDIA_TYPES, folder: 'docs', app: 'notes', access: 'internal' },
  // Archivos de importación: los lee solo el servidor (el import) y se borran al terminar.
  // La exportación de chats de Inbox (NDJSON, hasta 2 GB; lib/inbox/import-jobs.ts MAX_IMPORT_BYTES).
  'inbox-import': {
    max: 2 * 1024 * MB,
    types: ['application/x-ndjson', 'application/json', 'application/octet-stream', 'text/plain'],
    folder: 'imports',
    app: 'inbox',
    access: 'internal',
    exts: ['ndjson'],
  },
  // El zip de Notion, Evernote y demás (hasta 1 GB; lib/docs-notion-import.ts NOTION_MAX_ZIP_BYTES).
  'import-zip': {
    max: 1024 * MB,
    types: ['application/zip', 'application/x-zip-compressed', 'application/octet-stream'],
    folder: 'imports',
    app: 'docs',
    access: 'internal',
    exts: ['zip'],
  },
};

export function isPurpose(v: unknown): v is DirectPurpose {
  return typeof v === 'string' && (DIRECT_PURPOSES as readonly string[]).includes(v);
}

export type DirectMode = 'private' | 'sealed-blob' | 'server';

export function directMode(): DirectMode {
  const b = fileBackend();
  return b === 'private' ? 'private' : b === 'sealed-blob' ? 'sealed-blob' : 'server';
}

/** Carpeta de subidas en curso de una persona: no se puede adivinar de afuera. */
export function incomingPrefix(personId: string): string {
  const base = process.env.FILES_KEY?.trim() || process.env.ENCRYPTION_KEY || process.env.NEXTAUTH_SECRET || 'zerosoft-dev-encryption-key';
  const h = createHmac('sha256', base).update(`incoming:${personId}`).digest('base64url').slice(0, 22).replace(/[^A-Za-z0-9]/g, 'x');
  return `incoming/${h}/`;
}

/** incoming/<persona>/<uuid>-<nombre seguro> (Blob puede agregar un sufijo antes de la extensión). */
export function isIncomingPathname(pathname: unknown, personId: string): pathname is string {
  if (typeof pathname !== 'string' || pathname.length > 400) return false;
  const prefix = incomingPrefix(personId);
  if (!pathname.startsWith(prefix)) return false;
  const rest = pathname.slice(prefix.length);
  return /^[0-9a-f-]{36}-[A-Za-z0-9._-]{1,180}$/.test(rest) && !rest.includes('..');
}

/** Lo que pide onBeforeGenerateToken para ese propósito. */
export function tokenConstraints(purpose: DirectPurpose, pathname: string) {
  const rule = PURPOSES[purpose];
  const ext = (pathname.split('.').pop() ?? '').toLowerCase();
  if (rule.exts ? !rule.exts.includes(ext) : !isAllowedUpload(pathname, 'application/octet-stream')) throw new Error('file_type_not_allowed');
  return {
    maximumSizeInBytes: rule.max,
    allowedContentTypes: rule.types,
    addRandomSuffix: false,
    allowOverwrite: false,
    validUntil: Date.now() + 60 * 60 * 1000,
  };
}

export class DirectUploadError extends Error {
  constructor(public code: 'not_found' | 'forbidden' | 'file_too_large' | 'storage_unavailable' | 'file_type_not_allowed', public status: number) {
    super(code);
  }
}

/**
 * Después de la subida: registra el archivo (y en modo cifrado, lo cifra y
 * borra el original). Devuelve la fila. Idempotencia: un pathname ya
 * finalizado da not_found (el original ya no está).
 */
export async function finalizeDirectUpload(input: {
  pathname: string;
  purpose: DirectPurpose;
  name: string;
  workspaceId: string;
  personId: string;
  scope?: string | null;
}): Promise<StoredFileRow> {
  const rule = PURPOSES[input.purpose];
  const mode = directMode();
  if (mode === 'server') throw new DirectUploadError('storage_unavailable', 503);
  if (!isIncomingPathname(input.pathname, input.personId)) throw new DirectUploadError('forbidden', 403);
  const { head, del, get } = await import('@vercel/blob');
  const token = mode === 'private' ? privateFilesToken()! : undefined;
  const meta = await head(input.pathname, token ? { token } : undefined).catch(() => null);
  if (!meta || meta.pathname !== input.pathname) throw new DirectUploadError('not_found', 404);
  if (meta.size > rule.max) {
    await del(meta.url, token ? { token } : undefined).catch(() => undefined);
    throw new DirectUploadError('file_too_large', 413);
  }
  const mime = (meta.contentType || 'application/octet-stream').split(';')[0].trim().toLowerCase();
  if (/(html|xhtml|svg|xml|javascript|ecmascript)/i.test(mime) && !/officedocument|opendocument/.test(mime)) {
    await del(meta.url, token ? { token } : undefined).catch(() => undefined);
    throw new DirectUploadError('file_type_not_allowed', 415);
  }
  const owner = {
    workspaceId: input.workspaceId,
    userId: input.personId,
    app: rule.app,
    folder: rule.folder,
    access: rule.access,
    scope: input.scope ?? null,
    name: input.name,
    mime,
  };
  if (mode === 'private') {
    // Ya es privado: se mueve (copia del lado del store) a files/ y se registra. incoming/ queda solo para lo que está en curso.
    const { copy } = await import('@vercel/blob');
    const id = newFileId();
    const target = `files/${rule.folder}/${id}`;
    await copy(meta.url, target, { access: 'private', token: token!, contentType: mime, addRandomSuffix: false });
    await del(meta.url, { token: token! }).catch(() => undefined);
    const row: StoredFileRow = {
      id,
      workspace_id: owner.workspaceId,
      user_id: owner.userId,
      app: owner.app,
      folder: owner.folder,
      access: owner.access,
      scope: owner.scope,
      ref: `fsp:${target}`,
      name: (owner.name.split(/[\\/]/).pop() ?? 'file').slice(0, 255) || 'file',
      mime,
      size: meta.size,
      header: null,
      legacy_key: null,
      created_at: new Date().toISOString(),
    };
    await getDb()
      .prepare(
        `INSERT INTO stored_files (id, workspace_id, user_id, app, folder, access, scope, ref, name, mime, size, header, legacy_key, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(row.id, row.workspace_id, row.user_id, row.app, row.folder, row.access, row.scope, row.ref, row.name, row.mime, row.size, row.header, row.legacy_key, row.created_at);
    return row;
  }
  // Store de la suite: el original en claro pasa a cifrado y se borra.
  const res = await get(meta.url, { access: 'public', useCache: false }).catch(() => null);
  if (!res?.stream) throw new DirectUploadError('not_found', 404);
  let row: StoredFileRow;
  try {
    row = await putFile(res.stream as unknown as AsyncIterable<Uint8Array>, { ...owner, max: rule.max });
  } catch (err) {
    await del(meta.url).catch(() => undefined);
    if (err instanceof FileStoreError && err.code === 'file_too_large') throw new DirectUploadError('file_too_large', 413);
    throw err;
  }
  if (row.size !== meta.size) {
    const { deleteFileUrls } = await import('./store');
    await deleteFileUrls([fileUrl(row)]);
    await del(meta.url).catch(() => undefined);
    throw new DirectUploadError('not_found', 404);
  }
  await del(meta.url);
  return row;
}

/**
 * Borra subidas en curso que quedaron sin terminar (más de `olderThanMs`):
 * el navegador se cerró entre subir y finalizar. Para el cron.
 */
export async function sweepIncoming(olderThanMs = 3 * 3600_000, limit = 500): Promise<number> {
  const mode = directMode();
  if (mode === 'server') return 0;
  const { list, del } = await import('@vercel/blob');
  const token = mode === 'private' ? privateFilesToken()! : undefined;
  const cutoff = Date.now() - olderThanMs;
  let removed = 0;
  let cursor: string | undefined;
  do {
    const page = await list({ prefix: 'incoming/', cursor, limit: 1000, ...(token ? { token } : {}) }).catch(() => null);
    if (!page) break;
    const old = page.blobs.filter((b) => new Date(b.uploadedAt).getTime() < cutoff).map((b) => b.url);
    if (old.length) {
      await del(old, token ? { token } : undefined).catch(() => undefined);
      removed += old.length;
    }
    cursor = page.hasMore ? page.cursor : undefined;
  } while (cursor && removed < limit);
  return removed;
}
