'use client';

import { useEffect, useRef } from 'react';
import { renderTorus } from '@/lib/torus';

const W = 64;
const H = 30;
/** Ancho de un carácter mono y alto de línea, en em. */
const CH = 0.6;
const LH = 1.12;
const START_A = 1.15;
const START_B = 0.35;

/**
 * El cero de zerosoft: un toroide hecho de ceros que gira solo y se puede
 * arrastrar. Toma el color del texto (currentColor), así sirve en modo claro
 * y oscuro, y en el color de un producto. Con movimiento reducido queda
 * quieto en su ángulo inicial.
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
  const preRef = useRef<HTMLPreElement>(null);

  useEffect(() => {
    const box = boxRef.current;
    const pre = preRef.current;
    if (!box || !pre) return;
    let A = START_A;
    let B = START_B;
    let drag: { x: number; y: number; A: number; B: number } | null = null;
    let visible = true;
    let raf = 0;
    let last = 0;
    const reduced = window.matchMedia('(prefers-reduced-motion: reduce)');

    const fit = () => {
      const size = Math.min(box.clientWidth / (W * CH), box.clientHeight / (H * LH));
      pre.style.fontSize = `${Math.max(4, size).toFixed(2)}px`;
    };
    const draw = () => {
      pre.textContent = renderTorus(W, H, A, B);
    };
    fit();
    draw();

    const ro = new ResizeObserver(fit);
    ro.observe(box);
    const io = new IntersectionObserver((e) => {
      visible = e[0]?.isIntersecting ?? true;
    });
    io.observe(box);

    const loop = (t: number) => {
      raf = requestAnimationFrame(loop);
      if (!visible || t - last < 33) return;
      last = t;
      if (spin && !drag && !reduced.matches && !document.hidden) {
        A += 0.018;
        B += 0.009;
        draw();
      }
    };
    raf = requestAnimationFrame(loop);

    const down = (e: PointerEvent) => {
      drag = { x: e.clientX, y: e.clientY, A, B };
      pre.setPointerCapture(e.pointerId);
      pre.dataset.dragging = '';
    };
    const move = (e: PointerEvent) => {
      if (!drag) return;
      B = drag.B + (e.clientX - drag.x) * 0.012;
      A = drag.A + (e.clientY - drag.y) * 0.012;
      draw();
    };
    const up = () => {
      drag = null;
      delete pre.dataset.dragging;
    };
    if (interactive) {
      pre.addEventListener('pointerdown', down);
      pre.addEventListener('pointermove', move);
      pre.addEventListener('pointerup', up);
      pre.addEventListener('pointercancel', up);
    }
    return () => {
      cancelAnimationFrame(raf);
      ro.disconnect();
      io.disconnect();
      pre.removeEventListener('pointerdown', down);
      pre.removeEventListener('pointermove', move);
      pre.removeEventListener('pointerup', up);
      pre.removeEventListener('pointercancel', up);
    };
  }, [interactive, spin]);

  const a11y = label ? { role: 'img' as const, 'aria-label': label } : { 'aria-hidden': true as const };
  return (
    <div ref={boxRef} className={`zero-torus ${interactive ? 'is-interactive' : ''} ${className}`.trim()} {...a11y}>
      {/* El primer cuadro sale del servidor: sin JS se ve el cero quieto. */}
      <pre ref={preRef}>{renderTorus(W, H, START_A, START_B)}</pre>
    </div>
  );
}
