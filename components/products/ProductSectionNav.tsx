'use client';

import { useEffect, useState, type CSSProperties } from 'react';
import type { ProductKey } from '@/lib/products';

export interface SectionLink {
  /** id de la sección a la que lleva el link. */
  id: string;
  label: string;
}

/**
 * Índice de secciones de la página de producto: una fila fija de links. El de
 * la sección que se está leyendo se subraya en el color del producto
 * (aria-current="location").
 */
export default function ProductSectionNav({ product, sections, label }: { product: ProductKey; sections: SectionLink[]; label: string }) {
  const [current, setCurrent] = useState<string | null>(null);

  useEffect(() => {
    let frame = 0;
    const update = () => {
      frame = 0;
      const doc = document.documentElement;
      const atBottom = window.scrollY + window.innerHeight >= doc.scrollHeight - 2;
      // La sección actual es la última cuyo cartel ya pasó la altura de lectura
      // (debajo del header y del índice). Al final de la página, la última que se ve.
      const readAt = atBottom ? window.innerHeight - 1 : 160;
      let next: string | null = null;
      for (const s of sections) {
        const el = document.getElementById(s.id);
        if (el && el.getBoundingClientRect().top <= readAt) next = s.id;
      }
      setCurrent(next);
    };
    const onScroll = () => {
      if (!frame) frame = requestAnimationFrame(update);
    };
    update();
    window.addEventListener('scroll', onScroll, { passive: true });
    window.addEventListener('resize', onScroll);
    return () => {
      if (frame) cancelAnimationFrame(frame);
      window.removeEventListener('scroll', onScroll);
      window.removeEventListener('resize', onScroll);
    };
  }, [sections]);

  // En pantallas chicas el índice se desplaza solo para mostrar la sección actual.
  useEffect(() => {
    if (!current) return;
    const link = document.querySelector<HTMLElement>(`.pline-link[href="#${current}"]`);
    const list = link?.closest('ol');
    if (!link || !list || list.scrollWidth <= list.clientWidth) return;
    const left = list.scrollLeft + link.getBoundingClientRect().left - list.getBoundingClientRect().left - 16;
    const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    list.scrollTo({ left, behavior: reduce ? 'auto' : 'smooth' });
  }, [current]);

  return (
    <nav className="pline" aria-label={label} style={{ '--pline': `var(--c-${product})` } as CSSProperties}>
      <ol className="pline-list container">
        {sections.map((s) => (
          <li key={s.id}>
            <a href={`#${s.id}`} className="pline-link" aria-current={current === s.id ? 'location' : undefined}>
              <span className="pline-label">{s.label}</span>
            </a>
          </li>
        ))}
      </ol>
    </nav>
  );
}
