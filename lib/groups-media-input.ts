import { parseMediaKind, type MediaKind } from './groups-media';

export interface MediaBody {
  url: string;
  mimetype: string;
  filename: string;
  /** Bytes (lo que devolvió la subida). */
  size?: number;
  /** "voice" (nota de voz), "sticker", "document" (mandar como archivo)...; sin él, sale del mimetype. */
  kind?: MediaKind;
  width?: number;
  height?: number;
  /** Segundos. */
  duration?: number;
}

/**
 * El proveedor de WhatsApp baja la media de esta URL desde su red (el puente
 * puede estar en la red interna de un self-host): solo hosts propios, el Blob
 * de la suite o los de GROUPS_MEDIA_HOSTS (coma). Nada de IPs privadas ni
 * metadatos de la nube por un link arbitrario.
 */
export function allowedMediaHost(raw: string, base: string): boolean {
  let u: URL;
  try {
    u = new URL(raw);
  } catch {
    return false;
  }
  if (u.protocol !== 'https:' || u.username || u.password) return false;
  const host = u.hostname.toLowerCase();
  const own = (() => {
    try {
      return new URL(base).hostname.toLowerCase();
    } catch {
      return '';
    }
  })();
  if (own && host === own) return true;
  if (/^[a-z0-9-]+\.public\.blob\.vercel-storage\.com$/.test(host)) return true;
  const extra = (process.env.GROUPS_MEDIA_HOSTS ?? '').split(',').map((h) => h.trim().toLowerCase()).filter(Boolean);
  return extra.includes(host);
}

const num = (v: unknown, max: number): number | undefined => {
  const n = typeof v === 'number' ? v : typeof v === 'string' && v.trim() ? Number(v) : NaN;
  return Number.isFinite(n) && n > 0 && n <= max ? n : undefined;
};

/**
 * Groups: adjunto que llega en el cuerpo de una ruta ({ url, mimetype,
 * filename, size?, kind?, width?, height?, duration? }). Solo archivos
 * subidos a zerosoft (/uploads/) o URLs https; un /uploads/ relativo se
 * completa con el origen porque el proveedor baja la media de una URL pública.
 * `voice: true` es lo mismo que `kind: "voice"`.
 */
export function mediaFromBody(raw: unknown, req: Request): MediaBody | null {
  if (!raw || typeof raw !== 'object') return null;
  const m = raw as Record<string, unknown>;
  const url = typeof m.url === 'string' ? m.url.slice(0, 2000) : '';
  if (!/^(\/uploads\/|https:\/\/)/.test(url)) return null;
  const base = (process.env.NEXTAUTH_URL || new URL(req.url).origin).replace(/\/$/, '');
  if (!url.startsWith('/') && !allowedMediaHost(url, base)) return null;
  const out: MediaBody = {
    url: url.startsWith('/') ? `${base}${url}` : url,
    mimetype: (typeof m.mimetype === 'string' && m.mimetype.slice(0, 100)) || 'application/octet-stream',
    filename: (typeof m.filename === 'string' && m.filename.slice(0, 200)) || 'file',
  };
  const kind = m.voice === true ? 'voice' : parseMediaKind(m.kind);
  if (kind) out.kind = kind;
  const size = num(m.size, 2 ** 40);
  if (size) out.size = Math.round(size);
  const width = num(m.width, 20_000);
  const height = num(m.height, 20_000);
  if (width && height) Object.assign(out, { width: Math.round(width), height: Math.round(height) });
  const duration = num(m.duration, 86_400);
  if (duration) out.duration = Math.round(duration);
  return out;
}
