/**
 * Vista previa de la primera página de un PDF en los chats de WhatsApp (Inbox
 * y Lines). Si WhatsApp la manda con el mensaje (jpegThumbnail), es esa. Si
 * no (lo que mandamos nosotros, o llegó sin miniatura), la primera persona
 * que ve el PDF la dibuja en su navegador (pdf.js) y la guarda con el mensaje
 * por la ruta del archivo (PUT): se dibuja una vez, no en cada vista, y la ve
 * solo quien puede ver el mensaje.
 *
 * Lo que llega del navegador se valida: tiene que ser un JPEG chico de
 * verdad (por sus bytes), y solo se guarda en un PDF que todavía no tiene.
 */
import { imageSize } from './image-size';

/** Tope del data URL (el navegador la achica a 480 de ancho). */
export const DOC_THUMB_MAX = 48_000;
const MAX_SIDE = 1200;

/** El data URL JPEG si es válido; null si no. */
export function validDocThumb(raw: unknown): string | null {
  if (typeof raw !== 'string' || raw.length > DOC_THUMB_MAX) return null;
  const m = /^data:image\/jpeg;base64,([A-Za-z0-9+/]+={0,2})$/.exec(raw);
  if (!m) return null;
  const bytes = Buffer.from(m[1], 'base64');
  if (bytes.length < 100 || bytes[0] !== 0xff || bytes[1] !== 0xd8) return null;
  const size = imageSize(bytes);
  if (!size || size.type !== 'image/jpeg' || size.width < 32 || size.height < 16 || size.width > MAX_SIDE || size.height > MAX_SIDE) return null;
  return raw;
}

export function isPdf(mime: string | null | undefined, name: string | null | undefined): boolean {
  return String(mime ?? '').split(';')[0].trim().toLowerCase() === 'application/pdf' || /\.pdf$/i.test(String(name ?? ''));
}

export function validPages(raw: unknown): number {
  const n = Number(raw);
  return Number.isInteger(n) && n > 0 && n < 100_000 ? n : 0;
}
