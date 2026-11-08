'use client';

import type { MouseEvent as ReactMouseEvent, PointerEvent as ReactPointerEvent } from 'react';

/**
 * Toque largo (≈450 ms) en pantallas táctiles: abre el menú del mensaje o de
 * la fila, como WhatsApp en el teléfono. Con un poco de movimiento se cancela
 * (es scroll). Vibra apenas si el dispositivo lo deja, y el clic que sigue al
 * soltar no navega.
 */
export function longPress(onLong: (el: HTMLElement) => void, ms = 450) {
  let timer: ReturnType<typeof setTimeout> | null = null;
  let start: { x: number; y: number } | null = null;
  let fired = false;
  const cancel = () => {
    if (timer) clearTimeout(timer);
    timer = null;
    start = null;
  };
  return {
    onPointerDown: (e: ReactPointerEvent<HTMLElement>) => {
      if (e.pointerType !== 'touch') return;
      fired = false;
      start = { x: e.clientX, y: e.clientY };
      const el = e.currentTarget;
      timer = setTimeout(() => {
        fired = true;
        try {
          navigator.vibrate?.(12);
        } catch {
          // Sin vibración: igual abre.
        }
        onLong(el);
      }, ms);
    },
    onPointerMove: (e: ReactPointerEvent<HTMLElement>) => {
      if (start && Math.hypot(e.clientX - start.x, e.clientY - start.y) > 10) cancel();
    },
    onPointerUp: cancel,
    onPointerCancel: cancel,
    onClickCapture: (e: ReactMouseEvent<HTMLElement>) => {
      if (fired) {
        e.preventDefault();
        e.stopPropagation();
        fired = false;
      }
    },
  };
}
