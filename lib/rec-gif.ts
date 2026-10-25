/**
 * GIF animado de vista previa (los primeros segundos del video, como la
 * miniatura GIF de Loom). Encoder mínimo: paleta fija de 252 colores
 * (6 niveles de rojo, 7 de verde, 6 de azul), LZW estándar y loop infinito.
 * Lógica pura: corre en el navegador sobre los frames del canvas.
 */

export interface GifFrame {
  width: number;
  height: number;
  /** RGBA, como ImageData.data. */
  rgba: Uint8ClampedArray | Uint8Array;
}

const R_LEVELS = 6;
const G_LEVELS = 7;
const B_LEVELS = 6;

/** Paleta fija (256 entradas, las últimas 4 en negro). */
export function fixedPalette(): Uint8Array {
  const pal = new Uint8Array(256 * 3);
  let i = 0;
  for (let r = 0; r < R_LEVELS; r++)
    for (let g = 0; g < G_LEVELS; g++)
      for (let b = 0; b < B_LEVELS; b++) {
        pal[i * 3] = Math.round((r * 255) / (R_LEVELS - 1));
        pal[i * 3 + 1] = Math.round((g * 255) / (G_LEVELS - 1));
        pal[i * 3 + 2] = Math.round((b * 255) / (B_LEVELS - 1));
        i++;
      }
  return pal;
}

export function paletteIndex(r: number, g: number, b: number): number {
  const ri = Math.round((r / 255) * (R_LEVELS - 1));
  const gi = Math.round((g / 255) * (G_LEVELS - 1));
  const bi = Math.round((b / 255) * (B_LEVELS - 1));
  return ri * G_LEVELS * B_LEVELS + gi * B_LEVELS + bi;
}

/** Compresión LZW de GIF con tamaño mínimo de código 8. Devuelve los bytes sin partir en bloques. */
export function lzwEncode(indices: Uint8Array, minCodeSize = 8): Uint8Array {
  const clear = 1 << minCodeSize;
  const eoi = clear + 1;
  let codeSize = minCodeSize + 1;
  let next = eoi + 1;
  let table = new Map<number, number>();
  const out: number[] = [];
  let cur = 0;
  let bits = 0;
  const emit = (code: number) => {
    cur |= code << bits;
    bits += codeSize;
    while (bits >= 8) {
      out.push(cur & 0xff);
      cur >>>= 8;
      bits -= 8;
    }
  };
  emit(clear);
  if (indices.length === 0) {
    emit(eoi);
    if (bits > 0) out.push(cur & 0xff);
    return Uint8Array.from(out);
  }
  let prefix = indices[0];
  for (let i = 1; i < indices.length; i++) {
    const k = indices[i];
    const key = prefix * 256 + k;
    const found = table.get(key);
    if (found !== undefined) {
      prefix = found;
      continue;
    }
    emit(prefix);
    if (next === 4096) {
      emit(clear);
      table = new Map();
      next = eoi + 1;
      codeSize = minCodeSize + 1;
    } else {
      if (next >= 1 << codeSize) codeSize++;
      table.set(key, next++);
    }
    prefix = k;
  }
  emit(prefix);
  emit(eoi);
  if (bits > 0) out.push(cur & 0xff);
  return Uint8Array.from(out);
}

/** Encoder animado. `delayCs` en centésimas de segundo por frame. */
export function encodeGif(frames: GifFrame[], delayCs = 20): Uint8Array {
  if (frames.length === 0) throw new Error('no_frames');
  const { width, height } = frames[0];
  const bytes: number[] = [];
  const push16 = (n: number) => bytes.push(n & 0xff, (n >> 8) & 0xff);
  for (const c of 'GIF89a') bytes.push(c.charCodeAt(0));
  push16(width);
  push16(height);
  bytes.push(0xf7, 0, 0); // tabla global de 256 colores
  bytes.push(...fixedPalette());
  // NETSCAPE2.0: loop infinito.
  bytes.push(0x21, 0xff, 0x0b);
  for (const c of 'NETSCAPE2.0') bytes.push(c.charCodeAt(0));
  bytes.push(0x03, 0x01, 0x00, 0x00, 0x00);
  for (const f of frames) {
    if (f.width !== width || f.height !== height) throw new Error('frame_size');
    const idx = new Uint8Array(width * height);
    for (let i = 0, p = 0; i < idx.length; i++, p += 4) idx[i] = paletteIndex(f.rgba[p], f.rgba[p + 1], f.rgba[p + 2]);
    bytes.push(0x21, 0xf9, 0x04, 0x04);
    push16(delayCs);
    bytes.push(0x00, 0x00);
    bytes.push(0x2c);
    push16(0);
    push16(0);
    push16(width);
    push16(height);
    bytes.push(0x00);
    bytes.push(8);
    const data = lzwEncode(idx, 8);
    for (let i = 0; i < data.length; i += 255) {
      const chunk = data.subarray(i, i + 255);
      bytes.push(chunk.length, ...chunk);
    }
    bytes.push(0x00);
  }
  bytes.push(0x3b);
  return Uint8Array.from(bytes);
}
