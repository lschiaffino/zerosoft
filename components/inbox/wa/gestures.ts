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
  /** Cuándo levantó el dedo por última vez (el clic derecho que Android manda con el toque largo llega cerca). */
  touchAt: number;
}

const states = new WeakMap<object, Gesture>();

function stateOf(el: object): Gesture {
  let s = states.get(el);
  if (!s) {
    s = { start: null, swiping: false, dx: 0, fired: false, timer: null, touchAt: 0 };
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
 * Sobre un mensaje: deslizar a la derecha (responder) y toque largo (el menú, o elegirlo). La burbuja se corre
 * con el dedo y vuelve sola. Moverse más de 10 px antes de tiempo cancela el toque largo (es scroll o un
 * deslizar). Android además manda un clic derecho (contextmenu) con el toque largo: se usa como el mismo toque
 * largo, nunca dos veces, y no llega al clic derecho del escritorio. El clic que sigue a soltar no abre lo que
 * estaba debajo (un link, una foto, el reproductor).
 */
export function swipeAndHold(opts: { onSwipe?: () => void; onHold?: (el: HTMLElement) => void; holdMs?: number }) {
  const fire = (el: HTMLElement, s: Gesture) => {
    clearHold(s);
    if (s.fired || s.swiping) return;
    s.fired = true;
    buzz(12);
    opts.onHold?.(el);
  };
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
      if (opts.onHold) s.timer = setTimeout(() => fire(el, s), opts.holdMs ?? 450);
    },
    onPointerMove: (e: ReactPointerEvent<HTMLElement>) => {
      const el = e.currentTarget;
      const s = stateOf(el);
      if (!s.start || s.fired) return;
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
        const was = el.getAttribute('data-swipe');
        const now = s.dx >= SWIPE_TRIGGER ? 'ready' : 'moving';
        if (now === 'ready' && was !== 'ready') buzz(6);
        el.setAttribute('data-swipe', now);
      }
    },
    onPointerUp: (e: ReactPointerEvent<HTMLElement>) => {
      const el = e.currentTarget;
      const s = stateOf(el);
      clearHold(s);
      if (e.pointerType === 'touch') s.touchAt = Date.now();
      if (s.swiping) {
        if (s.dx >= SWIPE_TRIGGER) {
          s.fired = true;
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
    onContextMenuCapture: (e: ReactMouseEvent<HTMLElement>) => {
      const s = stateOf(e.currentTarget);
      const native = e.nativeEvent as MouseEvent & { pointerType?: string };
      const touch = native.pointerType === 'touch' || s.start !== null || Date.now() - s.touchAt < 800;
      if (!touch) return;
      e.preventDefault();
      e.stopPropagation();
      if (s.start && !s.swiping) fire(e.currentTarget, s);
    },
    onClickCapture: swallowClick,
  };
}
