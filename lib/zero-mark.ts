/**
 * El "0" de la marca como trazado SVG (sin depender de una fuente): un óvalo
 * geométrico de trazo parejo, con las proporciones del cero de Space Grotesk.
 * Lo usan el logo (components/zero/ZeroMark), el favicon, el apple-icon, los
 * separadores de ceros y las imágenes OG.
 */

export const ZERO_VIEWBOX = '0 0 20 24';
export const ZERO_W = 20;
export const ZERO_H = 24;

/** Anillo ovalado: exterior 17×22, interior 10.6×15.8 (regla evenodd). */
export const ZERO_PATH =
  'M10 1A8.5 11 0 1 1 10 23A8.5 11 0 1 1 10 1ZM10 4.1A5.3 7.9 0 1 0 10 19.9A5.3 7.9 0 1 0 10 4.1Z';

/** El cero como <path> posicionado (para componer SVGs a mano, p. ej. OG). */
export function zeroPathAt(x: number, y: number, height: number, fill: string, opacity = 1): string {
  const s = height / ZERO_H;
  const op = opacity < 1 ? ` opacity="${opacity.toFixed(3)}"` : '';
  return `<path transform="translate(${x.toFixed(2)} ${y.toFixed(2)}) scale(${s.toFixed(4)})" d="${ZERO_PATH}" fill="${fill}" fill-rule="evenodd"${op}/>`;
}

/** SVG completo del cero, listo para un data URI o un archivo. */
export function zeroSvg(fill = '#0d0d0d'): string {
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${ZERO_VIEWBOX}"><path d="${ZERO_PATH}" fill="${fill}" fill-rule="evenodd"/></svg>`;
}
