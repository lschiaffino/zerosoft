'use client';

import type { MouseEvent as ReactMouseEvent, PointerEvent as ReactPointerEvent } from 'react';

/**
 * Gestos de WhatsApp sobre un mensaje, en el teléfono. Solo con el dedo (con
 * el mouse no hacen nada); el movimiento vertical es scroll y cancela. Los
 * de la fila de la lista (deslizar, levantar) están en
 * components/ui/chat-gestures.tsx. El estado del
 * gesto vive en el elemento (no en el render): la lista o el chat pueden
 * volver a dibujarse en medio del gesto sin cortarlo.
 */
interface Gesture {
  start: { x: number; y: number } | null;
  swiping: boolean;
  dx: number;
  fired: boolean;
  timer: ReturnType<typeof setTimeout> | null;
}

const states = new WeakMap<object, Gesture>();

function stateOf(el: object): Gesture {
  let s = states.get(el);
  if (!s) {
    s = { start: null, swiping: false, dx: 0, fired: false, timer: null };
    states.set(el, s);
  }
  return s;
}

function clearHold(s: Gesture) {
  if (s.timer) clearTimeout(s.timer);
  s.timer = null;
}

function buzz(ms: number) {
  try {
    navigator.vibrate?.(ms);
  } catch {
    // Sin vibración.
  }
}

function settle(el: HTMLElement, attrs: string[]) {
  el.style.transition = 'transform 0.18s ease-out';
  el.style.transform = '';
  setTimeout(() => {
    el.style.transition = '';
  }, 200);
  for (const a of attrs) el.removeAttribute(a);
}

const swallowClick = (e: ReactMouseEvent<HTMLElement>) => {
  const s = stateOf(e.currentTarget);
  if (s.fired) {
    e.preventDefault();
    e.stopPropagation();
    s.fired = false;
  }
};

/** Cuánto hay que deslizar para que cuente (px) y el tope del arrastre. */
export const SWIPE_TRIGGER = 56;
const SWIPE_MAX = 84;

/**
 * Sobre un mensaje: deslizar a la derecha (responder) y toque largo (el
 * menú). La burbuja se corre con el dedo y vuelve sola.
 */
export function swipeAndHold(opts: { onSwipe?: () => void; onHold?: (el: HTMLElement) => void; holdMs?: number }) {
  return {
    onPointerDown: (e: ReactPointerEvent<HTMLElement>) => {
      if (e.pointerType !== 'touch') return;
      const el = e.currentTarget;
      const s = stateOf(el);
      clearHold(s);
      s.start = { x: e.clientX, y: e.clientY };
      s.swiping = false;
      s.fired = false;
      s.dx = 0;
      if (opts.onHold) {
        s.timer = setTimeout(() => {
          s.fired = true;
          buzz(12);
          opts.onHold?.(el);
        }, opts.holdMs ?? 450);
      }
    },
    onPointerMove: (e: ReactPointerEvent<HTMLElement>) => {
      const el = e.currentTarget;
      const s = stateOf(el);
      if (!s.start) return;
      const mx = e.clientX - s.start.x;
      const my = e.clientY - s.start.y;
      if (!s.swiping) {
        if (Math.abs(my) > 10 && Math.abs(my) > Math.abs(mx)) {
          clearHold(s);
          s.start = null;
          return;
        }
        if (mx > 10 && opts.onSwipe) {
          s.swiping = true;
          clearHold(s);
        } else if (Math.abs(mx) > 10) clearHold(s);
      }
      if (s.swiping) {
        s.dx = Math.max(0, Math.min(mx, SWIPE_MAX));
        el.style.transform = `translateX(${s.dx}px)`;
        el.setAttribute('data-swipe', s.dx >= SWIPE_TRIGGER ? 'ready' : 'moving');
      }
    },
    onPointerUp: (e: ReactPointerEvent<HTMLElement>) => {
      const el = e.currentTarget;
      const s = stateOf(el);
      clearHold(s);
      if (s.swiping) {
        if (s.dx >= SWIPE_TRIGGER) {
          s.fired = true;
          buzz(8);
          opts.onSwipe?.();
        }
        settle(el, ['data-swipe']);
      }
      s.swiping = false;
      s.start = null;
    },
    onPointerCancel: (e: ReactPointerEvent<HTMLElement>) => {
      const el = e.currentTarget;
      const s = stateOf(el);
      clearHold(s);
      if (s.swiping) settle(el, ['data-swipe']);
      s.swiping = false;
      s.start = null;
    },
    onClickCapture: swallowClick,
  };
}
