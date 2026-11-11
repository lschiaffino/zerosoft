'use client';

import { useEffect, type RefObject } from 'react';

/** Cuánto antes del final se pide la página que sigue. */
const AHEAD = 600;

/**
 * Listas que traen más al bajar: llama a `onNear` cuando la marca del final
 * (`mark`, la última fila de la lista) queda cerca de lo que se ve. Mira el
 * scroll además de la intersección: con un salto largo (ir al final de una
 * vez, o contenido debajo de la marca) la marca pasa de estar abajo a estar
 * arriba sin cruzar lo visible, y un IntersectionObserver solo no se entera.
 * `rev` cambia cuando cambia la lista (p. ej. la cantidad de filas), para
 * volver a mirar después de cada página.
 */
export function useNearEnd(mark: RefObject<HTMLElement | null>, active: boolean, onNear: () => void, rev: unknown): void {
  useEffect(() => {
    const el = mark.current;
    if (!el || !active) return;
    let box: HTMLElement | null = el.parentElement;
    while (box && !/(auto|scroll)/.test(getComputedStyle(box).overflowY)) box = box.parentElement;
    const check = () => {
      const limit = box ? box.getBoundingClientRect().bottom : window.innerHeight;
      if (el.getBoundingClientRect().top < limit + AHEAD) onNear();
    };
    const io = new IntersectionObserver((entries) => {
      if (entries.some((e) => e.isIntersecting)) onNear();
    }, { rootMargin: `${AHEAD}px 0px` });
    io.observe(el);
    const target: HTMLElement | Window = box ?? window;
    target.addEventListener('scroll', check, { passive: true });
    const raf = requestAnimationFrame(check);
    return () => {
      io.disconnect();
      target.removeEventListener('scroll', check);
      cancelAnimationFrame(raf);
    };
  }, [mark, active, onNear, rev]);
}
