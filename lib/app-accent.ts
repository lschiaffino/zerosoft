/**
 * Color de los botones primarios dentro de cada app. Puro: lo usan el shell de
 * la app (components/app/AppAccent.tsx) y los tests.
 *
 * La regla, en OKLCH (luz, croma, tono):
 * - El texto es blanco. Un botón de color con texto negro se ve sucio en los
 *   tonos medios (el verde de Lines, el naranja de Track).
 * - Para que el blanco se lea (4.5:1 o más), el relleno baja de luz sin tocar
 *   el tono: un verde sigue siendo ese verde, más profundo. El croma se queda
 *   igual salvo cuando se sale de sRGB, y entonces baja lo justo.
 * - Los colores que ya son oscuros quedan como están.
 * - La excepción son los colores muy claros (el amarillo de Notes): oscurecer
 *   un amarillo lo vuelve oliva o marrón. Esos mantienen su relleno y llevan
 *   tinta del mismo tono, no negro puro.
 * - En modo oscuro el relleno sube un poco de luz (hasta donde el blanco se
 *   sigue leyendo) para que no se hunda en el fondo casi negro.
 * - Al pasar el mouse baja de luz; al apretar, un poco más.
 */

function channel(v: number): number {
  const s = v / 255;
  return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
}

function parseHex(hex: string): [number, number, number] | null {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex.trim());
  if (!m) return null;
  const n = parseInt(m[1], 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

/** Luminancia relativa (WCAG) de un color #rrggbb; null si no es un hex de 6 dígitos. */
export function luminance(hex: string): number | null {
  const rgb = parseHex(hex);
  if (!rgb) return null;
  return 0.2126 * channel(rgb[0]) + 0.7152 * channel(rgb[1]) + 0.0722 * channel(rgb[2]);
}

/** Contraste WCAG entre dos colores #rrggbb (1 a 21). */
export function contrast(a: string, b: string): number {
  const la = luminance(a) ?? 0;
  const lb = luminance(b) ?? 0;
  return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05);
}

/* ---------- OKLCH (Björn Ottosson) ---------- */

export interface Oklch {
  l: number;
  c: number;
  h: number;
}

const toLinear = (v: number) => channel(v);
const fromLinear = (v: number) => 255 * (v <= 0.0031308 ? 12.92 * v : 1.055 * v ** (1 / 2.4) - 0.055);

/** #rrggbb a OKLCH (h en grados, 0 a 360); null si no es un hex válido. */
export function hexToOklch(hex: string): Oklch | null {
  const rgb = parseHex(hex);
  if (!rgb) return null;
  const [r, g, b] = rgb.map(toLinear);
  const l_ = Math.cbrt(0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b);
  const m_ = Math.cbrt(0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b);
  const s_ = Math.cbrt(0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b);
  const L = 0.2104542553 * l_ + 0.793617785 * m_ - 0.0040720468 * s_;
  const A = 1.9779984951 * l_ - 2.428592205 * m_ + 0.4505937099 * s_;
  const B = 0.0259040371 * l_ + 0.7827717662 * m_ - 0.808675766 * s_;
  const h = (Math.atan2(B, A) * 180) / Math.PI;
  return { l: L, c: Math.hypot(A, B), h: h < 0 ? h + 360 : h };
}

/** OKLCH a sRGB lineal sin recortar (puede salirse de 0..1). */
function oklchToLinear({ l, c, h }: Oklch): [number, number, number] {
  const a = c * Math.cos((h * Math.PI) / 180);
  const b = c * Math.sin((h * Math.PI) / 180);
  const l_ = (l + 0.3963377774 * a + 0.2158037573 * b) ** 3;
  const m_ = (l - 0.1055613458 * a - 0.0638541728 * b) ** 3;
  const s_ = (l - 0.0894841775 * a - 1.291485548 * b) ** 3;
  return [
    4.0767416621 * l_ - 3.3077115913 * m_ + 0.2309699292 * s_,
    -1.2684380046 * l_ + 2.6097574011 * m_ - 0.3413193965 * s_,
    -0.0041960863 * l_ - 0.7034186147 * m_ + 1.707815229 * s_,
  ];
}

const inGamut = (rgb: number[]) => rgb.every((v) => v >= -1e-4 && v <= 1 + 1e-4);

/** OKLCH a #rrggbb. Si el color no entra en sRGB, baja el croma (mismo tono y luz) hasta que entre. */
export function oklchToHex(color: Oklch): string {
  let { c } = color;
  if (!inGamut(oklchToLinear({ ...color, c }))) {
    let lo = 0;
    let hi = c;
    for (let i = 0; i < 24; i++) {
      const mid = (lo + hi) / 2;
      if (inGamut(oklchToLinear({ ...color, c: mid }))) lo = mid;
      else hi = mid;
    }
    c = lo;
  }
  const rgb = oklchToLinear({ ...color, c }).map((v) => Math.min(255, Math.max(0, Math.round(fromLinear(Math.min(1, Math.max(0, v)))))));
  return `#${rgb.map((v) => v.toString(16).padStart(2, '0')).join('')}`;
}

/* ---------- La regla ---------- */

export const ACCENT_ON = '#ffffff';
/** Contraste mínimo del texto sobre el botón (WCAG AA texto normal) con un margen de redondeo. */
export const TEXT_CONTRAST = 4.6;
/** Por encima de esta luz (OKLCH) un color es "claro": se queda claro y lleva tinta. Solo el amarillo de Notes. */
const LIGHT_COLOR = 0.78;
/** Cuánto sube la luz en modo oscuro, como máximo (y nunca más allá de donde el blanco se lee). */
const DARK_LIFT = 0.06;
/** Luz mínima del relleno en modo oscuro, para que no se pierda sobre el fondo. */
const DARK_FLOOR = 0.48;
/** Cuánto baja la luz al pasar el mouse y al apretar. En los claros, menos: un amarillo que baja mucho se vuelve mostaza. */
const STEPS = { strong: { hover: 0.05, active: 0.09 }, light: { hover: 0.03, active: 0.06 } };

export interface ButtonTone {
  bg: string;
  on: string;
  hover: string;
  active: string;
}

export interface AppButtonColors {
  light: ButtonTone;
  dark: ButtonTone;
}

/** La luz más alta (con ese croma y tono) en la que el blanco llega a TEXT_CONTRAST. */
function maxLightForWhite(c: number, h: number): number {
  let lo = 0;
  let hi = 1;
  for (let i = 0; i < 30; i++) {
    const mid = (lo + hi) / 2;
    if (contrast(oklchToHex({ l: mid, c, h }), ACCENT_ON) >= TEXT_CONTRAST) lo = mid;
    else hi = mid;
  }
  return lo;
}

function toneFor(l: number, c: number, h: number, on: string, steps: { hover: number; active: number }): ButtonTone {
  return {
    bg: oklchToHex({ l, c, h }),
    on,
    hover: oklchToHex({ l: l - steps.hover, c, h }),
    active: oklchToHex({ l: l - steps.active, c, h }),
  };
}

/**
 * Rellenos y texto del botón primario para el color de una app, en modo claro
 * y oscuro. null si el color no es un hex válido.
 */
export function appButtonColors(color: string | null | undefined): AppButtonColors | null {
  const base = color ? hexToOklch(color) : null;
  if (!base) return null;
  const { l, c, h } = base;

  if (l >= LIGHT_COLOR) {
    // Claro: el relleno se queda y el texto es tinta del mismo tono. Al pasar el mouse baja un poco de luz.
    const ink = oklchToHex({ l: 0.27, c: Math.min(c, 0.05), h });
    const light = toneFor(l, c, h, ink, STEPS.light);
    return { light, dark: light };
  }

  const cap = maxLightForWhite(c, h);
  const lightL = Math.min(l, cap);
  const darkL = Math.min(cap, Math.max(lightL + DARK_LIFT, DARK_FLOOR));
  return { light: toneFor(lightL, c, h, ACCENT_ON, STEPS.strong), dark: toneFor(darkL, c, h, ACCENT_ON, STEPS.strong) };
}
