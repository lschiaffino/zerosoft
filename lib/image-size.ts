/**
 * Ancho y alto de una imagen leyendo solo su cabecera (PNG, JPEG, GIF, WebP,
 * ICO). Puro y sin dependencias: lo usa la vista previa de links de los chats
 * de WhatsApp para elegir entre la tarjeta grande y la compacta, y para
 * saber el tipo real de lo que bajó (no el que dice la cabecera). null si no
 * se reconoce el formato o los bytes están cortados.
 */
export type ImageType = 'image/png' | 'image/gif' | 'image/webp' | 'image/x-icon' | 'image/jpeg';

export function imageSize(buf: Uint8Array): { width: number; height: number; type: ImageType } | null {
  const b = buf;
  const n = b.length;
  const u16be = (i: number) => (b[i] << 8) | b[i + 1];
  const u16le = (i: number) => b[i] | (b[i + 1] << 8);
  const u32be = (i: number) => ((b[i] << 24) >>> 0) + (b[i + 1] << 16) + (b[i + 2] << 8) + b[i + 3];
  const ok = (w: number, h: number, type: ImageType) => (w > 0 && h > 0 && w < 100_000 && h < 100_000 ? { width: w, height: h, type } : null);
  // PNG: firma de 8 bytes y el IHDR.
  if (n >= 24 && b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47) return ok(u32be(16), u32be(20), 'image/png');
  // GIF87a / GIF89a.
  if (n >= 10 && b[0] === 0x47 && b[1] === 0x49 && b[2] === 0x46) return ok(u16le(6), u16le(8), 'image/gif');
  // WebP: RIFF....WEBP y el primer bloque.
  if (n >= 30 && b[0] === 0x52 && b[1] === 0x49 && b[2] === 0x46 && b[3] === 0x46 && b[8] === 0x57 && b[9] === 0x45 && b[10] === 0x42 && b[11] === 0x50) {
    const chunk = String.fromCharCode(b[12], b[13], b[14], b[15]);
    if (chunk === 'VP8 ') return ok(u16le(26) & 0x3fff, u16le(28) & 0x3fff, 'image/webp');
    if (chunk === 'VP8L') {
      const bits = b[21] | (b[22] << 8) | (b[23] << 16) | (b[24] << 24);
      return ok((bits & 0x3fff) + 1, ((bits >> 14) & 0x3fff) + 1, 'image/webp');
    }
    if (chunk === 'VP8X') return ok(1 + (b[24] | (b[25] << 8) | (b[26] << 16)), 1 + (b[27] | (b[28] << 8) | (b[29] << 16)), 'image/webp');
    return null;
  }
  // ICO: el tamaño de la primera imagen (0 quiere decir 256).
  if (n >= 8 && b[0] === 0 && b[1] === 0 && b[2] === 1 && b[3] === 0) return ok(b[6] || 256, b[7] || 256, 'image/x-icon');
  // JPEG: recorre los marcadores hasta un SOF.
  if (n >= 4 && b[0] === 0xff && b[1] === 0xd8) {
    let i = 2;
    while (i + 9 < n) {
      if (b[i] !== 0xff) return null;
      const marker = b[i + 1];
      if (marker === 0xff) {
        i++;
        continue;
      }
      const len = u16be(i + 2);
      // SOF0..SOF15 salvo DHT (C4), JPG (C8) y DAC (CC).
      if (marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc) return ok(u16be(i + 7), u16be(i + 5), 'image/jpeg');
      if (len < 2) return null;
      i += 2 + len;
    }
  }
  return null;
}
