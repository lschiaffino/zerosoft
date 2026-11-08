/**
 * Adjuntos privados de cualquier tipo y tamaño (Track, y después tareas del
 * CRM, Lines, etc.). Server-only. El cliente es lib/file-attachments-client.ts.
 *
 * Nunca hay URL pública: lo guardado en la base es una referencia
 * ("blobp:<pathname>" o "local:<uuid>.bin") y el archivo se sirve solo por una
 * ruta de la app que chequea permisos.
 *
 * Dónde se guarda (storageMode):
 * - 'blob': Vercel Blob privado. Token: <APP>_BLOB_READ_WRITE_TOKEN o, si no,
 *   FILES_BLOB_READ_WRITE_TOKEN (un store privado compartido). El navegador
 *   sube directo al store (sin el límite de 4,5 MB de las funciones), con
 *   multipart para archivos grandes; el servidor solo firma el token.
 * - 'local': self-host y tests (sin token y fuera de Vercel). El navegador
 *   manda el archivo a la app en el cuerpo del pedido y se guarda cifrado en
 *   UPLOADS_DIR/<app> (privateFileStore, en stream). Tope:
 *   FILES_LOCAL_MAX_BYTES (por defecto 2 GiB).
 * - 'unavailable': en Vercel sin store privado. Se responde 503
 *   `storage_not_configured`; nunca se cae a un store público.
 *
 * API (ejemplo con Track; para otra app cambian app, envPrefix y los callbacks):
 *
 *   const files = fileAttachments({ app: 'track', envPrefix: 'TRACK' });
 *   const routes = attachmentRoutes<Row>({
 *     files,
 *     // Sesión ya validada: devolver el id del registro (del workspace de la
 *     // sesión) o null → 404. Nunca usar ids del cliente sin chequearlos acá.
 *     authorize: async ({ user, params }) => (await getAccessibleIssue(params.id, …))?.issue.id ?? null,
 *     save: ({ user, recordId, file }) => createRow(recordId, file),   // file: StoredFile
 *     find: ({ recordId, fileId }) => rowOf(fileId, recordId),         // { url, filename, contentType } | null
 *   });
 *   // GET (config) y POST (token de Blob o archivo en el cuerpo, modo local):
 *   export const { GET, POST } = routes.upload;     // …/attachments/upload
 *   export const { POST } = routes.finalize;        // …/attachments/finalize
 *   export const { GET } = routes.file;             // …/attachments/[fileId] (?download=1)
 *
 * Funciones sueltas: storageMode(), prefixFor(), isAllowedPathname(),
 * servingFor() (decisión inline/attachment y headers), serveStoredFile(),
 * deleteStoredFiles() (refs nuevas y URLs viejas de saveUpload) e
 * isPrivateRef().
 *
 * Variables: <APP>_BLOB_READ_WRITE_TOKEN | FILES_BLOB_READ_WRITE_TOKEN (store
 * privado), <APP>_FILES_KEY (clave del cifrado local; si no, derivada de
 * ENCRYPTION_KEY / NEXTAUTH_SECRET), FILES_LOCAL_MAX_BYTES.
 */
import { randomUUID } from 'crypto';
import { NextRequest, NextResponse } from 'next/server';
import { del, get, head } from '@vercel/blob';
import { handleUpload, type HandleUploadBody } from '@vercel/blob/client';
import { contentDisposition } from './docs-files';
import { privateFileStore, SealedFileTooLargeError, type PrivateFileStore } from './private-files';
import { getCurrentUser, type SessionUser } from './session';
import { appFromPath } from './products';
import { deleteUploads } from './uploads';
import { userCanUseApp } from './workspace';
import { limitWrites } from './write-limit';

/** Subidas (o permisos de subida a Blob) por persona y minuto. */
export const UPLOADS_PER_MINUTE = 120;

export type StorageMode = 'blob' | 'local' | 'unavailable';

export interface FileAttachmentsOptions {
  /** Carpeta en Blob y en disco, y prefijo de los pathnames: 'track', 'crm', 'lines'. */
  app: string;
  /** Prefijo de las variables: TRACK → TRACK_BLOB_READ_WRITE_TOKEN, TRACK_FILES_KEY. */
  envPrefix: string;
  /** Máximo por archivo en Blob (por defecto 5 GiB). */
  maxBytes?: number;
}

export interface FileAttachments {
  app: string;
  envPrefix: string;
  maxBytes: number;
  store: PrivateFileStore;
}

/** Lo que queda guardado después de subir: va a la fila de la app. */
export interface StoredFile {
  /** "blobp:<pathname>" o "local:<uuid>.bin": va en la columna url de la fila. */
  ref: string;
  filename: string;
  contentType: string;
  size: number;
}

const GiB = 1024 * 1024 * 1024;

export class AttachmentStorageError extends Error {
  constructor(public code: 'storage_not_configured', public status = 503) {
    super(code);
  }
}

export function fileAttachments(o: FileAttachmentsOptions): FileAttachments {
  if (!/^[a-z][a-z0-9-]*$/.test(o.app)) throw new Error(`app inválida: ${o.app}`);
  return {
    app: o.app,
    envPrefix: o.envPrefix,
    maxBytes: o.maxBytes ?? 5 * GiB,
    store: privateFileStore({
      folder: `${o.app}-files`,
      envPrefix: o.envPrefix,
      hkdfLabel: `${o.app}-attachments`,
      magic: 'ZSA1',
      unavailable: () => new AttachmentStorageError('storage_not_configured'),
    }),
  };
}

/** Token del store privado: el de la app o el compartido. */
export function privateToken(f: Pick<FileAttachments, 'envPrefix'>): string | null {
  return process.env[`${f.envPrefix}_BLOB_READ_WRITE_TOKEN`]?.trim() || process.env.FILES_BLOB_READ_WRITE_TOKEN?.trim() || null;
}

export function storageMode(f: Pick<FileAttachments, 'envPrefix'>): StorageMode {
  if (privateToken(f)) return 'blob';
  if (process.env.VERCEL) return 'unavailable';
  return 'local';
}

export function localMaxBytes(): number {
  const n = Number(process.env.FILES_LOCAL_MAX_BYTES);
  return Number.isFinite(n) && n > 0 ? n : 2 * GiB;
}

export function isPrivateRef(url: string | null | undefined): boolean {
  return typeof url === 'string' && (url.startsWith('blobp:') || url.startsWith('local:'));
}

// ---------- Pathnames ----------

const RECORD_ID = /^[A-Za-z0-9_-]{1,64}$/;

/** "track/<recordId>/": todo lo que se sube para ese registro cuelga de acá. */
export function prefixFor(f: Pick<FileAttachments, 'app'>, recordId: string): string {
  if (!RECORD_ID.test(recordId)) throw new Error('recordId inválido');
  return `${f.app}/${recordId}/`;
}

/**
 * El pathname es exactamente "<app>/<recordId>/<un segmento>", sin "..", barras
 * de más ni caracteres de control. Blob agrega un sufijo al azar antes de la
 * extensión, así que el segmento final puede ser cualquiera de nombre seguro.
 */
export function isAllowedPathname(f: Pick<FileAttachments, 'app'>, pathname: unknown, recordId: string): pathname is string {
  if (typeof pathname !== 'string' || pathname.length > 900) return false;
  if (!RECORD_ID.test(recordId)) return false;
  const prefix = `${f.app}/${recordId}/`;
  if (!pathname.startsWith(prefix)) return false;
  const rest = pathname.slice(prefix.length);
  return /^[A-Za-z0-9][A-Za-z0-9._-]{0,250}$/.test(rest) && !rest.includes('..');
}

/** Segmento final seguro para un nombre de archivo cualquiera: "<uuid>-<nombre>". */
export function safeSegment(filename: string): string {
  const clean = filename
    .normalize('NFKD')
    .replace(/[^A-Za-z0-9._-]+/g, '_')
    .replace(/\.{2,}/g, '.')
    .replace(/^[._-]+/, '')
    .slice(-120);
  return `${randomUUID()}-${clean || 'file'}`;
}

/** Nombre a mostrar: sin rutas ni caracteres de control, hasta 255. */
export function cleanDisplayName(name: unknown): string {
  const raw = typeof name === 'string' ? name : '';
  // eslint-disable-next-line no-control-regex
  const base = (raw.split(/[\\/]/).pop() ?? '').replace(/[\u0000-\u001f\u007f]/g, '').trim();
  return base.slice(0, 255) || 'file';
}

const MIME_RE = /^[\w.+-]+\/[\w.+-]+$/;
export function cleanMime(type: unknown): string {
  const t = typeof type === 'string' ? type.split(';')[0].trim().toLowerCase() : '';
  return MIME_RE.test(t) ? t.slice(0, 120) : 'application/octet-stream';
}

// ---------- Servir ----------

/** Extensión → tipo de lo único que se muestra en línea: imágenes raster, PDF, texto plano, audio y video. */
const PREVIEWABLE: Record<string, string> = {
  png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', gif: 'image/gif', webp: 'image/webp', avif: 'image/avif', bmp: 'image/bmp',
  pdf: 'application/pdf',
  txt: 'text/plain', log: 'text/plain', md: 'text/plain', csv: 'text/plain',
  mp3: 'audio/mpeg', m4a: 'audio/mp4', aac: 'audio/aac', wav: 'audio/wav', ogg: 'audio/ogg', oga: 'audio/ogg', opus: 'audio/ogg',
  flac: 'audio/flac', weba: 'audio/webm',
  mp4: 'video/mp4', m4v: 'video/mp4', webm: 'video/webm', mov: 'video/quicktime', ogv: 'video/ogg',
};
const PREVIEWABLE_TYPES = new Set(Object.values(PREVIEWABLE));
/** Tipos que un navegador podría ejecutar o interpretar como documento. */
const DANGEROUS = /(html|xhtml|svg|xml|javascript|ecmascript|x-sh\b|x-php|shockwave|multipart\/|message\/)/i;

export type PreviewKind = 'image' | 'pdf' | 'text' | 'audio' | 'video' | null;

export interface Serving {
  inline: boolean;
  contentType: string;
  preview: PreviewKind;
  headers: Record<string, string>;
}

function extOf(name: string): string {
  const base = name.split(/[\\/]/).pop() ?? '';
  const i = base.lastIndexOf('.');
  return i > 0 ? base.slice(i + 1).toLowerCase() : '';
}

/** Qué se puede previsualizar, según nombre y tipo declarado (lo mismo que decide servingFor). */
export function previewKind(filename: string, declaredType?: string | null): PreviewKind {
  const declared = cleanMime(declaredType);
  if (DANGEROUS.test(declared)) return null;
  const ext = extOf(filename);
  // Con extensión manda la extensión: "x.exe" declarado como image/png se descarga igual.
  const type = ext ? PREVIEWABLE[ext] : PREVIEWABLE_TYPES.has(declared) ? declared : undefined;
  if (!type) return null;
  if (type.startsWith('image/')) return 'image';
  if (type === 'application/pdf') return 'pdf';
  if (type.startsWith('text/')) return 'text';
  if (type.startsWith('audio/')) return 'audio';
  return 'video';
}

/**
 * Decide cómo se sirve un archivo: en línea solo lo previsualizable y seguro
 * (con el tipo de la lista, nunca el declarado), todo lo demás como descarga
 * application/octet-stream. Siempre nosniff; CSP sandbox salvo el PDF en
 * línea (el visor de PDF de Chrome no abre en un documento con sandbox).
 */
export function servingFor(filename: string, declaredType?: string | null, opts: { download?: boolean } = {}): Serving {
  const preview = previewKind(filename, declaredType);
  const ext = extOf(filename);
  const type = preview ? (ext ? PREVIEWABLE[ext] : cleanMime(declaredType)) : null;
  const inline = Boolean(preview && type && !opts.download);
  const contentType = inline && type ? (type === 'text/plain' ? 'text/plain; charset=utf-8' : type) : 'application/octet-stream';
  const headers: Record<string, string> = {
    'Content-Type': contentType,
    'Content-Disposition': contentDisposition(filename || 'file', inline),
    'X-Content-Type-Options': 'nosniff',
    'Content-Security-Policy':
      inline && preview === 'pdf'
        ? "default-src 'none'; img-src data:; style-src 'unsafe-inline'; frame-ancestors 'self'"
        : "default-src 'none'; sandbox",
    'Cross-Origin-Resource-Policy': 'same-origin',
    'Referrer-Policy': 'no-referrer',
    // El permiso se chequea en cada pedido: nada de caches compartidos.
    'Cache-Control': 'private, max-age=300',
  };
  return { inline, contentType, preview: inline ? preview : null, headers };
}

/**
 * Respuesta con el archivo (en stream) para una ruta que ya chequeó acceso.
 * null si el archivo no está (la ruta responde 404).
 */
export async function serveStoredFile(
  f: FileAttachments,
  file: { url: string; filename: string; contentType?: string | null },
  opts: { download?: boolean; range?: string | null } = {},
): Promise<Response | null> {
  const s = servingFor(file.filename, file.contentType, opts);
  if (file.url.startsWith('blobp:')) {
    const token = privateToken(f);
    if (!token) return null;
    const pathname = file.url.slice(6);
    if (!pathname.startsWith(`${f.app}/`)) return null;
    const range = opts.range && /^bytes=\d*-\d*$/.test(opts.range) ? opts.range : null;
    const res = await get(pathname, { access: 'private', token, useCache: false, headers: range ? { Range: range } : undefined }).catch(() => null);
    if (!res || res.statusCode !== 200 || !res.stream) return null;
    const out: Record<string, string> = { ...s.headers, 'Accept-Ranges': 'bytes' };
    const len = res.headers.get('content-length');
    if (len) out['Content-Length'] = len;
    const cr = res.headers.get('content-range');
    if (cr) out['Content-Range'] = cr;
    return new NextResponse(res.stream as BodyInit, { status: cr ? 206 : 200, headers: out });
  }
  if (file.url.startsWith('local:')) {
    const opened = await f.store.readSealedStream(file.url);
    if (!opened) return null;
    return new NextResponse(opened.stream as BodyInit, { headers: { ...s.headers, 'Content-Length': String(opened.size) } });
  }
  return null;
}

// ---------- Borrar ----------

/**
 * Borra los archivos de filas ya borradas (best effort). Acepta refs nuevas
 * ("blobp:", "local:") y URLs viejas de saveUpload (/uploads/… o Blob público).
 */
export async function deleteStoredFiles(f: FileAttachments, urls: Array<string | null | undefined>): Promise<void> {
  const legacy: string[] = [];
  for (const url of urls) {
    if (!url) continue;
    if (url.startsWith('blobp:')) {
      const token = privateToken(f);
      if (token) await del(url.slice(6), { token }).catch(() => undefined);
    } else if (url.startsWith('local:')) {
      await f.store.removeOne(url);
    } else {
      legacy.push(url);
    }
  }
  if (legacy.length) await deleteUploads(legacy);
}

// ---------- Rutas ----------

export interface AttachmentRouteContext {
  user: SessionUser;
  req: NextRequest;
  params: Record<string, string>;
}

export interface AttachmentRoutesOptions<Row> {
  files: FileAttachments;
  /** Id del registro si la sesión puede adjuntar/leer ahí (scope del workspace), o null → 404. */
  authorize: (ctx: AttachmentRouteContext) => Promise<string | null>;
  /** Guarda la fila con el archivo ya subido y la devuelve (la ve el cliente). */
  save: (ctx: AttachmentRouteContext & { recordId: string; file: StoredFile }) => Promise<Row>;
  /** Fila del archivo `fileId` dentro de `recordId`, o null. */
  find: (ctx: AttachmentRouteContext & { recordId: string; fileId: string }) => Promise<{ url: string; filename: string; contentType?: string | null } | null>;
}

type Ctx = { params: Promise<Record<string, string | string[]>> };

const json = (body: unknown, status = 200) => NextResponse.json(body, { status, headers: { 'Cache-Control': 'no-store' } });

async function context(req: NextRequest, ctx: Ctx): Promise<AttachmentRouteContext | Response> {
  const user = await getCurrentUser();
  if (!user) return json({ error: 'unauthorized' }, 401);
  // La subida no pasa por el middleware (cortaría el cuerpo en 10 MB), así que
  // el acceso por app en un workspace ajeno se chequea acá con el path real.
  if (user.actingUser) {
    const app = appFromPath(req.nextUrl.pathname);
    if (app && !userCanUseApp(user, app)) return json({ error: 'unauthorized' }, 401);
  }
  const raw = await ctx.params;
  const params: Record<string, string> = {};
  for (const [k, v] of Object.entries(raw)) if (typeof v === 'string') params[k] = v;
  return { user, req, params };
}

/**
 * Handlers de las tres rutas de adjuntos de un registro. Cada una valida la
 * sesión y llama a authorize antes de tocar nada.
 */
export function attachmentRoutes<Row>(o: AttachmentRoutesOptions<Row>) {
  const { files } = o;

  async function authorized(req: NextRequest, ctx: Ctx): Promise<(AttachmentRouteContext & { recordId: string }) | Response> {
    const c = await context(req, ctx);
    if (c instanceof Response) return c;
    const recordId = await o.authorize(c).catch(() => null);
    if (!recordId) return json({ error: 'not_found' }, 404);
    return { ...c, recordId };
  }

  /** GET: modo de almacenamiento y prefijo para armar el pathname. */
  async function uploadGET(req: NextRequest, ctx: Ctx) {
    const c = await authorized(req, ctx);
    if (c instanceof Response) return c;
    const mode = storageMode(files);
    if (mode === 'unavailable') return json({ error: 'storage_not_configured', mode }, 503);
    return json({ mode, prefix: prefixFor(files, c.recordId), maxBytes: mode === 'blob' ? files.maxBytes : localMaxBytes() });
  }

  /**
   * POST: en modo Blob, el pedido JSON de upload() de @vercel/blob/client
   * (firma un token solo para un pathname bajo el prefijo del registro); en
   * modo local, el archivo en el cuerpo (nombre en ?name=, tipo en
   * Content-Type) y se responde la fila guardada.
   */
  async function uploadPOST(req: NextRequest, ctx: Ctx) {
    const c = await authorized(req, ctx);
    if (c instanceof Response) return c;
    const mode = storageMode(files);
    if (mode === 'unavailable') return json({ error: 'storage_not_configured' }, 503);
    // Cada pedido es un archivo en el storage: tope por persona.
    const limited = await limitWrites(`${files.app}:files`, c.user.actingUser?.id ?? c.user.id, UPLOADS_PER_MINUTE);
    if (limited) return limited;

    if (mode === 'blob') {
      const body = (await req.json().catch(() => null)) as HandleUploadBody | null;
      // Solo pedidos de token: no hay callback de Vercel (se registra con finalize).
      if (!body || body.type !== 'blob.generate-client-token') return json({ error: 'invalid_input' }, 400);
      try {
        const result = await handleUpload({
          body,
          request: req,
          token: privateToken(files)!,
          onBeforeGenerateToken: async (pathname) => {
            if (!isAllowedPathname(files, pathname, c.recordId)) throw new Error('pathname_not_allowed');
            return {
              // Cualquier tipo: no se limita allowedContentTypes.
              maximumSizeInBytes: files.maxBytes,
              addRandomSuffix: true,
              allowOverwrite: false,
              validUntil: Date.now() + 60 * 60 * 1000,
            };
          },
        });
        return json(result);
      } catch (err) {
        if (err instanceof Error && err.message === 'pathname_not_allowed') return json({ error: 'forbidden' }, 403);
        console.error(`[${files.app}-files] no se pudo firmar la subida`, err);
        return json({ error: 'generic' }, 500);
      }
    }

    // Modo local: el cuerpo es el archivo, en stream y cifrado a disco.
    if (!req.body) return json({ error: 'invalid_input' }, 400);
    const declared = Number(req.headers.get('content-length'));
    if (Number.isFinite(declared) && declared > localMaxBytes()) return json({ error: 'too_large' }, 413);
    const filename = cleanDisplayName(req.nextUrl.searchParams.get('name'));
    const contentType = cleanMime(req.headers.get('content-type'));
    let saved: { ref: string; size: number };
    try {
      saved = await files.store.writeSealed(req.body as unknown as AsyncIterable<Uint8Array>, localMaxBytes());
    } catch (err) {
      if (err instanceof SealedFileTooLargeError) return json({ error: 'too_large' }, 413);
      console.error(`[${files.app}-files] no se pudo guardar un archivo`, err);
      return json({ error: 'generic' }, 500);
    }
    if (saved.size === 0) {
      await files.store.removeOne(saved.ref);
      return json({ error: 'invalid_input' }, 400);
    }
    // Un cuerpo cortado en el camino (proxy, middleware) no se guarda como si estuviera completo.
    if (Number.isFinite(declared) && req.headers.get('content-length') !== null && saved.size !== declared) {
      await files.store.removeOne(saved.ref);
      console.error(`[${files.app}-files] cuerpo incompleto: ${saved.size} de ${declared} bytes`);
      return json({ error: 'incomplete_upload' }, 400);
    }
    try {
      const row = await o.save({ ...c, file: { ref: saved.ref, filename, contentType, size: saved.size } });
      return json(row, 201);
    } catch (err) {
      await files.store.removeOne(saved.ref);
      throw err;
    }
  }

  /**
   * POST { pathname, filename }: después de upload() en modo Blob. Verifica
   * que el blob exista bajo el prefijo del registro y toma tamaño y tipo del
   * store (no del cliente).
   */
  async function finalizePOST(req: NextRequest, ctx: Ctx) {
    const c = await authorized(req, ctx);
    if (c instanceof Response) return c;
    const token = privateToken(files);
    if (!token) return json({ error: 'storage_not_configured' }, 503);
    const body = (await req.json().catch(() => null)) as { pathname?: unknown; filename?: unknown } | null;
    if (!body || !isAllowedPathname(files, body.pathname, c.recordId)) return json({ error: 'forbidden' }, 403);
    const meta = await head(body.pathname, { token }).catch(() => null);
    if (!meta || meta.pathname !== body.pathname) return json({ error: 'not_found' }, 404);
    const row = await o.save({
      ...c,
      file: { ref: `blobp:${meta.pathname}`, filename: cleanDisplayName(body.filename), contentType: cleanMime(meta.contentType), size: meta.size },
    });
    return json(row, 201);
  }

  /** GET (?download=1): el archivo, con los headers de servingFor. */
  async function fileGET(req: NextRequest, ctx: Ctx) {
    const c = await authorized(req, ctx);
    if (c instanceof Response) return c;
    const fileId = c.params.fileId;
    if (!fileId) return json({ error: 'not_found' }, 404);
    const row = await o.find({ ...c, fileId });
    if (!row) return json({ error: 'not_found' }, 404);
    const download = req.nextUrl.searchParams.get('download') === '1';
    if (!isPrivateRef(row.url)) {
      // Adjuntos de antes (/uploads/… o Blob público): se sirven donde estaban.
      if (/^\/uploads\/[a-z]+\/[^/]+$/.test(row.url) || /^https:\/\/[a-z0-9-]+\.public\.blob\.vercel-storage\.com\//i.test(row.url)) {
        return NextResponse.redirect(new URL(row.url, req.nextUrl.origin), 302);
      }
      return json({ error: 'not_found' }, 404);
    }
    const res = await serveStoredFile(files, row, { download, range: req.headers.get('range') });
    return res ?? json({ error: 'not_found' }, 404);
  }

  return {
    upload: { GET: uploadGET, POST: uploadPOST },
    finalize: { POST: finalizePOST },
    file: { GET: fileGET },
  };
}
