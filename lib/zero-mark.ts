/**
 * El "0" de la marca como trazado SVG (sin depender de una fuente): la
 * estación de la red. Un anillo circular grueso (0,44 del radio, igual que la
 * "o" del wordmark en lib/brand-mark.ts). Lo usan ZeroMark/ProductZero en
 * listas y menús y los separadores de ceros. La caja sigue siendo 20×24 para
 * no mover los layouts que ya lo usan.
 */

export const ZERO_VIEWBOX = '0 0 20 24';
export const ZERO_W = 20;
export const ZERO_H = 24;

/** Anillo: radio exterior 10, interior 5,6 (regla evenodd). */
export const ZERO_PATH =
  'M10 2A10 10 0 1 1 10 22A10 10 0 1 1 10 2ZM10 6.4A5.6 5.6 0 1 0 10 17.6A5.6 5.6 0 1 0 10 6.4Z';

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
