/**
 * Track — colores seguros para estilos inline. Sin dependencias de servidor:
 * lo usan tanto lib/ como los componentes cliente.
 */

const HEX_COLOR = /^#(?:[0-9a-f]{3}|[0-9a-f]{6})$/i;

export function isHexColor(color: unknown): color is string {
  return typeof color === 'string' && HEX_COLOR.test(color.trim());
}

/**
 * Devuelve el color si es hex (#rgb o #rrggbb) y si no el fallback. Cualquier
 * otra cosa (p. ej. `url(...)`, que el navegador cargaría al pintar el fondo)
 * se descarta.
 */
export function safeHexColor(color: string | null | undefined, fallback: string): string {
  return isHexColor(color) ? color.trim() : fallback;
}

/**
 * Color de un glifo que tiene que verse en claro y en oscuro: los grises casi
 * negros o casi blancos (p. ej. el "Todo" por defecto) pasan a la tinta del
 * tema; el resto queda igual.
 */
export function glyphColor(color: string | null | undefined, fallback = '#767676'): string {
  const hex = safeHexColor(color, fallback).replace('#', '');
  const full = hex.length === 3 ? hex.split('').map((c) => c + c).join('') : hex;
  const r = parseInt(full.slice(0, 2), 16);
  const g = parseInt(full.slice(2, 4), 16);
  const b = parseInt(full.slice(4, 6), 16);
  const luma = (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255;
  const spread = Math.max(r, g, b) - Math.min(r, g, b);
  if (spread < 24 && (luma < 0.22 || luma > 0.85)) return 'var(--ink)';
  return `#${full}`;
}
