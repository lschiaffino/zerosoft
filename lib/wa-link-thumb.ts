/**
 * La imagen grande de la vista previa de un link que manda WhatsApp (Inbox y
 * Lines). Con el mensaje viene una miniatura chica (jpegThumbnail) y, cuando
 * el teléfono que lo mandó la tiene (lugares de Google Maps, notas con una
 * imagen buena), una versión grande subida a los servidores de WhatsApp:
 * thumbnailDirectPath + mediaKey, cifrada como cualquier archivo de WhatsApp
 * ("WhatsApp Link Thumbnail Keys"). Es la que WhatsApp muestra a todo el ancho.
 *
 * Se baja una vez al llegar el mensaje (solo de mmg.whatsapp.net), se
 * descifra, se verifica que sea una imagen y se guarda con el mensaje (nuestra
 * base): el navegador la pide a nuestra ruta del mensaje, nunca a otro sitio.
 */
import { createCipheriv, createDecipheriv, createHmac, hkdfSync, timingSafeEqual } from 'crypto';
import { imageSize } from './image-size';

export interface LinkHqRef {
  directPath: string;
  mediaKey: string;
  width: number;
  height: number;
}

export interface LinkHq {
  /** data URL (JPEG o PNG). */
  image: string;
  width: number;
  height: number;
}

/** Tope de la imagen descifrada: las de WhatsApp pesan decenas de KB. */
export const LINK_HQ_MAX_BYTES = 400 * 1024;
const DIRECT_PATH = /^\/[A-Za-z0-9\-._~/?=&%]{1,1000}$/;

/** Bytes como llegan por JSON (base64, Buffer serializado, objeto {0:..} o lista) → base64; '' si no son bytes. */
export function keyBase64(v: unknown): string {
  if (typeof v === 'string') return /^[A-Za-z0-9+/]{20,100}={0,2}$/.test(v) ? v : '';
  if (!v || typeof v !== 'object') return '';
  const o = v as Record<string, unknown>;
  const list = Array.isArray(v) ? v : o.type === 'Buffer' && Array.isArray(o.data) ? (o.data as unknown[]) : Object.keys(o).every((k) => /^\d+$/.test(k)) ? Object.keys(o).sort((a, b) => Number(a) - Number(b)).map((k) => o[k]) : null;
  if (!list || list.length === 0 || list.length > 64 || !list.every((n) => Number.isInteger(n) && (n as number) >= 0 && (n as number) <= 255)) return '';
  return Buffer.from(list as number[]).toString('base64');
}

/** La referencia a la imagen grande de un extendedTextMessage; undefined si no viene o no es válida. */
export function linkHqOf(ext: Record<string, unknown>): LinkHqRef | undefined {
  const directPath = typeof ext.thumbnailDirectPath === 'string' && DIRECT_PATH.test(ext.thumbnailDirectPath) ? ext.thumbnailDirectPath : '';
  const mediaKey = keyBase64(ext.mediaKey);
  const width = Number(ext.thumbnailWidth) || 0;
  const height = Number(ext.thumbnailHeight) || 0;
  if (!directPath || !mediaKey || Buffer.from(mediaKey, 'base64').length !== 32) return undefined;
  return { directPath, mediaKey, width: width > 0 && width < 10_000 ? width : 0, height: height > 0 && height < 10_000 ? height : 0 };
}

/** Claves de un archivo de WhatsApp (HKDF-SHA256 de la mediaKey con la etiqueta del tipo). */
function mediaKeys(mediaKey: Buffer, info: string): { iv: Buffer; cipherKey: Buffer; macKey: Buffer } {
  const expanded = Buffer.from(hkdfSync('sha256', mediaKey, Buffer.alloc(0), Buffer.from(info), 112));
  return { iv: expanded.subarray(0, 16), cipherKey: expanded.subarray(16, 48), macKey: expanded.subarray(48, 80) };
}

export const LINK_THUMB_INFO = 'WhatsApp Link Thumbnail Keys';

/** Descifra un archivo de WhatsApp (AES-256-CBC, con los últimos 10 bytes de HMAC). null si la firma no da. */
export function decryptWaMedia(file: Buffer, mediaKeyB64: string, info = LINK_THUMB_INFO): Buffer | null {
  if (file.length < 26) return null;
  const { iv, cipherKey, macKey } = mediaKeys(Buffer.from(mediaKeyB64, 'base64'), info);
  const enc = file.subarray(0, file.length - 10);
  const mac = file.subarray(file.length - 10);
  const want = createHmac('sha256', macKey).update(iv).update(enc).digest().subarray(0, 10);
  if (!timingSafeEqual(mac, want)) return null;
  try {
    const d = createDecipheriv('aes-256-cbc', cipherKey, iv);
    return Buffer.concat([d.update(enc), d.final()]);
  } catch {
    return null;
  }
}

/** Para los tests: cifra como WhatsApp. */
export function encryptWaMedia(plain: Buffer, mediaKeyB64: string, info = LINK_THUMB_INFO): Buffer {
  const { iv, cipherKey, macKey } = mediaKeys(Buffer.from(mediaKeyB64, 'base64'), info);
  const c = createCipheriv('aes-256-cbc', cipherKey, iv);
  const enc = Buffer.concat([c.update(plain), c.final()]);
  const mac = createHmac('sha256', macKey).update(iv).update(enc).digest().subarray(0, 10);
  return Buffer.concat([enc, mac]);
}

type Fetcher = (url: string) => Promise<Response>;

/** Imagen JPEG o PNG con medidas; el resto (o algo roto) no se guarda. */
function asImage(bytes: Buffer): LinkHq | null {
  const jpeg = bytes[0] === 0xff && bytes[1] === 0xd8;
  const png = bytes.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]));
  if (!jpeg && !png) return null;
  const size = imageSize(bytes);
  if (!size || size.width <= 0 || size.height <= 0) return null;
  return { image: `data:image/${jpeg ? 'jpeg' : 'png'};base64,${bytes.toString('base64')}`, width: size.width, height: size.height };
}

/** Imagen falsa (GROUPS_FAKE): una ruta "/fake-link-thumb/<ancho>x<alto>" da un PNG de esas medidas, sin red. */
async function fakeThumb(ref: LinkHqRef): Promise<LinkHq | null> {
  const m = /^\/fake-link-thumb\/(\d{2,4})x(\d{2,4})/.exec(ref.directPath);
  if (!m) return null;
  const { fakePng } = await import('./groups-provider-fake');
  return asImage(fakePng(Number(m[1]), Number(m[2]), 2));
}

/**
 * Baja, descifra y verifica la imagen grande. null si no se pudo (queda la
 * miniatura chica o la que lea nuestro servidor). Nunca tira.
 */
export async function downloadLinkHq(ref: LinkHqRef, fetcher?: Fetcher): Promise<LinkHq | null> {
  try {
    if (process.env.GROUPS_FAKE === '1' && ref.directPath.startsWith('/fake-link-thumb/')) return await fakeThumb(ref);
    const get: Fetcher =
      fetcher ??
      (async (url) => {
        const { safeFetch } = await import('./safe-fetch');
        return safeFetch(url, {}, 10_000);
      });
    const res = await get(`https://mmg.whatsapp.net${ref.directPath}`);
    if (!res.ok) return null;
    if (Number(res.headers.get('content-length') ?? 0) > LINK_HQ_MAX_BYTES + 64) return null;
    const file = Buffer.from(await res.arrayBuffer());
    if (file.length > LINK_HQ_MAX_BYTES + 64) return null;
    const plain = decryptWaMedia(file, ref.mediaKey);
    return plain && plain.length <= LINK_HQ_MAX_BYTES ? asImage(plain) : null;
  } catch {
    return null;
  }
}

/** El link como se guarda en meta: lo que mandó WhatsApp, la referencia a la imagen grande y, ya bajada, la imagen. */
export interface StoredLink {
  url: string;
  title: string;
  description?: string;
  thumb?: string;
  hqRef?: LinkHqRef;
  hq?: LinkHq;
}

/** Lo que va al navegador: sin la clave ni los bytes; la imagen grande por la ruta del mensaje (`imagePath`). */
export function publicLink(link: StoredLink | undefined, imagePath: string): (Omit<StoredLink, 'hq' | 'hqRef'> & { image?: string; imageWidth?: number; imageHeight?: number }) | undefined {
  if (!link || typeof link !== 'object') return link;
  const { hq, hqRef: _ref, ...rest } = link;
  void _ref;
  return hq?.image ? { ...rest, image: imagePath, imageWidth: hq.width, imageHeight: hq.height } : rest;
}

/** Los bytes de la imagen grande guardada (para la ruta del mensaje); null si no hay. */
export function linkHqBytes(link: StoredLink | undefined): { type: string; bytes: Buffer } | null {
  const m = /^data:(image\/(?:jpeg|png));base64,([A-Za-z0-9+/=]+)$/.exec(link?.hq?.image ?? '');
  return m ? { type: m[1], bytes: Buffer.from(m[2], 'base64') } : null;
}

/**
 * Baja la imagen grande de un mensaje recién guardado y la deja en su meta
 * (Inbox: inbox_messages, Lines: groups_messages). Corre después de responder
 * el webhook; si no se pudo, queda sin la referencia (no se vuelve a pedir).
 */
export async function storeLinkHq(table: 'inbox_messages' | 'groups_messages', id: string, ref: LinkHqRef): Promise<boolean> {
  const hq = await downloadLinkHq(ref);
  const { getDb } = await import('./db');
  const db = getDb();
  if (!hq) {
    await db.prepare(`UPDATE ${table} SET meta = json_remove(meta, '$.link.hqRef') WHERE id = ? AND json_valid(meta)`).run(id);
    return false;
  }
  await db.prepare(`UPDATE ${table} SET meta = json_set(json_remove(meta, '$.link.hqRef'), '$.link.hq', json(?)) WHERE id = ? AND json_valid(meta)`).run(JSON.stringify(hq), id);
  return true;
}
