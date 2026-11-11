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

/** Ancho con las acciones abiertas. */
export function openWidth(count: number, width: number): number {
  return Math.min(count * ACTION_WIDTH, Math.max(width - 56, 0));
}

/** Corrimiento desde el que soltar ejecuta la acción principal. */
export function commitAt(width: number, count: number): number {
  return Math.max(openWidth(count, width) + 48, width * COMMIT_RATIO);
}

/** Envión (px/ms) que decide por sí solo al soltar. */
export const FLICK = 0.3;
/** Recorrido mínimo (px) para que un envión cuente: un temblor del dedo no abre ni cierra. */
export const FLICK_MIN = 20;
/** Parte de las acciones abiertas que hay que volver para que la fila se cierre al soltar. */
export const CLOSE_RATIO = 0.3;
/** Si el puntero quedó quieto este tiempo (ms) antes de soltar, no hay envión. */
export const FLICK_STALE_MS = 80;

export type SwipeEnd = 'commit' | 'open' | 'close';

const signOf = (side: SwipeSide) => (side === 'left' ? -1 : 1);

/**
 * Corrimiento de la fila. El lado queda fijo durante todo el gesto (el de
 * las acciones abiertas, o el del primer movimiento): hacia afuera sigue al
 * dedo hasta el ancho de la fila; de vuelta se frena en 0 y nunca pasa al
 * otro lado. Para abrir el otro lado hay que soltar y empezar de nuevo.
 */
export function swipeOffset(o: { base: number; dx: number; side: SwipeSide; width: number }): number {
  const sign = signOf(o.side);
  const out = sign * (o.base + o.dx);
  if (out <= 0) return 0;
  return sign * Math.min(out, Math.max(o.width, 0));
}

/**
 * Qué pasa al soltar. `x` es el corrimiento, `velocity` el envión en px/ms
 * con el signo del eje, `from` cómo estaba la fila al empezar.
 *
 * - Pasado el umbral, ejecuta la acción principal.
 * - Un envión manda: hacia afuera abre, de vuelta cierra (si hubo recorrido
 *   de verdad, no un temblor).
 * - Si no, cuenta la distancia, con histéresis: una fila cerrada se abre
 *   pasada la mitad de las acciones; una abierta se cierra con volver un 30%.
 */
export function swipeRelease(o: { x: number; width: number; count: number; velocity?: number; from?: 'closed' | 'open' }): SwipeEnd {
  const dist = Math.abs(o.x);
  if (o.count <= 0 || dist === 0) return 'close';
  if (dist >= commitAt(o.width, o.count)) return 'commit';
  const ow = openWidth(o.count, o.width);
  const outward = (o.velocity ?? 0) * (o.x < 0 ? -1 : 1);
  if (o.from === 'open') {
    const back = ow - dist;
    if (outward < -FLICK && back >= FLICK_MIN) return 'close';
    if (outward > FLICK) return 'open';
    return back >= ow * CLOSE_RATIO ? 'close' : 'open';
  }
  if (outward < -FLICK) return 'close';
  if (outward > FLICK && dist >= FLICK_MIN) return 'open';
  return dist >= ow / 2 ? 'open' : 'close';
}

/**
 * Un deslizado en curso, sin DOM: lo que la capa de la fila necesita para
 * pintar y decidir. `swipeStart` al apoyar, `swipeMove` en cada movimiento,
 * `swipeEnd` al soltar.
 */
export interface SwipeTrack {
  sx: number;
  sy: number;
  /** Corrimiento con el que empezó (0 cerrada, ± el ancho de las acciones si estaba abierta). */
  base: number;
  /** Lado fijo del gesto: el de las acciones abiertas, o el del primer movimiento horizontal. */
  side: SwipeSide | null;
  /** Eje decidido: null mientras no pasa el umbral. */
  axis: Axis;
  /** Corrimiento del puntero cuando se decidió el eje (para que la fila no salte). */
  ox: number;
  offset: number;
  velocity: number;
  lastX: number;
  lastT: number;
  width: number;
  counts: { left: number; right: number };
}

export function swipeCount(t: Pick<SwipeTrack, 'side' | 'counts'>): number {
  return t.side ? t.counts[t.side] : 0;
}

export function swipeStart(o: { x: number; y: number; t: number; width: number; counts: { left: number; right: number }; open?: SwipeSide | null }): SwipeTrack {
  const side = o.open && o.counts[o.open] > 0 ? o.open : null;
  const base = side ? signOf(side) * openWidth(o.counts[side], o.width) : 0;
  return { sx: o.x, sy: o.y, base, side, axis: null, ox: 0, offset: base, velocity: 0, lastX: o.x, lastT: o.t, width: o.width, counts: o.counts };
}

/**
 * Un movimiento del puntero. Hasta pasar el umbral no hay eje; al decidirlo
 * en horizontal, el lado queda fijo (si la fila estaba abierta, es el suyo
 * para cualquier dirección). Después, el corrimiento sigue al dedo sin
 * cruzar al otro lado.
 */
export function swipeMove(t: SwipeTrack, p: { x: number; y: number; t: number }): SwipeTrack {
  const n = { ...t };
  const dt = p.t - t.lastT;
  if (dt > 0) {
    n.velocity = 0.7 * ((p.x - t.lastX) / dt) + 0.3 * t.velocity;
    n.lastT = p.t;
    n.lastX = p.x;
  }
  const dx = p.x - t.sx;
  if (!n.axis) {
    const axis = lockAxis(dx, p.y - t.sy);
    if (!axis) return n;
    n.axis = axis;
    if (axis !== 'x') return n;
    n.ox = (dx < 0 ? -1 : 1) * SWIPE_SLOP;
    if (!n.side) n.side = dx < 0 ? 'left' : 'right';
  }
  if (n.axis === 'x' && n.side && swipeCount(n) > 0) n.offset = swipeOffset({ base: n.base, dx: dx - n.ox, side: n.side, width: n.width });
  return n;
}

/** Al soltar: qué hacer con la fila. `t` es el momento de soltar (sin movimiento reciente no hay envión). */
export function swipeEnd(s: SwipeTrack, t?: number): SwipeEnd {
  if (s.axis !== 'x' || !s.side) return 'close';
  const velocity = t !== undefined && t - s.lastT > FLICK_STALE_MS ? 0 : s.velocity;
  return swipeRelease({ x: s.offset, width: s.width, count: swipeCount(s), velocity, from: s.base !== 0 ? 'open' : 'closed' });
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
