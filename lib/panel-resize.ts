/**
 * Cuentas de un divisor que cambia el ancho de un panel lateral (arrastre y
 * teclado). Sin DOM: lo usa components/ui/PanelSplitter.tsx y se prueba en
 * tests/unit/panel-resize.test.ts.
 */

/** De qué lado del divisor está el panel que cambia de ancho. */
export type PanelSide = 'start' | 'end';

export const PANEL_STEP = 16;
export const PANEL_BIG_STEP = 64;

/** Ancho entero dentro de [min, max]. Si no entra (max < min), gana el mínimo. */
export function clampWidth(value: number, min: number, max: number): number {
  const v = Number.isFinite(value) ? Math.round(value) : min;
  return Math.max(min, Math.min(Math.max(min, max), v));
}

/** Máximo real de un panel: su tope propio o lo que deja libre el resto, sin bajar del mínimo. */
export function panelMax(container: number, reserved: number, min: number, hardMax: number): number {
  return Math.max(min, Math.min(hardMax, Math.floor(container - reserved)));
}

/** Ancho al arrastrar `deltaX` px desde `start`. Un panel a la derecha crece cuando el divisor va a la izquierda. */
export function dragWidth(start: number, deltaX: number, side: PanelSide, min: number, max: number): number {
  return clampWidth(start + (side === 'start' ? deltaX : -deltaX), min, max);
}

export type KeyResize = { type: 'set'; value: number } | { type: 'reset' } | null;

/**
 * Teclado del divisor: flechas (Shift da pasos grandes), Inicio y Fin van al
 * mínimo y al máximo, Enter vuelve al ancho por defecto. Otra tecla: null.
 */
export function resizeByKey(key: string, opts: { shift?: boolean; value: number; min: number; max: number; side: PanelSide }): KeyResize {
  const { value, min, max, side } = opts;
  const step = opts.shift ? PANEL_BIG_STEP : PANEL_STEP;
  const grow = side === 'start' ? 'ArrowRight' : 'ArrowLeft';
  const shrink = side === 'start' ? 'ArrowLeft' : 'ArrowRight';
  if (key === grow) return { type: 'set', value: clampWidth(value + step, min, max) };
  if (key === shrink) return { type: 'set', value: clampWidth(value - step, min, max) };
  if (key === 'Home') return { type: 'set', value: clampWidth(min, min, max) };
  if (key === 'End') return { type: 'set', value: clampWidth(max, min, max) };
  if (key === 'Enter') return { type: 'reset' };
  return null;
}
