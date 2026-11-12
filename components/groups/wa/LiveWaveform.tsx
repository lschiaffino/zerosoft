'use client';

import { useEffect, useRef } from 'react';
import { pushLevel, rmsLevel } from '@/lib/live-waveform';

const BAR = 3;
const GAP = 2;
const TICK_MS = 70;

/**
 * Onda en vivo mientras se graba una nota de voz, como en WhatsApp: barras que
 * corren hacia la izquierda con el volumen del micrófono (puntos cuando hay
 * silencio). Pausada, se queda quieta. Solo decorativa: el estado lo dice el texto.
 */
export default function LiveWaveform({ stream, paused = false }: { stream: MediaStream | null | undefined; paused?: boolean }) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const levels = useRef<number[]>([]);
  const pausedRef = useRef(paused);
  pausedRef.current = paused;

  useEffect(() => {
    const el = canvas.current;
    if (!stream || !el || typeof window === 'undefined') return;
    const Ctx = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!Ctx) return;
    const ctx = new Ctx();
    const source = ctx.createMediaStreamSource(stream);
    const analyser = ctx.createAnalyser();
    analyser.fftSize = 1024;
    source.connect(analyser);
    const buf = new Float32Array(analyser.fftSize);
    const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    let last = 0;
    let raf = 0;

    const draw = () => {
      const dpr = window.devicePixelRatio || 1;
      const w = el.clientWidth;
      const h = el.clientHeight;
      if (el.width !== Math.round(w * dpr) || el.height !== Math.round(h * dpr)) {
        el.width = Math.round(w * dpr);
        el.height = Math.round(h * dpr);
      }
      const g = el.getContext('2d');
      if (!g) return;
      g.setTransform(dpr, 0, 0, dpr, 0, 0);
      g.clearRect(0, 0, w, h);
      g.fillStyle = getComputedStyle(el).color;
      const n = Math.floor(w / (BAR + GAP));
      const data = levels.current.slice(-n);
      // Las barras arrancan desde la derecha, como en WhatsApp: lo nuevo entra por ese lado.
      const x0 = w - data.length * (BAR + GAP);
      data.forEach((v, i) => {
        const bh = Math.max(BAR, v * h);
        const x = x0 + i * (BAR + GAP);
        const y = (h - bh) / 2;
        g.beginPath();
        g.roundRect(x, y, BAR, bh, BAR / 2);
        g.fill();
      });
    };

    const loop = (t: number) => {
      raf = requestAnimationFrame(loop);
      if (t - last < TICK_MS) return;
      last = t;
      if (pausedRef.current) return;
      analyser.getFloatTimeDomainData(buf);
      levels.current = pushLevel(levels.current, rmsLevel(buf), 400);
      draw();
    };
    if (reduce) {
      // Sin animación: una sola barra de nivel que se actualiza despacio.
      const id = window.setInterval(() => {
        if (pausedRef.current) return;
        analyser.getFloatTimeDomainData(buf);
        levels.current = pushLevel(levels.current, rmsLevel(buf), 400);
        draw();
      }, 500);
      return () => {
        window.clearInterval(id);
        source.disconnect();
        void ctx.close().catch(() => {});
      };
    }
    raf = requestAnimationFrame(loop);
    return () => {
      cancelAnimationFrame(raf);
      source.disconnect();
      void ctx.close().catch(() => {});
    };
  }, [stream]);

  return <canvas ref={canvas} className={`wa-live-wave${paused ? ' is-paused' : ''}`} aria-hidden="true" />;
}
