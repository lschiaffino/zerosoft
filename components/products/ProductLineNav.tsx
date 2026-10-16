'use client';

import { useEffect, useState, type CSSProperties } from 'react';
import type { ProductKey } from '@/lib/products';

export interface LineStop {
  /** id de la sección a la que lleva la estación. */
  id: string;
  label: string;
}

/**
 * La línea del producto como índice de la página: un tramo en su color con
 * una estación por sección. La estación de la sección que se está leyendo se
 * llena con el color de la línea (aria-current="location").
 */
export default function ProductLineNav({ product, stops, label }: { product: ProductKey; stops: LineStop[]; label: string }) {
  const [current, setCurrent] = useState<string | null>(null);

  useEffect(() => {
    let frame = 0;
    const update = () => {
      frame = 0;
      const doc = document.documentElement;
      const atBottom = window.scrollY + window.innerHeight >= doc.scrollHeight - 2;
      // La sección actual es la última cuyo cartel ya pasó la línea de lectura
      // (debajo del header y la línea). Al final de la página, la última que se ve.
      const line = atBottom ? window.innerHeight - 1 : 160;
      let next: string | null = null;
      for (const s of stops) {
        const el = document.getElementById(s.id);
        if (el && el.getBoundingClientRect().top <= line) next = s.id;
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
  }, [stops]);

  // En pantallas chicas la línea se desplaza sola para mostrar la estación actual.
  useEffect(() => {
    if (!current) return;
    const link = document.querySelector<HTMLElement>(`.pline-stop[href="#${current}"]`);
    const list = link?.closest('ol');
    if (!link || !list || list.scrollWidth <= list.clientWidth) return;
    const left = list.scrollLeft + link.getBoundingClientRect().left - list.getBoundingClientRect().left - 16;
    const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    list.scrollTo({ left, behavior: reduce ? 'auto' : 'smooth' });
  }, [current]);

  return (
    <nav className="pline" aria-label={label} style={{ '--pline': `var(--c-${product})` } as CSSProperties}>
      <ol className="pline-stops container">
        {stops.map((s) => (
          <li key={s.id}>
            <a href={`#${s.id}`} className="pline-stop" aria-current={current === s.id ? 'location' : undefined}>
              <span className="pline-station" aria-hidden="true" />
              <span className="pline-label">{s.label}</span>
            </a>
          </li>
        ))}
      </ol>
    </nav>
  );
}
