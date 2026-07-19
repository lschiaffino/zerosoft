'use client';

import { useEffect, useRef } from 'react';

interface ZeroFieldProps {
  /** Posición del cero grande dentro del contenedor */
  align?: 'right' | 'center' | 'top';
  /** Tamaño del cero como fracción de min(ancho, alto) del contenedor */
  sizeFactor?: number;
  /** Color de los ceros pequeños, formato "r,g,b" */
  color?: string;
  /** Reacciona al mouse */
  interactive?: boolean;
  /** Opacidad base de cada cero (0-1) */
  alpha?: number;
  className?: string;
}

interface Particle {
  hx: number; hy: number;
  x: number; y: number;
  vx: number; vy: number;
  s: number; o: number; ph: number;
}

/**
 * Un cero hecho de ceros. El efecto de la home, reutilizable:
 * hero, footer, 404, productos…
 */
export default function ZeroField({
  align = 'right',
  sizeFactor = 0.92,
  color = '13,13,13',
  interactive = true,
  alpha = 0.9,
  className = '',
}: ZeroFieldProps) {
  const wrapRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const wrap = wrapRef.current;
    const canvas = canvasRef.current;
    if (!wrap || !canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    let W = 0;
    let H = 0;
    let particles: Particle[] = [];
    const mouse = { x: -9999, y: -9999 };
    let raf = 0;

    const isMobile = W <= 860;

    function glyphCenter() {
      if (align === 'center') return { x: W * 0.5, y: H * 0.5 };
      if (align === 'top') return { x: W * 0.5, y: H * 0.42 };
      if (!isMobile) return { x: W * 0.67, y: H * 0.44 };
      // Mobile: el canvas es una banda superior del hero → glifo centrado en ella.
      return { x: W * 0.5, y: H * 0.55 };
    }

    function buildParticles() {
      const off = document.createElement('canvas');
      off.width = W;
      off.height = H;
      const octx = off.getContext('2d', { willReadFrequently: true });
      if (!octx) return;

      // En mobile la banda es horizontal (W > H), así que usamos H como
      // dimensión dominante para que el cero no se estire ni quede chico.
      const size = Math.min(W, H) * (isMobile ? sizeFactor * 0.95 : sizeFactor);
      const { x: cx, y: cy } = glyphCenter();

      octx.fillStyle = '#000';
      octx.font = `500 ${size}px "IBM Plex Mono", monospace`;
      octx.textAlign = 'center';
      octx.textBaseline = 'middle';
      octx.fillText('0', cx, cy);

      const img = octx.getImageData(0, 0, W, H).data;
      const gap = Math.max(8, Math.round(size / 56));

      particles = [];
      for (let y = 0; y < H; y += gap) {
        for (let x = 0; x < W; x += gap) {
          if (img[(y * W + x) * 4 + 3] > 120) {
            particles.push({
              hx: x, hy: y,
              x: x + (Math.random() - 0.5) * W * 0.9,
              y: y + (Math.random() - 0.5) * H * 0.9,
              vx: 0, vy: 0,
              s: gap * 1.15,
              o: alpha * (0.5 + Math.random() * 0.5),
              ph: Math.random() * Math.PI * 2,
            });
          }
        }
      }
    }

    function drawStatic() {
      if (!ctx) return;
      ctx.clearRect(0, 0, W, H);
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      for (const p of particles) {
        ctx.font = `500 ${p.s}px "IBM Plex Mono", monospace`;
        ctx.fillStyle = `rgba(${color}, ${p.o})`;
        ctx.fillText('0', p.hx, p.hy);
      }
    }

    function resize() {
      if (!ctx || !wrap || !canvas) return;
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      W = wrap.clientWidth;
      H = wrap.clientHeight;
      if (W === 0 || H === 0) return;
      canvas.width = W * dpr;
      canvas.height = H * dpr;
      canvas.style.width = `${W}px`;
      canvas.style.height = `${H}px`;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      buildParticles();
      if (reduced || !interactive) drawStatic();
    }

    const t0 = performance.now();

    function tick(now: number) {
      if (!ctx) return;
      const t = (now - t0) / 1000;
      ctx.clearRect(0, 0, W, H);
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';

      const R = 130;
      for (const p of particles) {
        const dx = p.x - mouse.x;
        const dy = p.y - mouse.y;
        const d2 = dx * dx + dy * dy;

        if (d2 < R * R && d2 > 0.01) {
          const d = Math.sqrt(d2);
          const f = ((R - d) / R) * 1.9;
          p.vx += (dx / d) * f;
          p.vy += (dy / d) * f;
        }

        p.vx += (p.hx - p.x) * 0.014;
        p.vy += (p.hy - p.y) * 0.014;
        p.vx *= 0.86;
        p.vy *= 0.86;
        p.x += p.vx;
        p.y += p.vy;

        const near = Math.max(0, 1 - Math.sqrt(d2) / 240);
        const wobX = Math.sin(t * 1.4 + p.ph) * 1.1;
        const wobY = Math.cos(t * 1.2 + p.ph) * 1.1;
        const fs = Math.round(p.s * (1 + near * 0.8));

        ctx.font = `500 ${fs}px "IBM Plex Mono", monospace`;
        ctx.fillStyle = `rgba(${color}, ${Math.min(1, p.o + near * 0.4)})`;
        ctx.fillText('0', p.x + wobX, p.y + wobY);
      }
      raf = requestAnimationFrame(tick);
    }

    const host = wrap.parentElement ?? wrap;
    function onMove(e: PointerEvent) {
      const r = canvas!.getBoundingClientRect();
      mouse.x = e.clientX - r.left;
      mouse.y = e.clientY - r.top;
    }
    function onLeave() {
      mouse.x = -9999;
      mouse.y = -9999;
    }

    const ro = new ResizeObserver(() => resize());
    ro.observe(wrap);

    const start = () => {
      resize();
      if (!reduced && interactive) {
        host.addEventListener('pointermove', onMove as EventListener);
        host.addEventListener('pointerleave', onLeave);
        raf = requestAnimationFrame(tick);
      }
    };

    if (document.fonts?.ready) {
      Promise.race([
        document.fonts.ready,
        new Promise((r) => setTimeout(r, 900)),
      ]).then(start);
    } else {
      start();
    }

    return () => {
      cancelAnimationFrame(raf);
      ro.disconnect();
      host.removeEventListener('pointermove', onMove as EventListener);
      host.removeEventListener('pointerleave', onLeave);
    };
  }, [align, sizeFactor, color, interactive, alpha]);

  return (
    <div ref={wrapRef} className={`zero-field ${className}`} aria-hidden="true">
      <canvas ref={canvasRef} />
    </div>
  );
}
