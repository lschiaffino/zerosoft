'use client';

import { useCallback, useEffect, useLayoutEffect, useRef, type RefObject } from 'react';
import { anchorShift, atBottom, pickAnchor, type Anchor } from '@/lib/scroll-anchor';

/**
 * Mantiene quieta una conversación mientras se lee (lib/scroll-anchor.ts):
 * cualquier cambio de alto arriba de la pantalla se compensa; si se estaba
 * abajo de todo, sigue abajo de todo. Los mensajes son los hijos de la lista
 * con `id` que empieza con `prefix`.
 *
 * - `capture()`: anota dónde se está (va en el onScroll de la lista).
 * - `restore()`: deja la lista como estaba (después de un render).
 * - `toBottom()`: abajo de todo, y queda pegada abajo (abrir, enviar).
 * - `unstick()`: antes de ir a otro mensaje a propósito.
 */
export function useScrollAnchor(scroller: RefObject<HTMLElement | null>, deps: readonly unknown[], prefix = 'm-') {
  const anchor = useRef<Anchor | null>(null);
  const stick = useRef(true);

  const items = useCallback(
    (el: HTMLElement) => {
      const out: Array<{ id: string; top: number; bottom: number }> = [];
      for (const child of Array.from(el.querySelectorAll<HTMLElement>(`[id^="${prefix}"]`))) {
        const r = child.getBoundingClientRect();
        if (r.height === 0 && r.width === 0) continue;
        out.push({ id: child.id, top: r.top, bottom: r.bottom });
      }
      return out;
    },
    [prefix],
  );

  const capture = useCallback(() => {
    const el = scroller.current;
    // También después de una corrección propia: vuelve a anotar la misma ancla. Ignorar esos eventos
    // perdía a veces el scroll de la persona (y la lista volvía sola al final).
    if (!el) return;
    stick.current = atBottom(el);
    anchor.current = pickAnchor(items(el), el.getBoundingClientRect().top);
  }, [scroller, items]);

  const set = (el: HTMLElement, top: number) => {
    el.scrollTop = top;
  };

  const restore = useCallback(() => {
    const el = scroller.current;
    if (!el) return;
    if (stick.current) {
      if (el.scrollTop + el.clientHeight < el.scrollHeight - 1) set(el, el.scrollHeight);
      return;
    }
    const a = anchor.current;
    if (!a) return;
    const node = el.querySelector<HTMLElement>(`#${CSS.escape(a.id)}`);
    if (!node) {
      capture();
      return;
    }
    const shift = anchorShift(a, node.getBoundingClientRect().top - el.getBoundingClientRect().top);
    if (shift) set(el, el.scrollTop + shift);
  }, [scroller, capture]);

  const toBottom = useCallback(() => {
    const el = scroller.current;
    stick.current = true;
    if (el) set(el, el.scrollHeight);
  }, [scroller]);

  // Después de cada render con mensajes nuevos o cambiados.
  useLayoutEffect(() => {
    restore();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);

  // Fotos que terminan de cargar, el composer que crece, la ventana que cambia de tamaño: lo mismo.
  useEffect(() => {
    const el = scroller.current;
    if (!el || typeof ResizeObserver === 'undefined') return;
    const ro = new ResizeObserver(() => restore());
    ro.observe(el);
    for (const child of Array.from(el.children)) ro.observe(child);
    return () => ro.disconnect();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [restore, ...deps]);

  /** Se va a mover a otro lado a propósito (ir a un mensaje citado o buscado): deja de seguir el final. */
  const unstick = useCallback(() => {
    stick.current = false;
  }, []);

  return { capture, restore, toBottom, unstick };
}
