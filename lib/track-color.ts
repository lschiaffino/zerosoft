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
