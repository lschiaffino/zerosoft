'use client';

import { useEffect, useRef, useState } from 'react';

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
  /** Colores extra ("r,g,b") para una parte de los ceros (el resto usa `color`). */
  accents?: string[];
  /** Fracción de ceros que toman un color de `accents` (0-1). */
  accentShare?: number;
  className?: string;
}

interface Particle {
  hx: number; hy: number;
  x: number; y: number;
  vx: number; vy: number;
  s: number; o: number; ph: number;
  /** Índice del sprite (0 = color base, 1.. = accents). */
  k: number;
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
  accents,
  accentShare = 0.18,
  className = '',
}: ZeroFieldProps) {
  const accentKey = accents?.join('|') ?? '';
  const wrapRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [hasError, setHasError] = useState(false);
  // Empieza en true para que el primer render del cliente coincida con el SSR
  // (ambos muestran el fallback). El efecto lo baja a false tras montar.
  const [ssr, setSsr] = useState(true);

  useEffect(() => {
    setSsr(false);
    if (typeof window === 'undefined') return;

    const wrap = wrapRef.current;
    const canvas = canvasRef.current;
    if (!wrap || !canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) {
      setHasError(true);
      return;
    }

    try {
      const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
      let W = 0;
      let H = 0;
      let particles: Particle[] = [];
      const mouse = { x: -9999, y: -9999 };
      // Posición del puntero en coordenadas de la ventana; se convierte a las
      // del canvas en cada frame, así el scroll y los textos encima no la rompen.
      const pointer = { x: -9999, y: -9999, active: false };
      let raf = 0;
      let visible = true;

      // Sprite del glifo "0" pre-renderizado una vez: en el loop usamos
      // drawImage (GPU) en vez de fillText + cambios de font/fillStyle,
      // que es lo que hacía lenta la animación.
      let sprites: HTMLCanvasElement[] = [];
      const palette = [color, ...(accentKey ? accentKey.split('|') : [])];
      const SPRITE = 96;

      function buildSprite() {
        sprites = [];
        for (const rgb of palette) {
          const c = document.createElement('canvas');
          c.width = SPRITE;
          c.height = SPRITE;
          const cctx = c.getContext('2d');
          if (!cctx) return;
          cctx.fillStyle = `rgb(${rgb})`;
          cctx.font = `500 ${Math.round(SPRITE * 0.82)}px "IBM Plex Mono", monospace`;
          cctx.textAlign = 'center';
          cctx.textBaseline = 'middle';
          cctx.fillText('0', SPRITE / 2, SPRITE / 2 + SPRITE * 0.02);
          sprites.push(c);
        }
      }

      function isMobile() {
        return W <= 860;
      }

      function glyphCenter() {
        if (align === 'center') return { x: W * 0.5, y: H * 0.5 };
        if (align === 'top') return { x: W * 0.5, y: H * 0.42 };
        if (!isMobile()) {
          // Desktop right: empujado hacia la derecha y ligeramente más abajo
          // para no tapar el header ni el texto del hero.
          return { x: W * 0.78, y: H * 0.58 };
        }
        // Mobile: el canvas es una banda superior del hero → glifo centrado en ella.
        return { x: W * 0.5, y: H * 0.5 };
      }

      function buildParticles() {
        const off = document.createElement('canvas');
        off.width = W;
        off.height = H;
        const octx = off.getContext('2d', { willReadFrequently: true });
        if (!octx) return;

        // En mobile la banda es horizontal (W > H), así que usamos H como
        // dimensión dominante para que el cero no se estire ni quede chico.
        const size = Math.min(W, H) * (isMobile() ? Math.min(1, sizeFactor * 1.05) : sizeFactor);
        const { x: cx, y: cy } = glyphCenter();

        octx.fillStyle = '#000';
        octx.font = `500 ${size}px "IBM Plex Mono", monospace`;
        octx.textAlign = 'center';
        octx.textBaseline = 'middle';
        octx.fillText('0', cx, cy);

        const img = octx.getImageData(0, 0, W, H).data;
        const gap = Math.max(8, Math.round(size / 56));

        // Al reconstruir (resize) se reubican los ceros existentes en sus
        // nuevos lugares en vez de volver a dispersarlos.
        const prev = particles;
        const next: Particle[] = [];
        for (let y = 0; y < H; y += gap) {
          for (let x = 0; x < W; x += gap) {
            if (img[(y * W + x) * 4 + 3] > 120) {
              const old = prev[next.length];
              next.push({
                hx: x, hy: y,
                x: old ? old.x : x + (Math.random() - 0.5) * W * 0.9,
                y: old ? old.y : y + (Math.random() - 0.5) * H * 0.9,
                vx: 0, vy: 0,
                s: gap * 1.15,
                o: old ? old.o : alpha * (0.5 + Math.random() * 0.5),
                ph: old ? old.ph : Math.random() * Math.PI * 2,
                k: old
                  ? old.k
                  : palette.length > 1 && Math.random() < accentShare
                    ? 1 + Math.floor(Math.random() * (palette.length - 1))
                    : 0,
              });
            }
          }
        }
        particles = next;
      }

      function drawStatic() {
        if (!ctx || !sprites.length) return;
        ctx.clearRect(0, 0, W, H);
        for (const p of particles) {
          const half = p.s / 2;
          ctx.globalAlpha = p.o;
          ctx.drawImage(sprites[p.k] ?? sprites[0], p.hx - half, p.hy - half, p.s, p.s);
        }
        ctx.globalAlpha = 1;
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
        buildSprite();
        buildParticles();
        if (reduced || !interactive) drawStatic();
      }

      const t0 = performance.now();

      function tick(now: number) {
        if (!ctx || !sprites.length) return;
        const t = (now - t0) / 1000;
        ctx.clearRect(0, 0, W, H);

        if (pointer.active && canvas) {
          const r = canvas.getBoundingClientRect();
          mouse.x = pointer.x - r.left;
          mouse.y = pointer.y - r.top;
          // Fuera del canvas (con margen) no hay interacción.
          if (mouse.x < -160 || mouse.y < -160 || mouse.x > W + 160 || mouse.y > H + 160) {
            mouse.x = -9999;
            mouse.y = -9999;
          }
        } else {
          mouse.x = -9999;
          mouse.y = -9999;
        }

        const R = Math.max(110, Math.min(170, Math.min(W, H) * 0.2));
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
          const fs = p.s * (1 + near * 0.8);
          const half = fs / 2;

          ctx.globalAlpha = Math.min(1, p.o + near * 0.4);
          ctx.drawImage(sprites[p.k] ?? sprites[0], p.x + wobX - half, p.y + wobY - half, fs, fs);
        }
        ctx.globalAlpha = 1;
        raf = visible ? requestAnimationFrame(tick) : 0;
      }

      // Escuchamos en window: el texto del hero se superpone al canvas y, si
      // escucháramos solo en el contenedor, el puntero "desaparecería" al pasar
      // por encima de los títulos y botones.
      function onMove(e: PointerEvent) {
        pointer.x = e.clientX;
        pointer.y = e.clientY;
        pointer.active = true;
      }
      function onLeave() {
        pointer.active = false;
      }
      function onTouchEnd(e: PointerEvent) {
        // En touch el "puntero" se va al levantar el dedo.
        if (e.pointerType !== 'mouse') pointer.active = false;
      }

      const ro = new ResizeObserver(() => resize());
      ro.observe(wrap);

      // Pausa el loop cuando el canvas sale del viewport (ahorro de CPU).
      const io = new IntersectionObserver(
        (entries) => {
          visible = entries[0]?.isIntersecting ?? true;
          if (visible && !reduced && interactive && !raf) {
            raf = requestAnimationFrame(tick);
          }
        },
        { threshold: 0 },
      );
      io.observe(wrap);

      const start = () => {
        resize();
        if (!reduced && interactive) {
          window.addEventListener('pointermove', onMove, { passive: true });
          window.addEventListener('pointerdown', onMove, { passive: true });
          window.addEventListener('pointerup', onTouchEnd, { passive: true });
          document.documentElement.addEventListener('pointerleave', onLeave);
          window.addEventListener('blur', onLeave);
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

      const onOrientation = () => {
        // Give the browser a moment to settle the new viewport size.
        setTimeout(resize, 120);
      };
      window.addEventListener('orientationchange', onOrientation);

      return () => {
        cancelAnimationFrame(raf);
        ro.disconnect();
        io.disconnect();
        window.removeEventListener('pointermove', onMove);
        window.removeEventListener('pointerdown', onMove);
        window.removeEventListener('pointerup', onTouchEnd);
        document.documentElement.removeEventListener('pointerleave', onLeave);
        window.removeEventListener('blur', onLeave);
        window.removeEventListener('orientationchange', onOrientation);
      };
    } catch {
      setHasError(true);
    }
  }, [align, sizeFactor, color, interactive, alpha, accentKey, accentShare]);

  return (
    <div ref={wrapRef} className={`zero-field ${className}`} aria-hidden="true">
      <canvas ref={canvasRef} />
      {(ssr || hasError) && (
        <div className="zero-field-fallback">
          <span>0</span>
        </div>
      )}
    </div>
  );
}
