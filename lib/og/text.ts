/**
 * Medidas del texto de las tarjetas para compartir, sin dependencias para
 * poder probarlas: con los anchos reales de la fuente se elige el tamaño más
 * grande en el que el título entra.
 */

/**
 * Avance de cada letra de Space Grotesk Medium (lib/og-fonts), en milésimas de
 * em, de U+0020 a U+017F (latín básico, Latin-1 y Latin Extended-A), sacado
 * del hmtx de la fuente. Lo que no está (0) cuenta como 0.6 em.
 */
const SG_FIRST = 0x20;
const SG_WIDTHS = [
  255,276,470,632,610,765,598,273,389,383,530,620,273,443,276,379,645,435,598,606,630,599,615,559,611,615,276,276,620,620,620,579,
  1020,632,663,643,665,559,537,661,656,254,602,618,544,874,667,673,603,673,632,610,588,669,619,887,641,617,577,347,379,347,620,620,
  288,577,641,592,641,584,439,640,615,256,258,551,256,857,615,615,641,641,387,525,458,614,544,792,593,614,519,449,249,449,620,0,
  0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,
  255,276,598,633,620,620,249,486,432,712,419,702,620,443,523,412,388,620,365,370,288,623,596,203,326,256,437,702,823,824,893,579,
  632,632,632,632,632,632,826,643,559,559,559,559,254,254,254,254,665,667,673,673,673,673,673,620,673,669,669,669,669,617,603,639,
  577,577,577,577,577,577,899,592,584,584,584,584,256,256,256,256,615,615,615,615,615,615,615,620,615,614,614,614,614,614,640,614,
  632,577,632,577,632,577,643,592,643,592,643,592,643,592,665,720,665,641,559,584,559,584,559,584,559,584,559,584,661,640,661,640,
  661,640,661,640,656,615,656,615,254,256,254,256,254,256,254,256,254,256,724,513,602,258,618,551,551,544,256,544,256,544,334,544,
  431,606,395,667,615,667,615,667,615,615,667,615,673,615,673,615,673,615,837,1003,632,387,632,387,632,387,610,525,610,525,610,525,
  610,525,588,458,588,458,588,458,669,614,669,614,669,614,669,614,669,614,669,614,887,792,617,614,617,577,519,577,519,577,519,357,
];

/** Ancho de un texto en Space Grotesk 500, en em. */
export function textEm(text: string): number {
  let w = 0;
  for (const ch of text) {
    const cp = ch.codePointAt(0) ?? 0;
    const v = cp >= SG_FIRST && cp < SG_FIRST + SG_WIDTHS.length ? SG_WIDTHS[cp - SG_FIRST] : 0;
    w += (v || 600) / 1000;
  }
  return w;
}

/** Cuántas líneas ocupa el texto a ese tamaño y ancho (corte por palabra). */
export function lineCount(text: string, size: number, width: number, tracking = 0): number {
  const words = text.split(/\s+/).filter(Boolean);
  const space = textEm(' ') * size;
  let lines = 1;
  let x = 0;
  for (const word of words) {
    const w = textEm(word) * size + tracking * word.length;
    if (x > 0 && x + space + w > width) {
      lines++;
      x = w;
    } else {
      x += (x > 0 ? space : 0) + w;
    }
  }
  return lines;
}

/** Tracking de los títulos: más cerrado cuanto más grande (como el display del sitio). */
export function titleTracking(size: number): number {
  return -Math.round(size * 0.025 * 10) / 10;
}

/**
 * El tamaño más grande (de `sizes`) en el que el texto entra en `maxLines`
 * líneas de `width` px. Si no entra ni en el más chico, se recorta por
 * palabra con "…" hasta que entre: nunca queda una palabra cortada.
 */
export function fitText(text: string, width: number, maxLines: number, sizes: readonly number[] = [104, 92, 80, 72, 64, 58, 52]): { size: number; text: string } {
  const clean = text.replace(/\s+/g, ' ').trim();
  for (const size of sizes) {
    if (lineCount(clean, size, width, titleTracking(size)) <= maxLines) return { size, text: clean };
  }
  const size = sizes[sizes.length - 1];
  const words = clean.split(' ');
  while (words.length > 1) {
    words.pop();
    const cut = `${words.join(' ').replace(/[\s,.;:·-]+$/, '')}…`;
    if (lineCount(cut, size, width, titleTracking(size)) <= maxLines) return { size, text: cut };
  }
  return { size, text: clean };
}

/** Solo el tamaño (ver fitText). */
export function fitTitle(title: string, width: number, maxLines: number, sizes?: readonly number[]): number {
  return fitText(title, width, maxLines, sizes).size;
}

/** Recorta en palabra completa con "…" (los títulos largos no se cortan a mitad de palabra). */
export function clampText(text: string, max: number): string {
  const clean = text.replace(/\s+/g, ' ').trim();
  if (clean.length <= max) return clean;
  const cut = clean.slice(0, max);
  const space = cut.lastIndexOf(' ');
  return `${(space > max * 0.6 ? cut.slice(0, space) : cut).replace(/[\s,.;:·-]+$/, '')}…`;
}

/** Duración de un video para la tarjeta: 0:42, 12:05, 1:02:09. */
export function formatDuration(ms: number | null | undefined): string {
  if (!ms || ms < 0 || !Number.isFinite(ms)) return '';
  const total = Math.round(ms / 1000);
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  const ss = String(s).padStart(2, '0');
  return h ? `${h}:${String(m).padStart(2, '0')}:${ss}` : `${m}:${ss}`;
}
