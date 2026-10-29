/**
 * Design: tipo y tamaño de una imagen subida, leídos de los bytes (no del
 * nombre ni del tipo que manda el navegador). Puro.
 */

export const DESIGN_IMAGE_TYPES = ['image/png', 'image/jpeg', 'image/gif', 'image/webp'] as const;
export type DesignImageType = (typeof DESIGN_IMAGE_TYPES)[number];
/** Tope por imagen: el body de una función de Vercel no pasa de 4.5 MB (el editor achica las fotos grandes antes de subir). */
export const DESIGN_MAX_UPLOAD_BYTES = 4 * 1024 * 1024;

/** Tipo por los primeros bytes; null si no es PNG, JPEG, GIF ni WebP (SVG no: puede llevar scripts). */
export function sniffDesignImage(b: Uint8Array): DesignImageType | null {
  const at = (i: number) => b[i] ?? -1;
  if (at(0) === 0x89 && at(1) === 0x50 && at(2) === 0x4e && at(3) === 0x47) return 'image/png';
  if (at(0) === 0xff && at(1) === 0xd8 && at(2) === 0xff) return 'image/jpeg';
  if (at(0) === 0x47 && at(1) === 0x49 && at(2) === 0x46 && at(3) === 0x38) return 'image/gif';
  if (at(0) === 0x52 && at(1) === 0x49 && at(2) === 0x46 && at(3) === 0x46 && at(8) === 0x57 && at(9) === 0x45 && at(10) === 0x42 && at(11) === 0x50) return 'image/webp';
  return null;
}

const u16be = (b: Uint8Array, i: number) => (b[i] << 8) | b[i + 1];
const u16le = (b: Uint8Array, i: number) => b[i] | (b[i + 1] << 8);
const u32be = (b: Uint8Array, i: number) => ((b[i] << 24) >>> 0) + (b[i + 1] << 16) + (b[i + 2] << 8) + b[i + 3];
const u24le = (b: Uint8Array, i: number) => b[i] | (b[i + 1] << 8) | (b[i + 2] << 16);

/** Ancho y alto en px; null si el encabezado no se entiende. */
export function imageDimensions(b: Uint8Array, type: DesignImageType): { width: number; height: number } | null {
  try {
    if (type === 'image/png') {
      if (b.length < 24) return null;
      return ok(u32be(b, 16), u32be(b, 20));
    }
    if (type === 'image/gif') {
      if (b.length < 10) return null;
      return ok(u16le(b, 6), u16le(b, 8));
    }
    if (type === 'image/webp') {
      const chunk = String.fromCharCode(b[12], b[13], b[14], b[15]);
      if (chunk === 'VP8X') return ok(u24le(b, 24) + 1, u24le(b, 27) + 1);
      if (chunk === 'VP8 ') return ok(u16le(b, 26) & 0x3fff, u16le(b, 28) & 0x3fff);
      if (chunk === 'VP8L') {
        const bits = b[21] | (b[22] << 8) | (b[23] << 16) | (b[24] << 24);
        return ok((bits & 0x3fff) + 1, ((bits >> 14) & 0x3fff) + 1);
      }
      return null;
    }
    // JPEG: el primer SOF (baseline, progresivo, etc.).
    let i = 2;
    while (i + 9 < b.length) {
      if (b[i] !== 0xff) {
        i++;
        continue;
      }
      const marker = b[i + 1];
      if (marker === 0xd8 || marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) {
        i += 2;
        continue;
      }
      const len = u16be(b, i + 2);
      if (marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc) {
        return ok(u16be(b, i + 7), u16be(b, i + 5));
      }
      i += 2 + len;
    }
    return null;
  } catch {
    return null;
  }
}

function ok(width: number, height: number) {
  return width > 0 && height > 0 && width < 100_000 && height < 100_000 ? { width, height } : null;
}
