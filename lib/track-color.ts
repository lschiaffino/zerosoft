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

/**
 * Colores de estado como Linear, por categoría: backlog y por hacer en gris,
 * en curso en amarillo, terminado en violeta y cancelado en gris. Son los
 * defaults al crear estados y la paleta del workflow.
 */
export const STATUS_CATEGORY_COLORS: Record<string, string> = {
  backlog: '#8a8f98',
  todo: '#8a8f98',
  in_progress: '#e5a800',
  done: '#5e6ad2',
  cancelled: '#8a8f98',
};

/** Paleta del selector de color del workflow (la de Linear, con contraste en claro y oscuro). */
export const STATUS_PALETTE = ['#8a8f98', '#e5a800', '#5e6ad2', '#4cb782', '#eb5757', '#f2994a', '#26b5ce', '#bb87fc'];

// Los defaults viejos de Track (negro y grises): se pintan con el color de la categoría.
const LEGACY_DEFAULTS = new Set(['#000', '#000000', '#666666', '#999999']);

/**
 * Color del glifo de un estado: el del estado si se eligió uno, y si es el
 * default viejo (o falta), el de su categoría. Así los estados existentes se
 * ven con los colores de Linear sin tocar los datos.
 */
export function statusGlyphColor(color: string | null | undefined, category: string | null | undefined): string {
  const c = (color ?? '').trim().toLowerCase();
  if (!c || LEGACY_DEFAULTS.has(c)) return STATUS_CATEGORY_COLORS[category ?? ''] ?? glyphColor(color);
  return glyphColor(color);
}
