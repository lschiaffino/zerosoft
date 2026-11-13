/**
 * Stickers de WhatsApp de cada persona, para Lines e Inbox: los recientes, los
 * favoritos y su colección, como el panel de stickers de WhatsApp Web.
 *
 * De dónde salen: WhatsApp no deja leer los stickers guardados de una cuenta
 * vinculada (los favoritos viajan en la sincronización de estado de la app,
 * que Evolution no expone, y los recientes viven solo en cada teléfono). Por
 * eso la colección se arma con los stickers que la persona ya recibió y mandó
 * en sus chats (en Lines, solo los de los chats que puede ver), sin repetir
 * (SHA-256 del archivo), y se mantiene al día con los que van llegando. También
 * se suma un sticker con "Agregar a favoritos" desde un mensaje y se puede
 * crear uno desde una imagen (512×512 en WebP, como WhatsApp).
 *
 * Los archivos se guardan cifrados (lib/private-files.ts): nunca tienen una URL
 * pública. La pantalla los ve por /api/<app>/stickers?img=<id>, con sesión.
 * Para mandarlo, Inbox pasa los bytes al servidor de WhatsApp; Lines lo sube
 * una vez como adjunto del chat (la URL que baja el servidor de WhatsApp,
 * como cualquier archivo mandado) y la reusa. Server-only.
 */
import { createHash, randomUUID } from 'crypto';
import { getDb } from './db';
import { privateFileStore } from './private-files';
import { baseMime } from './groups-media';

export type StickerApp = 'lines' | 'inbox';

/** De quién es la colección: la persona, la app y (en Lines) el workspace. */
export interface StickerOwner {
  userId: string;
  app: StickerApp;
  scope: string;
}

export interface StickerDto {
  id: string;
  /** Para dibujarlo (ruta con sesión). */
  url: string;
  animated: boolean;
  favorite: boolean;
  width: number | null;
  height: number | null;
  /** Última vez que la persona lo mandó (los recientes). */
  usedAt: string | null;
  createdAt: string;
}

interface StickerRow {
  id: string;
  user_id: string;
  app: string;
  scope_id: string;
  hash: string;
  ref: string;
  share_url: string | null;
  animated: number;
  width: number | null;
  height: number | null;
  size: number;
  favorite: number;
  source: string;
  last_used_at: string | null;
  created_at: string;
}

export class StickerError extends Error {
  constructor(
    public code: 'not_found' | 'invalid_sticker' | 'sticker_too_large' | 'sticker_convert_unavailable' | 'storage_unavailable' | 'stickers_full',
    public status = 400,
  ) {
    super(code);
  }
}

/** Tope de la colección de una persona por app (los favoritos y los recientes no se pierden por esto). */
export const MAX_STICKERS = 300;
/** Tope de WhatsApp: 100 KB un sticker quieto, 500 KB uno animado. Se acepta hasta 1 MB de lo que llega. */
export const STICKER_MAX_BYTES = 1024 * 1024;
const STATIC_MAX = 100 * 1024;
const ANIMATED_MAX = 500 * 1024;

const files = privateFileStore({
  folder: 'stickers',
  envPrefix: 'STICKERS',
  hkdfLabel: 'sticker-files',
  magic: 'ZSK1',
  unavailable: () => new StickerError('storage_unavailable', 503),
});

const nowIso = () => new Date().toISOString();
export const stickerHash = (bytes: Buffer): string => createHash('sha256').update(bytes).digest('hex');

// ---------------------------------------------------------------------------
// WebP
// ---------------------------------------------------------------------------

/**
 * Lee la cabecera de un WebP: si es animado (VP8X con la marca de animación) y
 * sus medidas. null si no es un WebP.
 */
export function webpInfo(b: Buffer): { animated: boolean; width: number; height: number } | null {
  if (b.length < 30 || b.toString('ascii', 0, 4) !== 'RIFF' || b.toString('ascii', 8, 12) !== 'WEBP') return null;
  const chunk = b.toString('ascii', 12, 16);
  if (chunk === 'VP8X') {
    const flags = b[20];
    const width = 1 + b.readUIntLE(24, 3);
    const height = 1 + b.readUIntLE(27, 3);
    return { animated: (flags & 0x02) !== 0, width, height };
  }
  if (chunk === 'VP8 ') {
    return { animated: false, width: b.readUInt16LE(26) & 0x3fff, height: b.readUInt16LE(28) & 0x3fff };
  }
  if (chunk === 'VP8L') {
    const bits = b.readUInt32LE(21);
    return { animated: false, width: 1 + (bits & 0x3fff), height: 1 + ((bits >> 14) & 0x3fff) };
  }
  return { animated: false, width: 0, height: 0 };
}

/**
 * Una imagen (PNG, JPEG, GIF, WebP) → sticker de WhatsApp: WebP de 512×512 con
 * la imagen entera adentro y fondo transparente; un GIF queda animado. Baja la
 * calidad hasta que entra en el tope de WhatsApp.
 */
export async function imageToSticker(input: Buffer, mime: string): Promise<Buffer> {
  const m = baseMime(mime);
  if (!/^image\/(png|jpeg|jpg|gif|webp)$/.test(m)) throw new StickerError('invalid_sticker', 415);
  let sharp: (typeof import('sharp'))['default'];
  try {
    sharp = (await import('sharp')).default;
  } catch {
    throw new StickerError('sticker_convert_unavailable', 503);
  }
  const animated = m === 'image/gif' || (m === 'image/webp' && Boolean(webpInfo(input)?.animated));
  const max = animated ? ANIMATED_MAX : STATIC_MAX;
  for (const quality of [80, 60, 40, 25]) {
    let out: Buffer;
    try {
      out = await sharp(input, { animated, limitInputPixels: 40_000_000 })
        .resize(512, 512, { fit: 'contain', background: { r: 0, g: 0, b: 0, alpha: 0 } })
        .webp({ quality, effort: 4 })
        .toBuffer();
    } catch {
      throw new StickerError('invalid_sticker', 415);
    }
    if (out.length <= max) return out;
  }
  throw new StickerError('sticker_too_large', 413);
}

// ---------------------------------------------------------------------------
// Colección
// ---------------------------------------------------------------------------

function imgUrl(app: StickerApp, id: string): string {
  return `/api/${app === 'lines' ? 'groups' : 'inbox'}/stickers?img=${encodeURIComponent(id)}`;
}

function toDto(r: StickerRow): StickerDto {
  return {
    id: r.id,
    url: imgUrl(r.app as StickerApp, r.id),
    animated: r.animated === 1,
    favorite: r.favorite === 1,
    width: r.width,
    height: r.height,
    usedAt: r.last_used_at,
    createdAt: r.created_at,
  };
}

const OWNER_SQL = 'user_id = ? AND app = ? AND scope_id = ?';
const ownerArgs = (o: StickerOwner) => [o.userId, o.app, o.scope];

export async function listStickers(o: StickerOwner): Promise<StickerDto[]> {
  const rows = (await getDb()
    .prepare(`SELECT * FROM wa_stickers WHERE ${OWNER_SQL} ORDER BY created_at DESC, id LIMIT ${MAX_STICKERS + 50}`)
    .all(...ownerArgs(o))) as StickerRow[];
  return rows.map(toDto);
}

async function rowById(o: StickerOwner, id: string): Promise<StickerRow> {
  const row = (await getDb().prepare(`SELECT * FROM wa_stickers WHERE id = ? AND ${OWNER_SQL}`).get(id, ...ownerArgs(o))) as StickerRow | undefined;
  if (!row) throw new StickerError('not_found', 404);
  return row;
}

async function rowByHash(o: StickerOwner, hash: string): Promise<StickerRow | null> {
  return ((await getDb().prepare(`SELECT * FROM wa_stickers WHERE hash = ? AND ${OWNER_SQL}`).get(hash, ...ownerArgs(o))) as StickerRow | undefined) ?? null;
}

async function countStickers(o: StickerOwner): Promise<number> {
  const r = (await getDb().prepare(`SELECT COUNT(*) AS n FROM wa_stickers WHERE ${OWNER_SQL}`).get(...ownerArgs(o))) as { n: number };
  return Number(r.n);
}

/**
 * Suma un sticker (WebP) a la colección, sin repetir: si ya está (mismo
 * SHA-256), devuelve el que estaba (y lo marca favorito si se pide).
 * `added` dice si entró uno nuevo.
 */
export async function addSticker(
  o: StickerOwner,
  bytes: Buffer,
  opts: { favorite?: boolean; source?: 'chat' | 'favorite' | 'created' } = {},
): Promise<{ sticker: StickerDto; added: boolean }> {
  if (bytes.length === 0 || bytes.length > STICKER_MAX_BYTES) throw new StickerError(bytes.length ? 'sticker_too_large' : 'invalid_sticker', bytes.length ? 413 : 400);
  const info = webpInfo(bytes);
  if (!info) throw new StickerError('invalid_sticker', 415);
  const db = getDb();
  const hash = stickerHash(bytes);
  const existing = await rowByHash(o, hash);
  if (existing) {
    if (opts.favorite && existing.favorite !== 1) {
      await db.prepare('UPDATE wa_stickers SET favorite = 1 WHERE id = ?').run(existing.id);
      existing.favorite = 1;
    }
    return { sticker: toDto(existing), added: false };
  }
  // La colección llena: lo que llega de los chats no entra; un favorito o uno creado sí (el tope es para la importación).
  if ((opts.source ?? 'chat') === 'chat' && (await countStickers(o)) >= MAX_STICKERS) throw new StickerError('stickers_full', 409);
  const ref = await files.store(bytes, 'image/webp');
  const id = randomUUID();
  const at = nowIso();
  const r = await db
    .prepare(
      `INSERT INTO wa_stickers (id, user_id, app, scope_id, hash, ref, animated, width, height, size, favorite, source, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT (user_id, app, scope_id, hash) DO NOTHING`,
    )
    .run(id, o.userId, o.app, o.scope, hash, ref, info.animated ? 1 : 0, info.width || null, info.height || null, bytes.length, opts.favorite ? 1 : 0, opts.source ?? 'chat', at);
  if (r.changes === 0) {
    // Otro pedido lo guardó primero: el archivo de más se borra.
    await files.remove([ref]);
    const again = await rowByHash(o, hash);
    if (!again) throw new StickerError('not_found', 404);
    if (opts.favorite && again.favorite !== 1) await db.prepare('UPDATE wa_stickers SET favorite = 1 WHERE id = ?').run(again.id);
    return { sticker: toDto({ ...again, favorite: opts.favorite ? 1 : again.favorite }), added: false };
  }
  return { sticker: toDto((await rowById(o, id))!), added: true };
}

export async function setFavorite(o: StickerOwner, id: string, favorite: boolean): Promise<StickerDto> {
  const row = await rowById(o, id);
  await getDb().prepare('UPDATE wa_stickers SET favorite = ? WHERE id = ?').run(favorite ? 1 : 0, row.id);
  return toDto({ ...row, favorite: favorite ? 1 : 0 });
}

/** Lo saca de la colección (y borra su archivo). Lo que ya se mandó queda en el chat: Lines lo mandó como adjunto propio. */
export async function removeSticker(o: StickerOwner, id: string): Promise<void> {
  const row = await rowById(o, id);
  await getDb().prepare('DELETE FROM wa_stickers WHERE id = ?').run(row.id);
  await files.remove([row.ref]);
}

/** Recién mandado: pasa a los recientes. */
export async function markUsed(o: StickerOwner, id: string): Promise<void> {
  await getDb().prepare(`UPDATE wa_stickers SET last_used_at = ? WHERE id = ? AND ${OWNER_SQL}`).run(nowIso(), id, ...ownerArgs(o));
}

export async function stickerBytes(o: StickerOwner, id: string): Promise<{ row: StickerRow; data: Buffer }> {
  const row = await rowById(o, id);
  const data = await files.read(row.ref);
  if (!data) throw new StickerError('not_found', 404);
  return { row, data };
}

/** Lines: la URL con la que sale (se sube una vez como adjunto del chat y se reusa). */
export async function lineShareUrl(o: StickerOwner, id: string): Promise<{ url: string; size: number; width: number | null; height: number | null }> {
  const { row, data } = await stickerBytes(o, id);
  if (row.share_url) return { url: row.share_url, size: row.size, width: row.width, height: row.height };
  const { saveUpload } = await import('./uploads');
  const url = await saveUpload('chat', 'sticker.webp', 'image/webp', data);
  const r = await getDb().prepare('UPDATE wa_stickers SET share_url = ? WHERE id = ? AND share_url IS NULL').run(url, row.id);
  if (r.changes === 0) {
    // Otro pedido la subió primero: se usa esa.
    const { deleteUploads } = await import('./uploads');
    await deleteUploads([url]);
    return { url: (await rowById(o, id)).share_url ?? url, size: row.size, width: row.width, height: row.height };
  }
  return { url, size: row.size, width: row.width, height: row.height };
}

/** Borra la colección de una persona en una app (al irse del workspace o desvincular). */
export async function forgetStickers(o: StickerOwner): Promise<void> {
  const db = getDb();
  const rows = (await db.prepare(`SELECT ref FROM wa_stickers WHERE ${OWNER_SQL}`).all(...ownerArgs(o))) as Array<{ ref: string }>;
  await db.prepare(`DELETE FROM wa_stickers WHERE ${OWNER_SQL}`).run(...ownerArgs(o));
  await db.prepare(`DELETE FROM wa_sticker_sync WHERE ${OWNER_SQL}`).run(...ownerArgs(o));
  await files.remove(rows.map((r) => r.ref));
}

// ---------------------------------------------------------------------------
// Importar de los chats (y mantenerla al día)
// ---------------------------------------------------------------------------

/** Un sticker de un chat: el mensaje (rowid, para seguir desde ahí), su SHA-256 si WhatsApp lo mandó y cómo bajarlo. */
export interface StickerCandidate {
  rowid: number;
  sha?: string;
  fetch: () => Promise<Buffer | null>;
}

/** De dónde salen los stickers de los chats de esta persona (Lines e Inbox lo arman distinto). */
export interface StickerSource {
  /** Los siguientes stickers de sus chats después de `after` (rowid), en orden. */
  next(after: number, limit: number): Promise<StickerCandidate[]>;
}

export async function syncState(o: StickerOwner): Promise<{ imported: boolean; cursor: number }> {
  const r = (await getDb().prepare(`SELECT cursor FROM wa_sticker_sync WHERE ${OWNER_SQL}`).get(...ownerArgs(o))) as { cursor: number } | undefined;
  return { imported: Boolean(r), cursor: Number(r?.cursor ?? 0) };
}

/**
 * Trae a la colección los stickers de los chats, desde donde quedó la última
 * vez (sin repetir los que ya tiene: con el SHA-256 que manda WhatsApp ni se
 * bajan). Avanza hasta `limit` mensajes o hasta `deadline`. `more`: quedan.
 * La primera vez la pide la persona ("Importar stickers de mis chats"); después
 * corre sola al abrir el panel.
 */
export async function syncStickers(
  o: StickerOwner,
  source: StickerSource,
  opts: { limit?: number; deadline?: number } = {},
): Promise<{ added: number; scanned: number; more: boolean }> {
  const db = getDb();
  const limit = Math.max(1, Math.min(opts.limit ?? 40, 200));
  const deadline = opts.deadline ?? Date.now() + 15_000;
  const { cursor } = await syncState(o);
  await db
    .prepare(`INSERT INTO wa_sticker_sync (user_id, app, scope_id, cursor, updated_at) VALUES (?, ?, ?, ?, ?) ON CONFLICT (user_id, app, scope_id) DO NOTHING`)
    .run(o.userId, o.app, o.scope, 0, nowIso());
  const list = await source.next(cursor, limit);
  let last = cursor;
  let added = 0;
  let scanned = 0;
  let full = false;
  for (const c of list) {
    if (Date.now() > deadline) break;
    scanned++;
    last = c.rowid;
    if (c.sha && (await rowByHash(o, c.sha))) continue;
    let data: Buffer | null = null;
    try {
      data = await c.fetch();
    } catch {
      data = null;
    }
    if (!data || !webpInfo(data)) continue;
    try {
      if ((await addSticker(o, data, { source: 'chat' })).added) added++;
    } catch (err) {
      if (err instanceof StickerError && err.code === 'stickers_full') {
        full = true;
        break;
      }
      if (!(err instanceof StickerError)) throw err;
    }
  }
  // Solo avanza (otra corrida en paralelo pudo ir más lejos).
  await db.prepare(`UPDATE wa_sticker_sync SET cursor = MAX(cursor, ?), updated_at = ? WHERE ${OWNER_SQL}`).run(last, nowIso(), ...ownerArgs(o));
  return { added, scanned, more: !full && scanned === list.length && list.length === limit };
}

/** Bytes de un adjunto público ya guardado (/uploads/chat/... o Blob público), con tope. */
export async function readStoredUpload(url: string, max = STICKER_MAX_BYTES): Promise<Buffer | null> {
  if (url.startsWith('/uploads/')) {
    const { localUploadPath } = await import('./uploads');
    const p = localUploadPath(url);
    if (!p) return null;
    const { readFile, stat } = await import('fs/promises');
    const st = await stat(p).catch(() => null);
    if (!st?.isFile() || st.size > max) return null;
    return readFile(p);
  }
  let u: URL;
  try {
    u = new URL(url);
  } catch {
    return null;
  }
  // Solo el Blob público de la suite (nada de hosts arbitrarios).
  if (u.protocol !== 'https:' || !/^[a-z0-9-]+\.public\.blob\.vercel-storage\.com$/i.test(u.hostname)) return null;
  const res = await fetch(u, { signal: AbortSignal.timeout(10_000) }).catch(() => null);
  if (!res?.ok) return null;
  const len = Number(res.headers.get('content-length') ?? 0);
  if (len > max) return null;
  const buf = Buffer.from(await res.arrayBuffer());
  return buf.length <= max ? buf : null;
}
