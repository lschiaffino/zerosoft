/**
 * Groups: media de WhatsApp (lo que se manda y lo que llega).
 *
 * - Qué tipo de mensaje de WhatsApp sale de cada archivo (imagen, video,
 *   audio, nota de voz, documento, sticker) y los topes de WhatsApp por tipo.
 *   Lo que WhatsApp no reproduce como media (un .mov, un .webm, un .heic) se
 *   manda como documento, así llega igual.
 * - Los datos que la interfaz usa para dibujar un archivo (tamaño, medidas,
 *   duración, nota de voz, páginas, miniatura), leídos del mensaje de Baileys
 *   que manda Evolution, y la ubicación y los contactos como datos.
 */

export type MediaKind = 'image' | 'video' | 'audio' | 'voice' | 'document' | 'sticker';
export const MEDIA_KINDS: readonly MediaKind[] = ['image', 'video', 'audio', 'voice', 'document', 'sticker'];

const MB = 1024 * 1024;

/** Topes de WhatsApp por tipo de mensaje (bytes). */
export const WA_MEDIA_LIMITS: Record<MediaKind, number> = {
  image: 5 * MB,
  video: 16 * MB,
  audio: 16 * MB,
  voice: 16 * MB,
  document: 100 * MB,
  sticker: 500 * 1024,
};

/** Lo que Evolution convierte a JPEG (sharp) antes de mandarlo como imagen. */
const IMAGE_SENDABLE = /^image\/(jpeg|jpg|png|webp|gif|avif|tiff)$/;
/** Videos que WhatsApp reproduce en el teléfono (H.264 en MP4/3GP). */
const VIDEO_SENDABLE = /^video\/(mp4|3gpp)$/;
/** Audios que WhatsApp reproduce tal cual (sin pasar por nota de voz). */
const AUDIO_SENDABLE = /^audio\/(mpeg|mp3|mp4|x-m4a|aac|ogg|opus|amr)$/;
/** Stickers: Evolution los pasa a WebP. */
const STICKER_SENDABLE = /^image\/(webp|png|jpeg|gif)$/;

export function baseMime(mime: string): string {
  return String(mime ?? '').split(';')[0].trim().toLowerCase();
}

/** Una nota de voz sale de cualquier audio (Evolution la convierte a OGG/Opus con ffmpeg). */
function voiceable(mime: string): boolean {
  return mime.startsWith('audio/') || mime === 'video/webm' || mime === 'application/ogg';
}

export class MediaPlanError extends Error {
  constructor(public code: 'media_too_large' | 'invalid_media') {
    super(code);
  }
}

/**
 * El tipo de mensaje con que sale un archivo. `requested` es lo que pidió la
 * persona (nota de voz, sticker, "como documento"); sin pedido, sale del tipo.
 * Lo que WhatsApp no reproduce o pasa el tope de su tipo baja a documento
 * (hasta 100 MB); una nota de voz más grande que 16 MB es un error.
 */
export function planOutboundKind(mimetype: string, size: number | undefined, requested?: MediaKind | null): MediaKind {
  const mime = baseMime(mimetype);
  const fits = (k: MediaKind) => size === undefined || size <= WA_MEDIA_LIMITS[k];
  let kind: MediaKind;
  if (requested === 'voice') {
    if (!voiceable(mime)) throw new MediaPlanError('invalid_media');
    if (!fits('voice')) throw new MediaPlanError('media_too_large');
    return 'voice';
  }
  if (requested === 'document') kind = 'document';
  else if (requested === 'sticker' && STICKER_SENDABLE.test(mime) && fits('sticker')) return 'sticker';
  else if (IMAGE_SENDABLE.test(mime)) kind = 'image';
  else if (VIDEO_SENDABLE.test(mime)) kind = 'video';
  else if (AUDIO_SENDABLE.test(mime)) kind = 'audio';
  else kind = 'document';
  if (!fits(kind)) kind = 'document';
  if (!fits('document')) throw new MediaPlanError('media_too_large');
  return kind;
}

/** Tipo pedido en el cuerpo de una ruta ("voice", "sticker"...) o null. */
export function parseMediaKind(raw: unknown): MediaKind | null {
  return typeof raw === 'string' && (MEDIA_KINDS as readonly string[]).includes(raw) ? (raw as MediaKind) : null;
}

/** Tipo de un archivo ya guardado (para mostrar), a partir del mimetype. */
export function kindFromMime(mime: string): MediaKind {
  const m = baseMime(mime);
  if (m.startsWith('image/')) return 'image';
  if (m.startsWith('video/')) return 'video';
  if (m.startsWith('audio/')) return 'audio';
  return 'document';
}

// ---------- Lo que la interfaz necesita para dibujar ----------

/** Datos de un archivo (todo opcional salvo el tipo). */
export interface MediaInfo {
  kind: MediaKind;
  size?: number;
  mimetype?: string;
  width?: number;
  height?: number;
  /** Segundos (audio, nota de voz, video). */
  duration?: number;
  /** Nota de voz (push-to-talk). */
  ptt?: boolean;
  /** Páginas de un documento (PDF). */
  pages?: number;
  /** Miniatura JPEG como data URL (la que manda WhatsApp, chica). */
  thumbnail?: string;
  /** Mensaje "ver una vez": WhatsApp no lo entrega a dispositivos vinculados. */
  viewOnce?: boolean;
  /** Sticker animado o video que se reproduce como GIF. */
  animated?: boolean;
}

export interface LocationInfo {
  lat: number;
  lng: number;
  name?: string;
  address?: string;
  url?: string;
  /** Ubicación en tiempo real (llega la última posición). */
  live?: boolean;
}

export interface ContactCard {
  name: string;
  phones: string[];
  email?: string;
  org?: string;
}

/** Tope de la miniatura que se guarda en el mensaje. */
const MAX_THUMBNAIL = 16 * 1024;

/**
 * Bytes que vienen en el JSON de Evolution: base64, Buffer serializado
 * ({ type: 'Buffer', data }), Uint8Array serializado ({ "0": .., "1": .. }) o arreglo.
 */
export function jsonBytes(raw: unknown, max: number): Buffer | null {
  try {
    if (typeof raw === 'string') {
      if (raw.length > Math.ceil((max * 4) / 3) + 4) return null;
      const b = Buffer.from(raw, 'base64');
      return b.length ? b : null;
    }
    if (Array.isArray(raw)) return raw.length && raw.length <= max ? Buffer.from(raw as number[]) : null;
    if (raw && typeof raw === 'object') {
      const o = raw as Record<string, unknown>;
      if (o.type === 'Buffer' && Array.isArray(o.data)) return jsonBytes(o.data, max);
      const keys = Object.keys(o);
      if (keys.length === 0 || keys.length > max || !keys.every((k) => /^\d+$/.test(k))) return null;
      return Buffer.from(keys.sort((a, b) => Number(a) - Number(b)).map((k) => Number(o[k]) & 0xff));
    }
  } catch {
    return null;
  }
  return null;
}

/** Miniatura JPEG de WhatsApp → data URL (solo si de verdad es un JPEG chico). */
export function thumbnailFrom(raw: unknown): string | undefined {
  const b = jsonBytes(raw, MAX_THUMBNAIL);
  if (!b || b.length < 4 || b[0] !== 0xff || b[1] !== 0xd8) return undefined;
  return `data:image/jpeg;base64,${b.toString('base64')}`;
}

/** fileLength / seconds de Baileys: número, string o Long { low, high }. */
export function longNumber(raw: unknown): number {
  if (typeof raw === 'number') return Number.isFinite(raw) ? raw : 0;
  if (typeof raw === 'string') return Number(raw) || 0;
  const o = (raw ?? {}) as { low?: number; high?: number };
  return typeof o.low === 'number' ? (o.low >>> 0) + (o.high ?? 0) * 2 ** 32 : 0;
}

const posInt = (raw: unknown): number | undefined => {
  const n = Math.round(longNumber(raw));
  return n > 0 && n < 1e9 ? n : undefined;
};

/** Saca los campos vacíos (el JSON guardado queda chico). */
export function compactInfo<T extends object>(info: T): T {
  return Object.fromEntries(Object.entries(info).filter(([, v]) => v !== undefined && v !== '' && v !== false)) as T;
}

/** Datos para dibujar un archivo a partir del mensaje de Baileys (imageMessage, audioMessage...). */
export function infoFromBaileys(key: string, m: Record<string, unknown>, viewOnce = false): MediaInfo {
  const kind: MediaKind =
    key === 'imageMessage'
      ? 'image'
      : key === 'videoMessage' || key === 'ptvMessage'
        ? 'video'
        : key === 'audioMessage'
          ? m.ptt === true
            ? 'voice'
            : 'audio'
          : key === 'stickerMessage'
            ? 'sticker'
            : 'document';
  return compactInfo<MediaInfo>({
    kind,
    size: posInt(m.fileLength),
    mimetype: typeof m.mimetype === 'string' ? m.mimetype.slice(0, 100) : undefined,
    width: posInt(m.width),
    height: posInt(m.height),
    duration: posInt(m.seconds),
    ptt: kind === 'voice' ? true : undefined,
    pages: kind === 'document' ? posInt(m.pageCount) : undefined,
    thumbnail: kind === 'audio' || kind === 'voice' ? undefined : thumbnailFrom(m.jpegThumbnail),
    viewOnce: viewOnce || m.viewOnce === true || undefined,
    animated: m.isAnimated === true || m.gifPlayback === true || undefined,
  });
}

const str = (v: unknown, max: number): string | undefined => (typeof v === 'string' && v.trim() ? v.trim().slice(0, max) : undefined);

/** locationMessage / liveLocationMessage → datos. */
export function locationFrom(m: Record<string, unknown>, live: boolean): LocationInfo | null {
  const lat = Number(m.degreesLatitude);
  const lng = Number(m.degreesLongitude);
  if (!Number.isFinite(lat) || !Number.isFinite(lng) || Math.abs(lat) > 90 || Math.abs(lng) > 180) return null;
  const url = str(m.url, 500);
  return compactInfo<LocationInfo>({
    lat,
    lng,
    name: str(m.name, 200),
    address: str(m.address, 300) ?? (live ? str(m.caption, 300) : undefined),
    url: url && /^https:\/\//.test(url) ? url : undefined,
    live: live || undefined,
  });
}

/** Una vCard → nombre, teléfonos (dígitos, con el waid de WhatsApp si viene), email y empresa. */
export function parseVcard(vcard: string, displayName = ''): ContactCard {
  const lines = String(vcard ?? '').slice(0, 8000).replace(/\r\n[ \t]/g, '').split(/\r?\n/);
  let name = displayName.trim();
  const phones: string[] = [];
  let email: string | undefined;
  let org: string | undefined;
  for (const line of lines) {
    const i = line.indexOf(':');
    if (i < 0) continue;
    const head = line.slice(0, i).toUpperCase();
    const value = line.slice(i + 1).trim();
    const field = head.split(';')[0].replace(/^ITEM\d+\./, '');
    if (field === 'FN' && !name) name = value;
    else if (field === 'TEL') {
      const waid = /WAID=(\d{6,15})/i.exec(line.slice(0, i))?.[1];
      const digits = waid ?? value.replace(/[^\d]/g, '');
      if (digits.length >= 6 && digits.length <= 15 && !phones.includes(digits)) phones.push(digits);
    } else if (field === 'EMAIL' && !email) email = value.slice(0, 200);
    else if (field === 'ORG' && !org) org = value.replace(/;+$/, '').replace(/;/g, ' ').slice(0, 200);
  }
  return compactInfo<ContactCard>({ name: name.slice(0, 120), phones: phones.slice(0, 10), email, org });
}

// ---------- Medidas de una imagen (sin dependencias) ----------

/** Ancho y alto de un PNG, JPEG, GIF o WebP leyendo la cabecera; null si no se reconoce. */
export function imageSize(buf: Buffer): { width: number; height: number } | null {
  try {
    if (buf.length >= 24 && buf.readUInt32BE(0) === 0x89504e47) return { width: buf.readUInt32BE(16), height: buf.readUInt32BE(20) };
    if (buf.length >= 10 && buf.toString('ascii', 0, 3) === 'GIF') return { width: buf.readUInt16LE(6), height: buf.readUInt16LE(8) };
    if (buf.length >= 30 && buf.toString('ascii', 0, 4) === 'RIFF' && buf.toString('ascii', 8, 12) === 'WEBP') {
      const chunk = buf.toString('ascii', 12, 16);
      if (chunk === 'VP8 ') return { width: buf.readUInt16LE(26) & 0x3fff, height: buf.readUInt16LE(28) & 0x3fff };
      if (chunk === 'VP8L') {
        const b = buf.readUInt32LE(21);
        return { width: (b & 0x3fff) + 1, height: ((b >> 14) & 0x3fff) + 1 };
      }
      if (chunk === 'VP8X') return { width: buf.readUIntLE(24, 3) + 1, height: buf.readUIntLE(27, 3) + 1 };
      return null;
    }
    if (buf.length >= 4 && buf[0] === 0xff && buf[1] === 0xd8) {
      let o = 2;
      while (o + 9 < buf.length) {
        if (buf[o] !== 0xff) return null;
        const marker = buf[o + 1];
        if (marker === 0xd8 || (marker >= 0xd0 && marker <= 0xd7) || marker === 0x01) {
          o += 2;
          continue;
        }
        const len = buf.readUInt16BE(o + 2);
        // SOF0..SOF15 (menos DHT, JPG y DAC): ahí están las medidas.
        if (marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc) {
          return { height: buf.readUInt16BE(o + 5), width: buf.readUInt16BE(o + 7) };
        }
        if (len < 2) return null;
        o += 2 + len;
      }
    }
  } catch {
    return null;
  }
  return null;
}

// ---------- Nombres de archivo para Evolution ----------

const EXT_FOR: Record<string, string> = {
  'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp', 'image/gif': 'gif',
  'video/mp4': 'mp4', 'video/3gpp': '3gp', 'video/quicktime': 'mov', 'video/webm': 'webm',
  'audio/mpeg': 'mp3', 'audio/mp4': 'm4a', 'audio/x-m4a': 'm4a', 'audio/aac': 'aac', 'audio/ogg': 'ogg', 'audio/opus': 'ogg',
  'audio/amr': 'amr', 'audio/webm': 'weba', 'audio/wav': 'wav', 'application/pdf': 'pdf', 'text/plain': 'txt',
};

/**
 * Nombre que se manda a Evolution. Evolution saca el mimetype del nombre
 * (mime-types lookup), así que tiene que tener una extensión que coincida;
 * las imágenes salen como JPEG (Evolution las convierte).
 */
export function evolutionFileName(filename: string, mimetype: string, kind: MediaKind): string {
  const name = String(filename ?? '').replace(/[\\/\r\n\0]/g, '_').trim().slice(0, 200) || 'file';
  const dot = name.lastIndexOf('.');
  const stem = dot > 0 ? name.slice(0, dot) : name;
  const ext = dot > 0 ? name.slice(dot + 1).toLowerCase() : '';
  if (kind === 'image') return `${stem}.jpg`;
  if (kind === 'video') return `${stem}.mp4`;
  if (ext && /^[a-z0-9]{1,8}$/.test(ext)) return name;
  const want = EXT_FOR[baseMime(mimetype)];
  return want ? `${name}.${want}` : name;
}
