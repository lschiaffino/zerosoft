/**
 * Board — stickies que siguen claros en modo oscuro.
 *
 * El modo oscuro de Excalidraw dibuja el lienzo en claro y le aplica encima
 * el filtro CSS `invert(93%) hue-rotate(180deg)`: un sticky amarillo queda
 * marrón oscuro, y el filtro no puede dar un amarillo claro (recorta). Acá el
 * lienzo se dibuja sin ese filtro y cada color se pasa por la misma cuenta en
 * JS, salvo los colores de stickies y la tinta de su texto, que quedan tal
 * cual (como en Miro: sticky claro con letra oscura sobre el lienzo oscuro).
 * Puro: la cuenta y la tabla de colores. El parche del lienzo vive en
 * components/board/darkCanvas.ts.
 */
import { STICKY_COLORS, STICKY_TEXT_INK } from './board-stickies';

/** Tinta del texto de los stickies: casi igual a la de siempre, pero se distingue para no invertirla. */
export const STICKY_INK = STICKY_TEXT_INK;
/** Tinta por defecto de Excalidraw (la que tenían los stickies viejos). */
export const DEFAULT_INK = '#1e1e1e';

const INVERT = 0.93;
// hue-rotate(180deg) de CSS (matriz de Filter Effects con cos = -1, sin = 0).
const HUE: number[][] = [
  [-0.574, 1.43, 0.144],
  [0.426, 0.43, 0.144],
  [0.426, 1.43, -0.856],
];

type Rgb = [number, number, number];

const clamp = (n: number) => Math.min(1, Math.max(0, n));

function parseHex(hex: string): Rgb | null {
  const m = /^#([0-9a-f]{6})$/i.exec(hex.trim());
  if (!m) return null;
  const n = parseInt(m[1], 16);
  return [((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255];
}

function toHex(c: Rgb): string {
  return `#${c.map((v) => Math.round(clamp(v) * 255).toString(16).padStart(2, '0')).join('')}`;
}

/** Lo que hace el filtro de Excalidraw con un color (con el recorte a 0..1 de cada paso). */
export function applyDarkFilter(hex: string): string {
  const c = parseHex(hex);
  if (!c) return hex;
  const inv = c.map((v) => INVERT + v * (1 - 2 * INVERT)) as Rgb;
  const out = HUE.map((row) => clamp(row[0] * inv[0] + row[1] * inv[1] + row[2] * inv[2])) as Rgb;
  return toHex(out);
}

/** Colores que quedan tal cual en oscuro: los fondos de stickies y la tinta de su texto. */
export const DARK_KEEP = new Set<string>([...STICKY_COLORS.map((c) => c.fill), STICKY_INK]);

const darkCache = new Map<string, string>();

/**
 * Color con el que se dibuja en el lienzo oscuro: el mismo resultado que el
 * filtro de Excalidraw, salvo los colores de stickies, que quedan claros (y su
 * tinta, oscura). Acepta #rgb, #rrggbb, #rrggbbaa, rgb() y rgba(); lo demás
 * (transparent, nombres) queda igual.
 */
export function darkColor(raw: string): string {
  const hit = darkCache.get(raw);
  if (hit !== undefined) return hit;
  const v = raw.trim().toLowerCase();
  let out = raw;
  if (DARK_KEEP.has(v)) out = raw;
  else if (/^#[0-9a-f]{3}$/.test(v)) out = applyDarkFilter(`#${v[1]}${v[1]}${v[2]}${v[2]}${v[3]}${v[3]}`);
  else if (/^#[0-9a-f]{6}$/.test(v)) out = applyDarkFilter(v);
  else if (/^#[0-9a-f]{8}$/.test(v)) out = applyDarkFilter(v.slice(0, 7)) + v.slice(7);
  else {
    const m = /^rgba?\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)\s*(?:,\s*([\d.]+)\s*)?\)$/.exec(v);
    if (m) {
      const hex = applyDarkFilter(`#${[m[1], m[2], m[3]].map((n) => Math.min(255, Number(n)).toString(16).padStart(2, '0')).join('')}`);
      const [r, g, b] = [1, 3, 5].map((k) => parseInt(hex.slice(k, k + 2), 16));
      out = m[4] !== undefined ? `rgba(${r}, ${g}, ${b}, ${m[4]})` : `rgb(${r}, ${g}, ${b})`;
    }
  }
  if (darkCache.size > 2000) darkCache.clear();
  darkCache.set(raw, out);
  return out;
}
