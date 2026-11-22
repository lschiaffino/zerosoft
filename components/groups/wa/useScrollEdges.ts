'use client';

import { useCallback, useRef } from 'react';

/**
 * Fila que se desliza de costado (las pestañas de filtro de Lines e Inbox):
 * marca en el elemento `data-more-left` / `data-more-right` cuando hay más
 * para ver de ese lado, y el CSS esfuma ese borde. Así una pestaña cortada
 * se lee como "hay más" y no como texto roto. Sin estado de React: escribe
 * los atributos directo (no vuelve a dibujar la lista).
 */
export function edgesOf(el: { scrollLeft: number; clientWidth: number; scrollWidth: number }): { left: boolean; right: boolean } {
  const left = Math.abs(el.scrollLeft) > 1;
  const right = Math.abs(el.scrollLeft) + el.clientWidth < el.scrollWidth - 1;
  return { left, right };
}

export function useScrollEdges<T extends HTMLElement>(): (el: T | null) => void {
  const cleanup = useRef<(() => void) | null>(null);
  return useCallback((el: T | null) => {
    cleanup.current?.();
    cleanup.current = null;
    if (!el) return;
    const update = () => {
      const { left, right } = edgesOf(el);
      el.toggleAttribute('data-more-left', left);
      el.toggleAttribute('data-more-right', right);
    };
    update();
    el.addEventListener('scroll', update, { passive: true });
    const ro = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(update) : null;
    ro?.observe(el);
    cleanup.current = () => {
      el.removeEventListener('scroll', update);
      ro?.disconnect();
    };
  }, []);
}
