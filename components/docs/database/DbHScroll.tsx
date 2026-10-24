'use client';

import { useEffect, useRef, useState, type HTMLAttributes, type ReactNode } from 'react';

/**
 * Contenedor con scroll horizontal para la tabla y el board de una base:
 * cuando lo de adentro es más ancho que la página, un degradé en el borde
 * avisa que hay más columnas (como Notion) y la barra queda visible.
 */
export default function DbHScroll({ className, children, ...rest }: HTMLAttributes<HTMLDivElement> & { children: ReactNode }) {
  const ref = useRef<HTMLDivElement | null>(null);
  const [edges, setEdges] = useState({ left: false, right: false });

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const update = () => {
      const left = el.scrollLeft > 1;
      const right = el.scrollLeft + el.clientWidth < el.scrollWidth - 1;
      setEdges((e) => (e.left === left && e.right === right ? e : { left, right }));
    };
    update();
    el.addEventListener('scroll', update, { passive: true });
    const ro = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(update) : null;
    ro?.observe(el);
    if (el.firstElementChild) ro?.observe(el.firstElementChild);
    return () => {
      el.removeEventListener('scroll', update);
      ro?.disconnect();
    };
  }, []);

  return (
    <div className="docs-db-hscroll" data-more-left={edges.left || undefined} data-more-right={edges.right || undefined}>
      <div ref={ref} className={className} {...rest}>
        {children}
      </div>
    </div>
  );
}
