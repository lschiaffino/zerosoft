'use client';

import { useEffect, useRef, useState, type ReactNode } from 'react';

/**
 * Contenedor de las tablas de los listados: si las columnas no entran, la
 * tabla se desplaza de costado adentro (nunca la página) y el borde que tiene
 * más columnas detrás se marca con una sombra, así ninguna columna parece
 * cortada a la mitad.
 */
export default function TableScroll({ children }: { children: ReactNode }) {
  const ref = useRef<HTMLDivElement>(null);
  const [edges, setEdges] = useState({ left: false, right: false });

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const update = () => {
      const max = el.scrollWidth - el.clientWidth;
      const left = el.scrollLeft > 1;
      const right = max - el.scrollLeft > 1;
      setEdges((prev) => (prev.left === left && prev.right === right ? prev : { left, right }));
    };
    update();
    el.addEventListener('scroll', update, { passive: true });
    const ro = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(update) : null;
    ro?.observe(el);
    const table = el.querySelector('table');
    if (table) ro?.observe(table);
    return () => {
      el.removeEventListener('scroll', update);
      ro?.disconnect();
    };
  }, []);

  return (
    <div className="table-scroll" data-more-left={edges.left ? 'true' : undefined} data-more-right={edges.right ? 'true' : undefined}>
      <div className="table-wrap" ref={ref} data-testid="table-scroll">
        {children}
      </div>
    </div>
  );
}
