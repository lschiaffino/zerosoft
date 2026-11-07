'use client';

import { useEffect, useRef, type CSSProperties, type ReactNode } from 'react';
import type { FigureRef } from '@/lib/zero-art/catalog';

/**
 * Pone en marcha la figura cuando está por verse y el navegador está libre, así
 * no compite con el primer pintado. Con movimiento reducido no se baja nada,
 * salvo que la figura se pueda arrastrar.
 */
export default function ZeroArtClient({
  figure,
  className,
  style,
  children,
}: {
  figure: FigureRef;
  className: string;
  style: CSSProperties;
  children: ReactNode;
}) {
  const boxRef = useRef<HTMLDivElement>(null);
  const [family, variant] = figure;

  useEffect(() => {
    const box = boxRef.current;
    const pre = box?.querySelector('pre');
    if (!box || !pre) return;
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches && !box.classList.contains('is-draggable')) return;
    let stop: (() => void) | undefined;
    let cancelled = false;
    let idle = 0;

    const start = async () => {
      const [{ loadFigure }, { runFigure }] = await Promise.all([import('@/lib/zero-art/load'), import('@/lib/zero-art/runner')]);
      const loaded = await loadFigure([family, variant]);
      if (!cancelled) stop = runFigure(box, pre, loaded);
    };
    const io = new IntersectionObserver(
      (entries) => {
        if (!entries.some((e) => e.isIntersecting)) return;
        io.disconnect();
        if (typeof requestIdleCallback === 'function') idle = requestIdleCallback(() => void start(), { timeout: 2000 });
        else idle = window.setTimeout(() => void start(), 200);
      },
      { rootMargin: '200px' },
    );
    io.observe(box);

    return () => {
      cancelled = true;
      io.disconnect();
      if (typeof cancelIdleCallback === 'function') cancelIdleCallback(idle);
      else clearTimeout(idle);
      stop?.();
    };
  }, [family, variant]);

  return (
    <div ref={boxRef} className={className} style={style} aria-hidden="true">
      {children}
    </div>
  );
}
