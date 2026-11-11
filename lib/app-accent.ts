/**
 * Color de los botones primarios dentro de cada app: el de la app, con el
 * texto (blanco o tinta) que mejor se lee encima. Puro: lo usan el shell de
 * la app y los tests.
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

export const ACCENT_ON_LIGHT = '#ffffff';
export const ACCENT_ON_DARK = '#111111';

/**
 * Fondo y texto del botón primario para el color de una app. El texto es
 * blanco si se lee bien (4.5:1 o más); si no, tinta: un color claro como el
 * amarillo de Notes lleva texto oscuro en lugar de oscurecerse hasta dejar de
 * parecer el de la app. null si el color no es un hex válido.
 */
export function appButtonColors(color: string | null | undefined): { bg: string; on: string; hover: string } | null {
  if (!color || luminance(color) === null) return null;
  const raw = color.trim().toLowerCase();
  let rgb = parseHex(raw) as [number, number, number];
  const toHex = (c: number[]) => `#${c.map((v) => Math.round(v).toString(16).padStart(2, '0')).join('')}`;
  let hex = toHex(rgb);
  // Unos pocos tonos medios no llegan a 4.5:1 ni con blanco ni con tinta: se oscurecen apenas, hasta que el blanco se lea.
  if (contrast(hex, ACCENT_ON_LIGHT) < 4.5 && contrast(hex, ACCENT_ON_DARK) < 4.5) {
    for (let i = 0; i < 20 && contrast(hex, ACCENT_ON_LIGHT) < 4.5; i++) {
      rgb = rgb.map((v) => v * 0.97) as [number, number, number];
      hex = toHex(rgb);
    }
  }
  const on = contrast(hex, ACCENT_ON_LIGHT) >= 4.5 ? ACCENT_ON_LIGHT : ACCENT_ON_DARK;
  // Al pasar el mouse el color se aleja del texto (más oscuro con texto blanco, más claro con tinta): se lee igual o mejor.
  const shift = (v: number) => (on === ACCENT_ON_LIGHT ? v * 0.86 : v + (255 - v) * 0.14);
  const hover = toHex(rgb.map(shift));
  return { bg: hex, on, hover };
}
