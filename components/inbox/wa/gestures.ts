'use client';

import type { MouseEvent as ReactMouseEvent, PointerEvent as ReactPointerEvent } from 'react';

/** Cuánto hay que deslizar para que cuente (px) y el tope del arrastre. */
export const SWIPE_TRIGGER = 56;
const SWIPE_MAX = 84;

/**
 * Gestos de WhatsApp en el teléfono sobre un elemento: deslizar a la
 * derecha (responder un mensaje) y toque largo (el menú). Solo con el dedo:
 * con el mouse no hace nada. El movimiento vertical es scroll y cancela.
 * El elemento se corre con el dedo (transform) y vuelve solo.
 */
export function swipeAndHold(opts: { onSwipe?: () => void; onHold?: (el: HTMLElement) => void; direction?: 'right' | 'left'; holdMs?: number }) {
  const dir = opts.direction === 'left' ? -1 : 1;
  let start: { x: number; y: number } | null = null;
  let timer: ReturnType<typeof setTimeout> | null = null;
  let swiping = false;
  let dx = 0;
  let fired = false;
  const clearHold = () => {
    if (timer) clearTimeout(timer);
    timer = null;
  };
  const reset = (el: HTMLElement) => {
    el.style.transition = 'transform 0.18s ease-out';
    el.style.transform = '';
    el.removeAttribute('data-swipe');
    setTimeout(() => {
      el.style.transition = '';
    }, 200);
  };
  return {
    onPointerDown: (e: ReactPointerEvent<HTMLElement>) => {
      if (e.pointerType !== 'touch') return;
      start = { x: e.clientX, y: e.clientY };
      swiping = false;
      fired = false;
      dx = 0;
      const el = e.currentTarget;
      if (opts.onHold) {
        timer = setTimeout(() => {
          fired = true;
          try {
            navigator.vibrate?.(12);
          } catch {
            // Sin vibración: igual abre.
          }
          opts.onHold?.(el);
        }, opts.holdMs ?? 450);
      }
    },
    onPointerMove: (e: ReactPointerEvent<HTMLElement>) => {
      if (!start) return;
      const mx = (e.clientX - start.x) * dir;
      const my = e.clientY - start.y;
      if (!swiping) {
        if (Math.abs(my) > 10 && Math.abs(my) > Math.abs(mx)) {
          clearHold();
          start = null;
          return;
        }
        if (mx > 10 && opts.onSwipe) {
          swiping = true;
          clearHold();
        } else if (Math.abs(mx) > 10) clearHold();
      }
      if (swiping) {
        dx = Math.max(0, Math.min(mx, SWIPE_MAX));
        const el = e.currentTarget;
        el.style.transform = `translateX(${dx * dir}px)`;
        el.setAttribute('data-swipe', dx >= SWIPE_TRIGGER ? 'ready' : 'moving');
      }
    },
    onPointerUp: (e: ReactPointerEvent<HTMLElement>) => {
      clearHold();
      if (swiping) {
        if (dx >= SWIPE_TRIGGER) {
          fired = true;
          try {
            navigator.vibrate?.(8);
          } catch {
            // Sin vibración.
          }
          opts.onSwipe?.();
        }
        reset(e.currentTarget);
      }
      swiping = false;
      start = null;
    },
    onPointerCancel: (e: ReactPointerEvent<HTMLElement>) => {
      clearHold();
      if (swiping) reset(e.currentTarget);
      swiping = false;
      start = null;
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
