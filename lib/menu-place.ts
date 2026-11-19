import { MENU_MARGIN, placeMenu } from './context-menu';

/**
 * Dónde va un menú fijo: pegado a un botón (la flecha de un mensaje, el ⋯) o
 * en el puntero (clic derecho, como WhatsApp y los menús del sistema). Siempre
 * entero dentro de la ventana, con 8 px de margen; si es más alto que la
 * ventana, se achica (`maxHeight`) y la lista se corre por dentro.
 */
export interface Box {
  top: number;
  bottom: number;
  left: number;
  right: number;
}

export interface MenuSpot {
  top: number;
  left: number;
  maxHeight: number;
}

const EDGE = MENU_MARGIN;
const GAP = 2;

/**
 * Junto a un botón: debajo si entra entero; si no, arriba si entra; si no
 * entra de ningún lado, corrido lo justo para quedar entero (tapa el botón,
 * pero se ve cada ítem). Alineado al borde derecho del botón (`align`
 * 'right', por defecto) o al izquierdo.
 */
export function menuPlaceNear(
  btn: Box,
  width: number,
  height: number,
  viewW: number,
  viewH: number,
  opts: { align?: 'left' | 'right'; gap?: number } = {},
): MenuSpot {
  const gap = opts.gap ?? GAP;
  const maxHeight = Math.max(0, viewH - EDGE * 2);
  const h = Math.min(height, maxHeight);
  const maxLeft = Math.max(EDGE, viewW - width - EDGE);
  const left = Math.min(Math.max(opts.align === 'left' ? btn.left : btn.right - width, EDGE), maxLeft);
  const below = btn.bottom + gap;
  const above = btn.top - gap - h;
  const top = below + h <= viewH - EDGE ? below : above >= EDGE ? above : Math.min(Math.max(above, EDGE), Math.max(EDGE, viewH - h - EDGE));
  return { top: Math.round(top), left: Math.round(left), maxHeight };
}

/** Lo de siempre de los menús de un botón: debajo, alineado a su borde derecho (ver menuPlaceNear). */
export function menuPlace(btn: Box, width: number, height: number, viewW: number, viewH: number): { top: number; left: number } {
  const { top, left } = menuPlaceNear(btn, width, height, viewW, viewH);
  return { top, left };
}

/**
 * En el puntero (clic derecho o toque largo): la esquina de arriba a la
 * izquierda en el punto; si no entra a la derecha, se abre hacia la
 * izquierda; si no entra abajo, hacia arriba. Las mismas cuentas que el menú
 * contextual de las filas (lib/context-menu.ts).
 */
export function menuPlaceAt(point: { x: number; y: number }, width: number, height: number, viewW: number, viewH: number): MenuSpot {
  const { top, left, maxHeight } = placeMenu({ x: point.x, y: point.y, w: width, h: height, vw: viewW, vh: viewH });
  return { top, left, maxHeight };
}
