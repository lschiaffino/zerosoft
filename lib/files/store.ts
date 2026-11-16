/**
 * Archivos de la suite: fotos y audios de los chats, adjuntos, documentos,
 * imágenes de páginas, logos. Server-only.
 *
 * Nada de lo que alguien guarda tiene una URL pública de storage. Cada
 * archivo es una fila de `stored_files` (con su workspace, su dueño, su app y
 * quién lo puede leer) y se sirve solo por /api/files/<id>/<nombre>, que
 * chequea la sesión y el permiso (app/api/files). La URL que se guarda en las
 * filas de las apps es esa; el navegador nunca ve la del storage.
 *
 * Dónde quedan los bytes (`ref` de la fila), en orden:
 * - FILES_BLOB_READ_WRITE_TOKEN (o BLOB_PRIVATE_READ_WRITE_TOKEN): un store
 *   privado de Vercel Blob (`access: 'private'`), sin cifrar: el store pide
 *   el token para leer. "fsp:<pathname>".
 * - BLOB_READ_WRITE_TOKEN (el store público de la suite): cifrado por bloques
 *   antes de subir (lib/files/sealed.ts): la URL del store solo da bytes
 *   cifrados. "fse:<url>".
 * - Disco local (self-host, dev y tests): cifrado igual, en
 *   UPLOADS_DIR/files. "fsl:<nombre>".
 * - "legacy:<url>": un archivo de antes (URL pública de Blob o /uploads/…)
 *   que el script de migración registró y todavía no movió. Se sirve igual,
 *   por la ruta y con el permiso de la fila.
 *
 * Quién lo puede leer (`access`), decidido al guardar:
 * - 'workspace': quien tenga la sesión en ese workspace y acceso a la app.
 * - 'user': solo la persona dueña (Inbox es personal).
 * - 'internal': nunca por /api/files; solo por la ruta de la app, que chequea
 *   el permiso fino (el chat de Lines, la página de Docs, el video de Rec).
 * - 'public': cualquiera, por nuestro dominio. Solo lo que es público por
 *   diseño (el logo del workspace, fotos de la tienda, lo que sale a redes).
 *
 * Para que un servicio de afuera baje un archivo (el servidor de WhatsApp que
 * manda una foto), signedFileUrl() arma una URL firmada de nuestro dominio,
 * de ese archivo solo y que vence en minutos.
 */
import { createHmac, randomBytes, timingSafeEqual } from 'crypto';
import { createReadStream } from 'fs';
import { mkdir, open as fsOpen, rename, stat, unlink } from 'fs/promises';
import path from 'path';
import { Readable } from 'stream';
import { getDb, type Db } from '../db';
import { CHUNK, HEADER, openBuffer, openRangeStream, plainSize, sealBuffer, sealedRangeFor, sealedSize, sealStream } from './sealed';

export type FileAccess = 'workspace' | 'user' | 'internal' | 'public';
const ACCESS = new Set<FileAccess>(['workspace', 'user', 'internal', 'public']);

export interface StoredFileRow {
  id: string;
  workspace_id: string;
  user_id: string | null;
  app: string | null;
  folder: string;
  access: FileAccess;
  /** Permiso más fino dentro del workspace (lib/files/scopes.ts), p. ej. "chat-widget:<id>". */
  scope: string | null;
  ref: string;
  name: string;
  mime: string;
  size: number;
  /** Cabecera ZSF1 en hex (los cifrados): un rango no necesita pedirla al storage. */
  header: string | null;
  legacy_key: string | null;
  created_at: string;
}

export interface PutFileOptions {
  workspaceId: string;
  userId?: string | null;
  app?: string | null;
  folder: string;
  access: FileAccess;
  /** Permiso más fino dentro del workspace (lib/files/scopes.ts). */
  scope?: string | null;
  name: string;
  mime: string;
  /** Tope del archivo (solo para el stream; un buffer ya se chequeó afuera). */
  max?: number;
}

export class FileStoreError extends Error {
  constructor(public code: 'storage_unavailable' | 'file_too_large' | 'invalid_input', public status = 503) {
    super(code);
  }
}

const ID = /^[A-Za-z0-9_-]{22}$/;
const LOCAL_NAME = /^[A-Za-z0-9_-]{22}\.zsf$/;

export function newFileId(): string {
  return randomBytes(16).toString('base64url');
}

export function isFileId(id: unknown): id is string {
  return typeof id === 'string' && ID.test(id);
}

/** Token del store privado de archivos, si hay. */
export function privateFilesToken(): string | null {
  return process.env.FILES_BLOB_READ_WRITE_TOKEN?.trim() || process.env.BLOB_PRIVATE_READ_WRITE_TOKEN?.trim() || null;
}

export type FileBackend = 'private' | 'sealed-blob' | 'local' | 'unavailable';

export function fileBackend(): FileBackend {
  if (privateFilesToken()) return 'private';
  if (process.env.BLOB_READ_WRITE_TOKEN?.trim()) return 'sealed-blob';
  if (process.env.VERCEL) return 'unavailable';
  return 'local';
}

function localDir(): string {
  const env = process.env.UPLOADS_DIR?.trim();
  return path.join(env ? path.resolve(env) : path.join(process.cwd(), 'data', 'uploads'), 'files');
}

// ---------- URLs ----------

/** Nombre seguro para el último segmento de la URL (solo cosmético: la ruta busca por id). */
function urlName(name: string): string {
  const clean = (name.split(/[\\/]/).pop() ?? '').replace(/[^A-Za-z0-9._-]+/g, '_').replace(/^[._]+/, '').slice(-80);
  return clean || 'file';
}

/** URL de un archivo en nuestro dominio (relativa): lo único que se guarda y se manda al navegador. */
export function fileUrl(row: Pick<StoredFileRow, 'id' | 'name'>): string {
  return `/api/files/${row.id}/${urlName(row.name)}`;
}

const FILE_URL = /^\/api\/files\/([A-Za-z0-9_-]{22})(?:\/[^/?#]*)?(?:[?#].*)?$/;

function ownHosts(): string[] {
  const out: string[] = [];
  for (const raw of [process.env.NEXTAUTH_URL, process.env.NEXT_PUBLIC_APP_URL, process.env.APP_URL]) {
    try {
      if (raw) out.push(new URL(raw).host.toLowerCase());
    } catch {
      // ignorar
    }
  }
  return out;
}

/**
 * URL para el navegador de un archivo de antes (Blob público o /uploads/…):
 * /api/files/legacy/<clave>, que lo resuelve a su fila. Cualquier otra URL
 * vuelve igual.
 */
export function legacyProxyUrl(url: string): string {
  const key = legacyKeyFor(url);
  return key ? `/api/files/legacy/${key}` : url;
}

/** Id del archivo si `url` es una URL de /api/files (relativa o absoluta de nuestro dominio); null si no. */
export function fileIdFromUrl(url: string | null | undefined): string | null {
  if (!url || typeof url !== 'string') return null;
  if (url.startsWith('/')) return FILE_URL.exec(url)?.[1] ?? null;
  let u: URL;
  try {
    u = new URL(url);
  } catch {
    return null;
  }
  const host = u.host.toLowerCase();
  const local = /^(localhost|127\.0\.0\.1|\[::1\])(:\d+)?$/.test(host);
  if (!local && !ownHosts().includes(host) && !/(^|\.)zerosoft\.ai$/.test(u.hostname)) return null;
  return FILE_URL.exec(u.pathname)?.[1] ?? null;
}

export function isFileUrl(url: string | null | undefined): boolean {
  return fileIdFromUrl(url) !== null;
}

// ---------- Firmas (URLs para servicios de afuera) ----------

function signingKey(): Buffer {
  const base = process.env.FILES_KEY?.trim() || process.env.ENCRYPTION_KEY || process.env.NEXTAUTH_SECRET || 'zerosoft-dev-encryption-key';
  return createHmac('sha256', 'zerosoft-files-url').update(base).digest();
}

/**
 * Un archivo subido por una persona ('user') que pasa a ser de algo que ven
 * otros (un mensaje programado de Lines que ven quienes ven esa línea): queda
 * en el workspace con ese permiso fino. Solo archivos de ese workspace; los
 * que ya tienen otro permiso no se tocan. null si la URL no es de un archivo
 * del workspace.
 */
export async function shareFileWith(url: string, owner: { workspaceId: string }, to: { app: string; scope: string }, db: Db = getDb()): Promise<StoredFileRow | null> {
  const row = await ownedFileRow(url, { workspaceId: owner.workspaceId }, db);
  if (!row) return null;
  if (row.access !== 'user') return row;
  await db.prepare("UPDATE stored_files SET access = 'workspace', app = ?, scope = ? WHERE id = ? AND access = 'user'").run(to.app, to.scope, row.id);
  return { ...row, access: 'workspace', app: to.app, scope: to.scope };
}

/** Lo que ata una firma a ese archivo tal como está: si cambia de dueño, de acceso o de bytes, la URL deja de valer. */
export type SignableFileRow = Pick<StoredFileRow, 'id' | 'workspace_id' | 'access' | 'ref'>;

function sign(row: SignableFileRow, exp: number): string {
  return createHmac('sha256', signingKey()).update(['zsf1', row.id, exp, row.workspace_id, row.access, row.ref].join('\n')).digest('base64url');
}

/** Lo más que dura una URL firmada. */
export const MAX_SIGNED_TTL_S = 60 * 60;

/**
 * URL absoluta de nuestro dominio que deja bajar ese archivo sin sesión hasta
 * que vence (por defecto 15 minutos). Solo para servicios de afuera (el
 * servidor de WhatsApp que manda la foto); al navegador va fileUrl().
 */
export function signedFileUrl(row: SignableFileRow & Pick<StoredFileRow, 'name'>, origin: string, ttlSeconds = 15 * 60): string {
  const exp = Math.floor(Date.now() / 1000) + Math.max(30, Math.min(MAX_SIGNED_TTL_S, Math.round(ttlSeconds)));
  return `${origin.replace(/\/$/, '')}${fileUrl(row)}?exp=${exp}&sig=${sign(row, exp)}`;
}

/**
 * Versión relativa (para un navegador sin sesión de zerosoft, como el
 * visitante del widget de Chat): la URL de /api/files con firma. Vence en
 * una ventana redondeada (la misma URL durante un rato, así el navegador la
 * cachea), entre `ttlSeconds` y el doble. Otras URLs vuelven igual.
 */
export async function signedRelativeUrl(url: string, ttlSeconds = 30 * 60, db: Db = getDb()): Promise<string> {
  const row = await fileRowForUrl(url, db).catch(() => null);
  if (!row) return url;
  const ttl = Math.max(60, Math.min(Math.floor(MAX_SIGNED_TTL_S / 2), Math.round(ttlSeconds)));
  const exp = (Math.floor(Date.now() / 1000 / ttl) + 2) * ttl;
  const path = (url.startsWith('/') ? url : new URL(url).pathname).split(/[?#]/)[0];
  return `${path}?exp=${exp}&sig=${sign(row, exp)}`;
}

/** ¿La firma de la URL vale para este archivo y no venció? Comparación en tiempo constante. */
export function verifySignature(row: SignableFileRow, exp: string | null, sig: string | null): boolean {
  if (!exp || !sig || !/^\d{1,12}$/.test(exp) || !/^[A-Za-z0-9_-]{43}$/.test(sig)) return false;
  const n = Number(exp);
  const now = Math.floor(Date.now() / 1000);
  if (n < now || n > now + MAX_SIGNED_TTL_S + 60) return false;
  const want = Buffer.from(sign(row, n));
  const got = Buffer.from(sig);
  return want.length === got.length && timingSafeEqual(want, got);
}

// ---------- Filas ----------

export async function getFileRow(id: string, db: Db = getDb()): Promise<StoredFileRow | null> {
  if (!isFileId(id)) return null;
  return ((await db.prepare('SELECT * FROM stored_files WHERE id = ?').get(id)) as StoredFileRow | undefined) ?? null;
}

/** La fila de una URL de /api/files (o null si no es nuestra o no está). */
export async function fileRowForUrl(url: string | null | undefined, db: Db = getDb()): Promise<StoredFileRow | null> {
  const id = fileIdFromUrl(url);
  return id ? getFileRow(id, db) : null;
}

export interface FileOwner {
  workspaceId?: string | null;
  userId?: string | null;
}

/**
 * La fila de una URL de /api/files solo si es de ese workspace (o de esa
 * persona). Lo usan las rutas de las apps que sirven o procesan una URL
 * guardada en un registro que el cliente pudo escribir (un bloque de Docs, un
 * mensaje): sin esto, alguien podría pegar el id de un archivo de otro
 * workspace y leerlo por la ruta de su app.
 */
export async function ownedFileRow(url: string | null | undefined, owner: FileOwner | null | undefined, db: Db = getDb()): Promise<StoredFileRow | null> {
  if (!owner || (!owner.workspaceId && !owner.userId)) return null;
  const row = await fileRowForUrl(url, db);
  if (!row) return null;
  if (owner.workspaceId && row.workspace_id === owner.workspaceId) return row;
  if (owner.userId && row.user_id === owner.userId) return row;
  return null;
}

/** Clave de un archivo de antes: el pathname de la URL pública de Blob ("chat/<uuid>-x.jpg") o "uploads/<carpeta>/<nombre>" (disco local). */
export function legacyKeyFor(url: string): string | null {
  if (/^\/uploads\/[a-z]+\/[^/?#]+$/.test(url)) return url.slice(1);
  try {
    const u = new URL(url);
    if (u.protocol !== 'https:' || !/^[a-z0-9-]+\.public\.blob\.vercel-storage\.com$/i.test(u.hostname)) return null;
    const p = u.pathname.replace(/^\/+/, '');
    return p && !p.includes('..') && !p.startsWith('uploads/') ? p : null;
  } catch {
    return null;
  }
}

export async function fileRowForLegacyKey(key: string, db: Db = getDb()): Promise<StoredFileRow | null> {
  return ((await db.prepare('SELECT * FROM stored_files WHERE legacy_key = ?').get(key)) as StoredFileRow | undefined) ?? null;
}

async function insertRow(row: StoredFileRow, db: Db): Promise<void> {
  await db
    .prepare(
      `INSERT INTO stored_files (id, workspace_id, user_id, app, folder, access, scope, ref, name, mime, size, header, legacy_key, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(row.id, row.workspace_id, row.user_id, row.app, row.folder, row.access, row.scope, row.ref, row.name, row.mime, row.size, row.header, row.legacy_key, row.created_at);
}

function cleanName(name: string): string {
  // eslint-disable-next-line no-control-regex
  return (name.split(/[\\/]/).pop() ?? '').replace(/[\u0000-\u001f\u007f]/g, '').trim().slice(0, 255) || 'file';
}

function check(o: PutFileOptions): void {
  if (!o.workspaceId || typeof o.workspaceId !== 'string') throw new FileStoreError('invalid_input', 500);
  if (!ACCESS.has(o.access)) throw new FileStoreError('invalid_input', 500);
  if (o.access === 'user' && !o.userId) throw new FileStoreError('invalid_input', 500);
  if (!/^[a-z][a-z0-9-]{0,40}$/.test(o.folder)) throw new FileStoreError('invalid_input', 500);
  if (o.scope != null && !/^[a-z][a-z0-9-]{0,30}:[A-Za-z0-9_-]{1,64}$/.test(o.scope)) throw new FileStoreError('invalid_input', 500);
}

// ---------- Guardar ----------

/**
 * Guarda un archivo y devuelve su fila. `body` puede ser un buffer o un stream
 * (los grandes: se cifran y suben por partes, sin cargarlos en memoria).
 */
export async function putFile(body: Buffer | AsyncIterable<Uint8Array>, o: PutFileOptions, db: Db = getDb()): Promise<StoredFileRow> {
  check(o);
  const id = newFileId();
  const mime = cleanMime(o.mime);
  const stored = await storeBytes(id, body, { folder: o.folder, mime, max: o.max });
  const row: StoredFileRow = {
    id,
    workspace_id: o.workspaceId,
    user_id: o.userId ?? null,
    app: o.app ?? null,
    folder: o.folder,
    access: o.access,
    scope: o.scope ?? null,
    ref: stored.ref,
    name: cleanName(o.name),
    mime,
    size: stored.size,
    header: stored.header,
    legacy_key: null,
    created_at: new Date().toISOString(),
  };
  try {
    await insertRow(row, db);
  } catch (err) {
    await removeBytes(row).catch(() => undefined);
    throw err;
  }
  return row;
}

function cleanMime(mime: string): string {
  return (mime || 'application/octet-stream').split(';')[0].trim().toLowerCase().slice(0, 120) || 'application/octet-stream';
}

/**
 * Guarda los bytes en el backend que toque y devuelve dónde quedaron (sin
 * fila). La usan putFile y la migración (que después cambia el ref de una
 * fila que ya existe).
 */
export async function storeBytes(
  id: string,
  body: Buffer | AsyncIterable<Uint8Array>,
  o: { folder: string; mime: string; max?: number },
): Promise<{ ref: string; size: number; header: string | null }> {
  const backend = fileBackend();
  if (backend === 'unavailable') throw new FileStoreError('storage_unavailable', 503);
  if (!isFileId(id)) throw new FileStoreError('invalid_input', 500);
  const mime = cleanMime(o.mime);
  let ref: string;
  let size = 0;
  let header: string | null = null;
  const tooLarge = () => new FileStoreError('file_too_large', 413);

  if (backend === 'private') {
    const { put } = await import('@vercel/blob');
    const token = privateFilesToken()!;
    const pathname = `files/${o.folder}/${id}`;
    if (Buffer.isBuffer(body)) {
      size = body.length;
      await put(pathname, body, { access: 'private', token, contentType: mime, addRandomSuffix: false });
    } else {
      const counted = countBytes(body, o.max, tooLarge, (n) => (size = n));
      await put(pathname, Readable.from(counted), { access: 'private', token, contentType: mime, addRandomSuffix: false, multipart: true });
    }
    ref = `fsp:${pathname}`;
  } else if (backend === 'sealed-blob') {
    const { put } = await import('@vercel/blob');
    const pathname = `files/${id}.bin`;
    let res: { url: string };
    if (Buffer.isBuffer(body)) {
      size = body.length;
      const sealed = sealBuffer(body);
      header = sealed.subarray(0, HEADER).toString('hex');
      res = await put(pathname, sealed, { access: 'public', contentType: 'application/octet-stream', addRandomSuffix: true });
    } else {
      const stream = captureHeader(sealStream(body, { max: o.max, tooLarge, onSize: (n) => (size = n) }), (h) => (header = h.toString('hex')));
      res = await put(pathname, Readable.from(stream), { access: 'public', contentType: 'application/octet-stream', addRandomSuffix: true, multipart: true });
    }
    ref = `fse:${res.url}`;
  } else {
    const dir = localDir();
    await mkdir(dir, { recursive: true });
    const name = `${id}.zsf`;
    const final = path.join(dir, name);
    const tmp = `${final}.part`;
    const fh = await fsOpen(tmp, 'w');
    try {
      if (Buffer.isBuffer(body)) {
        size = body.length;
        const sealed = sealBuffer(body);
        header = sealed.subarray(0, HEADER).toString('hex');
        await fh.write(sealed);
      } else {
        for await (const piece of sealStream(body, { max: o.max, tooLarge, onSize: (n) => (size = n) })) {
          if (!header) header = piece.subarray(0, HEADER).toString('hex');
          await fh.write(piece);
        }
      }
      await fh.close();
      await rename(tmp, final);
    } catch (err) {
      await fh.close().catch(() => undefined);
      await unlink(tmp).catch(() => undefined);
      throw err;
    }
    ref = `fsl:${name}`;
  }
  return { ref, size, header };
}

async function* countBytes(source: AsyncIterable<Uint8Array>, max: number | undefined, tooLarge: () => Error, done: (n: number) => void): AsyncGenerator<Uint8Array> {
  let n = 0;
  for await (const piece of source) {
    n += piece.byteLength;
    if (max !== undefined && n > max) throw tooLarge();
    yield piece;
  }
  done(n);
}

async function* captureHeader(source: AsyncIterable<Buffer>, got: (h: Buffer) => void): AsyncGenerator<Buffer> {
  let first = true;
  for await (const piece of source) {
    if (first) {
      got(piece.subarray(0, HEADER));
      first = false;
    }
    yield piece;
  }
}

/**
 * Registra un archivo de antes (URL pública de Blob o /uploads/…) sin moverlo:
 * desde ahí se sirve por /api/files con el permiso de la fila. Lo usa el
 * script de migración antes de copiarlo al storage privado. Idempotente por
 * legacy_key.
 */
export async function registerLegacyFile(
  url: string,
  o: Omit<PutFileOptions, 'max'> & { size?: number },
  db: Db = getDb(),
): Promise<StoredFileRow | null> {
  check(o);
  const key = legacyKeyFor(url);
  if (!key) return null;
  const existing = await fileRowForLegacyKey(key, db);
  if (existing) return existing;
  const row: StoredFileRow = {
    id: newFileId(),
    workspace_id: o.workspaceId,
    user_id: o.userId ?? null,
    app: o.app ?? null,
    folder: o.folder,
    access: o.access,
    scope: o.scope ?? null,
    ref: `legacy:${url}`,
    name: cleanName(o.name),
    mime: (o.mime || 'application/octet-stream').split(';')[0].trim().toLowerCase(),
    size: o.size ?? 0,
    header: null,
    legacy_key: key,
    created_at: new Date().toISOString(),
  };
  await db
    .prepare(
      `INSERT OR IGNORE INTO stored_files (id, workspace_id, user_id, app, folder, access, scope, ref, name, mime, size, header, legacy_key, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(row.id, row.workspace_id, row.user_id, row.app, row.folder, row.access, row.scope, row.ref, row.name, row.mime, row.size, row.header, row.legacy_key, row.created_at);
  return fileRowForLegacyKey(key, db);
}

// ---------- Leer ----------

export interface OpenedFile {
  stream: ReadableStream<Uint8Array>;
  /** Tamaño total del archivo. */
  size: number;
  start: number;
  end: number;
  partial: boolean;
}

/** "bytes=a-b" → [a, b] dentro de `size`; 'invalid' si no se puede cumplir; null sin rango. */
export function parseByteRange(header: string | null | undefined, size: number): { start: number; end: number } | 'invalid' | null {
  if (!header) return null;
  const m = /^bytes=(\d*)-(\d*)$/.exec(header.trim());
  if (!m) return null;
  if (size <= 0) return 'invalid';
  let start: number;
  let end: number;
  if (m[1] === '') {
    if (m[2] === '') return null;
    const n = Number(m[2]);
    if (n === 0) return 'invalid';
    start = Math.max(0, size - n);
    end = size - 1;
  } else {
    start = Number(m[1]);
    end = m[2] === '' ? size - 1 : Math.min(Number(m[2]), size - 1);
  }
  if (!Number.isSafeInteger(start) || !Number.isSafeInteger(end) || start > end || start >= size) return 'invalid';
  return { start, end };
}

/** Ciertos backends (Blob público) no pueden servir de una más de lo que entra en la respuesta de una función. */
export const MAX_RESPONSE_CHUNK = 4 * 1024 * 1024;

function toWeb(gen: AsyncIterable<Uint8Array>): ReadableStream<Uint8Array> {
  return Readable.toWeb(Readable.from(gen)) as unknown as ReadableStream<Uint8Array>;
}

async function* webIter(stream: ReadableStream<Uint8Array>): AsyncGenerator<Uint8Array> {
  const reader = stream.getReader();
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) return;
      if (value) yield value;
    }
  } finally {
    reader.releaseLock();
  }
}

/** Los primeros `n` bytes de un stream (y se corta el resto). */
function limitStream(stream: ReadableStream<Uint8Array>, n: number): ReadableStream<Uint8Array> {
  return toWeb(
    (async function* () {
      let left = n;
      const reader = stream.getReader();
      try {
        while (left > 0) {
          const { done, value } = await reader.read();
          if (done || !value) break;
          const piece = value.byteLength > left ? value.subarray(0, left) : value;
          left -= piece.byteLength;
          yield piece;
        }
      } finally {
        await reader.cancel().catch(() => {});
      }
    })(),
  );
}

/**
 * Respuesta del storage a un pedido con rango: un 206 tal cual; un 200 (el
 * storage ignoró el Range) solo si pedimos desde 0, cortado al largo pedido;
 * cualquier otra cosa, null.
 */
function rangeBody(status: number, body: ReadableStream<Uint8Array> | null | undefined, from: number, to: number): ReadableStream<Uint8Array> | null {
  if (!body) return null;
  if (status === 206) return body;
  if (status === 200 && from === 0) return limitStream(body, to - from + 1);
  body.cancel().catch(() => {});
  return null;
}

export async function fetchRange(url: string, from: number, to: number): Promise<ReadableStream<Uint8Array> | null> {
  const res = await fetch(url, { headers: { Range: `bytes=${from}-${to}` }, cache: 'no-store' }).catch(() => null);
  if (!res) return null;
  return rangeBody(res.status, res.body as ReadableStream<Uint8Array> | null, from, to);
}

function isOwnBlobUrl(url: string): boolean {
  try {
    const u = new URL(url);
    return u.protocol === 'https:' && /^[a-z0-9-]+\.public\.blob\.vercel-storage\.com$/i.test(u.hostname);
  } catch {
    return false;
  }
}

/**
 * Abre el archivo de una fila (todo o un rango). `cap`: como mucho esa
 * cantidad de bytes por respuesta (las funciones de Vercel cortan en 4,5 MB);
 * el reproductor pide el resto. null si no está.
 */
/** Tamaño real del archivo: el de la fila o, si una fila de antes quedó registrada con 0, el del original. */
export async function fileSize(row: StoredFileRow): Promise<number> {
  if (row.ref.startsWith('legacy:') && !row.size) return (await legacySize(row.ref.slice(7))) ?? 0;
  return row.size;
}

export async function openFile(row: StoredFileRow, range: { start: number; end: number } | null, opts: { cap?: number } = {}): Promise<OpenedFile | null> {
  const size = await fileSize(row);
  const empty = size === 0;
  const start = range?.start ?? 0;
  let end = range?.end ?? Math.max(0, size - 1);
  if (opts.cap && !empty && end - start + 1 > opts.cap) end = start + opts.cap - 1;
  // Un pedido con Range siempre es parcial (206 con Content-Range), aunque cubra el archivo entero.
  const partial = !empty && (range !== null || start > 0 || end < size - 1);
  if (empty) return { stream: toWeb((async function* () {})()), size: 0, start: 0, end: -1, partial: false };

  if (row.ref.startsWith('fsp:')) {
    const token = privateFilesToken();
    if (!token) return null;
    const { get } = await import('@vercel/blob');
    const res = await get(row.ref.slice(4), { access: 'private', token, useCache: false, headers: partial ? { range: `bytes=${start}-${end}` } : undefined }).catch(() => null);
    if (!res?.stream) return null;
    const stream = res.stream as ReadableStream<Uint8Array>;
    if (!partial) return res.statusCode === 200 ? { stream, size, start, end, partial } : null;
    // Se pidió un rango: tiene que volver ese rango (no el archivo entero desde otro byte).
    const body = rangeBody(res.statusCode, stream, start, end);
    return body ? { stream: body, size, start, end, partial } : null;
  }

  if (row.ref.startsWith('fse:') || row.ref.startsWith('fsl:')) {
    const sealedTotal = sealedSize(size);
    const r = sealedRangeFor(start, end, sealedTotal);
    let header = row.header ? Buffer.from(row.header, 'hex') : null;
    let body: AsyncIterable<Uint8Array>;
    if (row.ref.startsWith('fse:')) {
      const url = row.ref.slice(4);
      if (!isOwnBlobUrl(url)) return null;
      if (!header) {
        const h = await fetchRange(url, 0, HEADER - 1);
        if (!h) return null;
        header = Buffer.from(await new Response(h).arrayBuffer()).subarray(0, HEADER);
      }
      const s = await fetchRange(url, r.from, r.to);
      if (!s) return null;
      body = webIter(s);
    } else {
      const name = row.ref.slice(4);
      if (!LOCAL_NAME.test(name)) return null;
      const file = path.join(localDir(), name);
      const st = await stat(file).catch(() => null);
      if (!st?.isFile()) return null;
      if (!header) {
        const fh = await fsOpen(file, 'r');
        try {
          header = Buffer.alloc(HEADER);
          await fh.read(header, 0, HEADER, 0);
        } finally {
          await fh.close();
        }
      }
      body = createReadStream(file, { start: r.from, end: r.to });
    }
    const out = openRangeStream(header, body, { start, end, first: r.first, sealedTotal });
    return { stream: toWeb(out), size, start, end, partial };
  }

  if (row.ref.startsWith('legacy:')) {
    const url = row.ref.slice(7);
    if (url.startsWith('/uploads/')) {
      const { localUploadPath } = await import('../uploads');
      const file = localUploadPath(url);
      if (!file) return null;
      const st = await stat(file).catch(() => null);
      if (!st?.isFile()) return null;
      return { stream: toWeb(createReadStream(file, { start, end })), size, start, end, partial };
    }
    if (!isOwnBlobUrl(url)) return null;
    const s = await fetchRange(url, start, end);
    if (!s) return null;
    return { stream: s, size, start, end, partial };
  }
  return null;
}

async function legacySize(url: string): Promise<number | null> {
  if (url.startsWith('/uploads/')) {
    const { localUploadPath } = await import('../uploads');
    const file = localUploadPath(url);
    const st = file ? await stat(file).catch(() => null) : null;
    return st?.isFile() ? st.size : null;
  }
  if (!isOwnBlobUrl(url)) return null;
  const res = await fetch(url, { method: 'HEAD', cache: 'no-store' }).catch(() => null);
  const n = Number(res?.headers.get('content-length'));
  return res?.ok && Number.isFinite(n) ? n : null;
}

/** El archivo entero en memoria (para mandarlo, procesarlo o transcribirlo), con tope. null si no está o pasa de `max`. */
export async function readFileBytes(row: StoredFileRow, max = 64 * 1024 * 1024): Promise<Buffer | null> {
  if (row.size > max) return null;
  const opened = await openFile(row, null).catch(() => null);
  if (!opened) return null;
  if (opened.size > max) return null;
  try {
    const chunks: Buffer[] = [];
    let n = 0;
    for await (const piece of webIter(opened.stream)) {
      n += piece.byteLength;
      if (n > max) return null;
      chunks.push(Buffer.from(piece));
    }
    return Buffer.concat(chunks);
  } catch {
    return null;
  }
}

/** Atajo: bytes de una URL de /api/files. */
export async function readFileUrlBytes(url: string, max?: number): Promise<Buffer | null> {
  const row = await fileRowForUrl(url);
  return row ? readFileBytes(row, max) : null;
}

/** Verifica que la copia se lea entera y coincida con `expected` (lo usa la migración antes de borrar el original). */
export async function verifyFileBytes(row: StoredFileRow, expected: Buffer): Promise<boolean> {
  const got = await readFileBytes(row, Math.max(expected.length, 1));
  return !!got && got.length === expected.length && got.equals(expected);
}

// ---------- Borrar ----------

async function removeBytes(row: Pick<StoredFileRow, 'ref'>): Promise<boolean> {
  try {
    if (row.ref.startsWith('fsp:')) {
      const token = privateFilesToken();
      if (!token) return false;
      const { del } = await import('@vercel/blob');
      await del(row.ref.slice(4), { token });
    } else if (row.ref.startsWith('fse:')) {
      if (!process.env.BLOB_READ_WRITE_TOKEN) return false;
      const { del } = await import('@vercel/blob');
      await del(row.ref.slice(4));
    } else if (row.ref.startsWith('fsl:')) {
      const name = row.ref.slice(4);
      if (LOCAL_NAME.test(name)) {
        await unlink(path.join(localDir(), name)).catch((err: NodeJS.ErrnoException) => {
          if (err.code !== 'ENOENT') throw err;
        });
      }
    } else if (row.ref.startsWith('legacy:')) {
      const { deleteUploads } = await import('../uploads');
      await deleteUploads([row.ref.slice(7)]);
    }
    return true;
  } catch {
    return false;
  }
}

/** Borra archivos (filas y bytes) por URL de /api/files. Best effort: un fallo no corta el borrado de las filas de la app. */
export async function deleteFileUrls(urls: Array<string | null | undefined>, db: Db = getDb()): Promise<void> {
  for (const url of urls) {
    const row = await fileRowForUrl(url, db).catch(() => null);
    if (!row) continue;
    await removeBytes(row);
    if (row.legacy_key && !row.ref.startsWith('legacy:')) {
      // Copia de un archivo de antes: queda la marca (sin bytes, no se sirve) para que la migración con
      // --delete-originals borre también el original público cuando nada más lo use.
      await db
        .prepare(`UPDATE stored_files SET ref = '${GONE_REF}', size = 0, header = NULL, access = 'internal' WHERE id = ?`)
        .run(row.id)
        .catch(() => undefined);
      continue;
    }
    await db.prepare('DELETE FROM stored_files WHERE id = ?').run(row.id).catch(() => undefined);
  }
}

/** ref de una copia migrada que se borró: sin bytes; solo marca que el original público también hay que borrarlo. */
export const GONE_REF = 'gone:';

/** Para la migración: cambia dónde están los bytes de una fila (después de verificar la copia). */
export async function swapFileRef(id: string, from: string, to: Pick<StoredFileRow, 'ref' | 'header' | 'size'>, db: Db = getDb()): Promise<boolean> {
  const r = await db
    .prepare('UPDATE stored_files SET ref = ?, header = ?, size = ? WHERE id = ? AND ref = ?')
    .run(to.ref, to.header, to.size, id, from);
  return r.changes > 0;
}

/** Bytes de una copia hecha con putFile que no se va a usar (la migración, si otra corrida ganó). */
export async function discardBytes(ref: string): Promise<void> {
  await removeBytes({ ref });
}

export { CHUNK, openBuffer, plainSize };
