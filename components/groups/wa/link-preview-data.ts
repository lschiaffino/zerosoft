/**
 * Datos de la vista previa de un link en los chats (Inbox y Lines): de dónde
 * sale (la que mandó WhatsApp con el mensaje o la que leyó el servidor), qué
 * se puede mostrar sin riesgo y la caché del navegador. Puro salvo el fetch.
 */
import { imageSize } from '@/lib/image-size';
import { linkLayout } from '@/lib/chat-display';

export interface LinkPreviewData {
  url: string;
  title: string;
  description?: string;
  site?: string;
  /** Imagen: data URL (la miniatura que mandó WhatsApp) o la ruta de nuestro servidor. */
  image?: string;
  imageWidth?: number;
  imageHeight?: number;
  /** Segunda imagen (grilla de dos). */
  image2?: string;
  /** Ícono del sitio (data URL chica). */
  favicon?: string;
}

/** Solo http(s): un javascript: o data: en el href nunca llega a la tarjeta. */
export function safeHref(raw: string | undefined): string {
  if (!raw) return '';
  try {
    const u = new URL(raw);
    return u.protocol === 'https:' || u.protocol === 'http:' ? u.toString() : '';
  } catch {
    return '';
  }
}

const DATA_IMG = /^data:image\/(jpeg|png|webp|gif|x-icon|vnd\.microsoft\.icon);base64,[A-Za-z0-9+/=]+$/;

/** Imágenes que se dibujan: data URL de imagen (sin SVG) o la ruta de nuestras vistas previas. Nada de hosts de afuera. */
export function safeImage(raw: string | undefined): string {
  if (!raw) return '';
  if (raw.startsWith('/api/wa/link-preview/image?')) return raw;
  return raw.length < 2_000_000 && DATA_IMG.test(raw) ? raw : '';
}

/** Medidas de una imagen en data URL, leyendo solo la cabecera. */
export function dataUrlSize(src: string | undefined): { width: number; height: number } | null {
  if (!src?.startsWith('data:')) return null;
  const comma = src.indexOf(',');
  if (comma < 0) return null;
  try {
    // Con 64 KB de base64 alcanza para la cabecera de cualquier JPEG razonable.
    const bin = atob(src.slice(comma + 1, comma + 1 + 65_536).replace(/=+$/, '').slice(0, 65_536 - (65_536 % 4)));
    const bytes = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    return imageSize(bytes);
  } catch {
    return null;
  }
}

/** La vista previa que mandó WhatsApp, con las medidas de su miniatura. */
export function fromGiven(given: LinkPreviewData | null | undefined): LinkPreviewData | null {
  if (!given?.title) return null;
  const size = given.imageWidth ? null : dataUrlSize(given.image);
  return size ? { ...given, imageWidth: size.width, imageHeight: size.height } : given;
}

/**
 * Cuál se muestra: la del servidor si trae imagen grande (WhatsApp manda una
 * miniatura chica) o si no vino ninguna con el mensaje; si no, la de WhatsApp.
 */
export function pickPreview(given: LinkPreviewData | null, fetched: LinkPreviewData | null): LinkPreviewData | null {
  if (!given) return fetched?.title ? fetched : null;
  if (fetched?.title && linkLayout(fetched) === 'large' && linkLayout(given) !== 'large') return fetched;
  return given;
}

/** El servidor hace falta: no vino vista previa, o la que vino no da para la tarjeta grande que pidió la persona. */
export function needsFetch(given: LinkPreviewData | null, pref: 'large' | 'compact' | 'off'): boolean {
  if (pref === 'off') return false;
  if (!given) return true;
  return pref === 'large' && linkLayout(given) !== 'large';
}

export function domainOf(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, '');
  } catch {
    return '';
  }
}

/** Caché del navegador por URL (una sola vez por sesión de página), con tope. */
const cache = new Map<string, Promise<LinkPreviewData | null>>();
const CACHE_MAX = 300;

export function fetchPreview(url: string): Promise<LinkPreviewData | null> {
  let p = cache.get(url);
  if (!p) {
    p = fetch(`/api/wa/link-preview?url=${encodeURIComponent(url)}`)
      .then(async (r) => (r.ok ? ((await r.json()) as { preview: LinkPreviewData }).preview : null))
      .catch(() => null);
    cache.set(url, p);
    // Si falló, otro intento más tarde puede andar.
    void p.then((d) => {
      if (!d) cache.delete(url);
    });
    if (cache.size > CACHE_MAX) cache.delete(cache.keys().next().value as string);
  }
  return p;
}
