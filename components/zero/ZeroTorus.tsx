'use client';

import { useEffect, useRef, type CSSProperties } from 'react';
import { renderTorus } from '@/lib/torus';
import type { Figure } from '@/lib/zero-art/engine';

const W = 64;
const H = 30;
const START_A = 1.15;
const START_B = 0.35;

/**
 * El cero de zerosoft: un toroide hecho de ceros que gira solo y se puede
 * arrastrar. Toma el color del texto (currentColor), así sirve en modo claro
 * y oscuro, y en el color de un producto. Con movimiento reducido queda
 * quieto en su ángulo inicial. El movimiento lo lleva el motor de las figuras
 * (lib/zero-art/runner) y la letra sale del CSS, como en ZeroArt.
 */
export default function ZeroTorus({
  interactive = true,
  spin = true,
  className = '',
  label,
}: {
  /** Se puede girar arrastrando. */
  interactive?: boolean;
  /** Gira solo. */
  spin?: boolean;
  className?: string;
  /** Texto para lectores de pantalla; sin él la pieza es decorativa. */
  label?: string;
}) {
  const boxRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const box = boxRef.current;
    const pre = box?.querySelector('pre');
    if (!box || !pre) return;
    if (!spin && !interactive) return;
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches && !interactive) return;
    let stop: (() => void) | undefined;
    let cancelled = false;
    void import('@/lib/zero-art/runner').then(({ runFigure }) => {
      if (cancelled) return;
      const figure: Figure = {
        cols: W,
        rows: H,
        fps: 30,
        still: 0,
        draggable: interactive,
        draw() {},
        text(t, input) {
          const turn = spin ? t : 0;
          return renderTorus(W, H, START_A + turn * 0.54 + input.dragY * 0.012, START_B + turn * 0.27 + input.dragX * 0.012);
        },
      };
      stop = runFigure(box, pre, figure);
    });
    return () => {
      cancelled = true;
      stop?.();
    };
  }, [interactive, spin]);

  const a11y = label ? { role: 'img' as const, 'aria-label': label } : { 'aria-hidden': true as const };
  return (
    <div
      ref={boxRef}
      className={`zero-art zero-torus ${interactive ? 'is-draggable' : ''} ${className}`.replace(/\s+/g, ' ').trim()}
      style={{ '--art-cols': W, '--art-rows': H } as CSSProperties}
      {...a11y}
    >
      {/* El primer cuadro sale del servidor: sin JS se ve el cero quieto. */}
      <pre>{renderTorus(W, H, START_A, START_B)}</pre>
    </div>
  );
}
