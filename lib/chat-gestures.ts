/**
 * Cuentas de los gestos sobre una fila de chat (Lines e Inbox): deslizar a
 * los costados como WhatsApp y levantar la conversación para soltarla en una
 * carpeta. Todo puro (sin DOM): la capa de components/ui/chat-gestures.tsx
 * lee el puntero y aplica lo que sale de acá.
 */

/** Recorrido (px) antes de decidir si el gesto es horizontal o vertical. */
export const SWIPE_SLOP = 8;
/** Tiempo quieto (ms) para levantar la conversación. */
export const HOLD_MS = 300;
/** Movimiento (px) que rompe la espera del toque largo. */
export const HOLD_SLOP = 6;
/** Ancho (px) de cada acción cuando la fila queda abierta. */
export const ACTION_WIDTH = 76;
/** Parte del ancho de la fila que hay que pasar para que el deslizado ejecute la acción principal. */
export const COMMIT_RATIO = 0.6;
/** Tiempo (ms) sobre una carpeta plegada antes de abrirla. */
export const EXPAND_MS = 600;
/** Franja (px) cerca del borde de una lista donde el arrastre la hace correr, y el tope de px por cuadro. */
export const SCROLL_EDGE = 48;
export const SCROLL_MAX = 16;
/** Máximo de chats que viajan juntos. */
export const MAX_DRAG = 500;

export type Axis = 'x' | 'y' | null;
export type SwipeSide = 'left' | 'right';
export interface Rect {
  left: number;
  top: number;
  right: number;
  bottom: number;
}

/** Eje del gesto: nada hasta pasar el umbral; después gana el que más se movió (en el empate, vertical: es scroll). */
export function lockAxis(dx: number, dy: number, slop = SWIPE_SLOP): Axis {
  const ax = Math.abs(dx);
  const ay = Math.abs(dy);
  if (ax < slop && ay < slop) return null;
  return ax > ay ? 'x' : 'y';
}

/** ¿El dedo se movió lo bastante como para que ya no sea un toque largo? */
export function holdBroken(dx: number, dy: number, slop = HOLD_SLOP): boolean {
  return Math.hypot(dx, dy) > slop;
}

/** Resistencia de goma: cuanto más se estira, menos avanza; nunca pasa de `limit`. */
export function rubberBand(over: number, limit: number): number {
  if (over <= 0 || limit <= 0) return 0;
  return (1 - 1 / ((over * 0.55) / limit + 1)) * limit;
}

/**
 * Corrimiento de la fila para un arrastre de `raw` px. Hacia un lado con
 * acciones sigue al dedo hasta el ancho de la fila; hacia un lado sin
 * acciones solo cede un poco (goma).
 */
export function swipeOffset(raw: number, o: { width: number; left: number; right: number }): number {
  if (raw === 0) return 0;
  const sign = raw < 0 ? -1 : 1;
  const count = raw < 0 ? o.left : o.right;
  const dist = Math.abs(raw);
  if (count <= 0) return sign * rubberBand(dist, 40);
  return sign * Math.min(dist, Math.max(o.width, 0));
}

/** Ancho con las acciones abiertas. */
export function openWidth(count: number, width: number): number {
  return Math.min(count * ACTION_WIDTH, Math.max(width - 56, 0));
}

/** Corrimiento desde el que soltar ejecuta la acción principal. */
export function commitAt(width: number, count: number): number {
  return Math.max(openWidth(count, width) + 48, width * COMMIT_RATIO);
}

export type SwipeEnd = 'commit' | 'open' | 'close';

/**
 * Qué pasa al soltar: pasado el umbral se ejecuta la acción principal; a
 * mitad de camino (o con un envión hacia afuera) las acciones quedan
 * abiertas; si no, la fila vuelve. `velocity` en px/ms, con el signo del eje.
 */
export function swipeRelease(o: { x: number; width: number; count: number; velocity?: number }): SwipeEnd {
  const dist = Math.abs(o.x);
  if (o.count <= 0 || dist === 0) return 'close';
  if (dist >= commitAt(o.width, o.count)) return 'commit';
  const outward = (o.velocity ?? 0) * (o.x < 0 ? -1 : 1);
  if (outward < -0.3) return 'close';
  if (outward > 0.5 && dist > 24) return 'open';
  return dist >= openWidth(o.count, o.width) / 2 ? 'open' : 'close';
}

/** ¿El puntero salió de la lista? Un deslizado con el mouse que se va de la lista pasa a ser un arrastre. */
export function escapedList(p: { x: number; y: number }, list: Rect, margin = 12): boolean {
  return p.x < list.left - margin || p.x > list.right + margin || p.y < list.top - margin || p.y > list.bottom + margin;
}

/**
 * Dónde va la ficha que sigue al puntero: abajo a la derecha, para no tapar
 * lo que hay debajo. Con el dedo va arriba (la mano tapa lo de abajo). Cerca
 * de un borde de la pantalla pasa al otro lado.
 */
export function chipPosition(o: { x: number; y: number; w: number; h: number; vw: number; vh: number; touch?: boolean }): { left: number; top: number } {
  const gapX = 14;
  const gapY = o.touch ? 28 : 18;
  let left = o.x + gapX;
  if (left + o.w > o.vw - 8) left = o.x - gapX - o.w;
  let top = o.touch ? o.y - gapY - o.h : o.y + gapY;
  if (top + o.h > o.vh - 8) top = o.y - gapY - o.h;
  if (top < 8) top = o.y + gapY;
  return {
    left: Math.round(Math.min(Math.max(left, 8), Math.max(o.vw - o.w - 8, 8))),
    top: Math.round(Math.min(Math.max(top, 8), Math.max(o.vh - o.h - 8, 8))),
  };
}

/**
 * Px por cuadro que corre una lista cuando el puntero está cerca de su borde
 * de arriba (negativo) o de abajo (positivo). Más cerca del borde, más
 * rápido. Lejos del borde, o fuera de la franja, 0.
 */
export function autoScrollSpeed(y: number, top: number, bottom: number, edge = SCROLL_EDGE, max = SCROLL_MAX): number {
  const size = bottom - top;
  if (size <= 0) return 0;
  const zone = Math.min(edge, size / 3);
  if (y < top - zone || y > bottom + zone) return 0;
  const ease = (d: number) => {
    const k = Math.min(Math.max(1 - d / zone, 0), 1);
    return Math.max(1, Math.round(max * k * k));
  };
  if (y < top + zone) return -ease(Math.max(y - top, 0));
  if (y > bottom - zone) return ease(Math.max(bottom - y, 0));
  return 0;
}

/** Los chats que viajan al levantar uno: la selección entera si está adentro (en el orden de la lista); si no, solo ese. */
export function dragIds(id: string, selected: ReadonlySet<string>, order: readonly string[] = []): string[] {
  if (!selected.has(id) || selected.size < 2) return [id];
  const listed = order.filter((x) => selected.has(x));
  const rest = [...selected].filter((x) => !listed.includes(x));
  return [...listed, ...rest].slice(0, MAX_DRAG);
}

export type TrayPlacement = { mode: 'side'; left: number; top: number } | { mode: 'bottom' };

/**
 * Dónde se acopla la bandeja de carpetas cuando el sidebar no está a la
 * vista: pegada a la lista si hay lugar al costado (primero a la derecha);
 * si no (teléfono), abajo.
 */
export function trayPlacement(list: Rect, vw: number, trayWidth = 264, gap = 12): TrayPlacement {
  const top = Math.max(Math.round(list.top) + 8, 8);
  if (vw - list.right >= trayWidth + gap * 2) return { mode: 'side', left: Math.round(list.right) + gap, top };
  if (list.left >= trayWidth + gap * 2) return { mode: 'side', left: Math.round(list.left) - gap - trayWidth, top };
  return { mode: 'bottom' };
}
