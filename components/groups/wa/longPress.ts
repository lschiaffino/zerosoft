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
  let touchAt = 0;
  const cancel = () => {
    if (timer) clearTimeout(timer);
    timer = null;
    start = null;
  };
  const fire = (el: HTMLElement) => {
    if (timer) clearTimeout(timer);
    timer = null;
    if (fired) return;
    fired = true;
    try {
      navigator.vibrate?.(12);
    } catch {
      // Sin vibración: igual abre.
    }
    onLong(el);
  };
  return {
    onPointerDown: (e: ReactPointerEvent<HTMLElement>) => {
      if (e.pointerType !== 'touch') return;
      fired = false;
      start = { x: e.clientX, y: e.clientY };
      const el = e.currentTarget;
      timer = setTimeout(() => fire(el), ms);
    },
    onPointerMove: (e: ReactPointerEvent<HTMLElement>) => {
      if (start && Math.hypot(e.clientX - start.x, e.clientY - start.y) > 10) cancel();
    },
    onPointerUp: (e: ReactPointerEvent<HTMLElement>) => {
      if (e.pointerType === 'touch') touchAt = Date.now();
      cancel();
    },
    onPointerCancel: cancel,
    // Android manda un clic derecho con el toque largo: es el mismo toque largo (una sola vez), no el clic derecho del escritorio.
    onContextMenuCapture: (e: ReactMouseEvent<HTMLElement>) => {
      const native = e.nativeEvent as MouseEvent & { pointerType?: string };
      if (native.pointerType !== 'touch' && !start && Date.now() - touchAt > 800) return;
      e.preventDefault();
      e.stopPropagation();
      if (start && !fired) fire(e.currentTarget);
    },
    onClickCapture: (e: ReactMouseEvent<HTMLElement>) => {
      if (fired) {
        e.preventDefault();
        e.stopPropagation();
        fired = false;
      }
    },
  };
}
