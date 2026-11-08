'use client';

import { useEffect, useRef } from 'react';
import { contentBounds, minimapLayout, minimapToScene, type MinimapLayout } from '@/lib/board-canvas-tools';
import { elementBox, type SceneEl } from '@/lib/board-stickies';
import { elementsSignature } from '@/lib/board-signature';
import type { CanvasApi } from './ExcalidrawCanvas';

const W = 200;
const H = 128;

/**
 * Minimapa: todo el lienzo en chico con el recuadro de lo que se ve. Clic o
 * arrastre lleva la vista ahí. Se redibuja como mucho una vez por frame y
 * solo si cambió algún elemento o la vista (con 1000+ objetos sigue liviano).
 */
export default function BoardMinimap({ api, label }: { api: CanvasApi; label: string }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const layoutRef = useRef<MinimapLayout | null>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    canvas.width = W * dpr;
    canvas.height = H * dpr;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    let frame = 0;
    let lastSig = '';
    let elements: SceneEl[] = [];
    let bounds: ReturnType<typeof contentBounds> = null;

    const draw = () => {
      frame = 0;
      const all = api.getSceneElements() as SceneEl[];
      const sig = elementsSignature(all);
      if (sig !== lastSig) {
        lastSig = sig;
        elements = all.filter((e) => !e.isDeleted && !e.containerId);
        bounds = contentBounds(elements);
      }
      const s = api.getAppState();
      const zoom = Number((s.zoom as { value?: number })?.value) || 1;
      const view = { x: -Number(s.scrollX) || 0, y: -Number(s.scrollY) || 0, width: (Number(s.width) || 1200) / zoom, height: (Number(s.height) || 800) / zoom };
      const layout = minimapLayout(bounds, view, { width: W, height: H });
      layoutRef.current = layout;
      const styles = getComputedStyle(canvas);
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.clearRect(0, 0, W, H);
      const ink = styles.getPropertyValue('--minimap-ink').trim() || '#868e96';
      for (const el of elements) {
        const b = elementBox(el);
        const x = b.x * layout.scale + layout.offsetX;
        const y = b.y * layout.scale + layout.offsetY;
        const w = Math.max(1, b.width * layout.scale);
        const h = Math.max(1, b.height * layout.scale);
        const fill = el.backgroundColor && el.backgroundColor !== 'transparent' ? el.backgroundColor : null;
        if (el.type === 'frame') {
          ctx.strokeStyle = ink;
          ctx.lineWidth = 1;
          ctx.strokeRect(x + 0.5, y + 0.5, w, h);
        } else if (fill) {
          ctx.fillStyle = fill;
          ctx.fillRect(x, y, w, h);
        } else {
          ctx.globalAlpha = 0.45;
          ctx.fillStyle = ink;
          ctx.fillRect(x, y, w, h);
          ctx.globalAlpha = 1;
        }
      }
      const v = layout.viewport;
      ctx.strokeStyle = styles.getPropertyValue('--minimap-view').trim() || '#1971c2';
      ctx.lineWidth = 1.5;
      ctx.strokeRect(v.x, v.y, v.width, v.height);
    };
    const schedule = () => {
      if (!frame) frame = requestAnimationFrame(draw);
    };
    draw();
    const offChange = api.onChange(schedule);
    const offScroll = api.onScrollChange(schedule);
    // El tema (claro/oscuro) cambia los colores de las variables.
    const mo = new MutationObserver(schedule);
    mo.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme', 'class'] });
    return () => {
      offChange();
      offScroll();
      mo.disconnect();
      if (frame) cancelAnimationFrame(frame);
    };
  }, [api]);

  /** Centra la vista en el punto del minimapa. */
  function goTo(e: React.PointerEvent<HTMLCanvasElement>) {
    const layout = layoutRef.current;
    if (!layout) return;
    const r = e.currentTarget.getBoundingClientRect();
    const p = minimapToScene({ x: e.clientX - r.left, y: e.clientY - r.top }, layout);
    const s = api.getAppState();
    const zoom = Number((s.zoom as { value?: number })?.value) || 1;
    api.updateScene({ appState: { scrollX: (Number(s.width) || 1200) / 2 / zoom - p.x, scrollY: (Number(s.height) || 800) / 2 / zoom - p.y } });
  }

  return (
    <div className="board-minimap" data-testid="board-minimap">
      <canvas
        ref={canvasRef}
        style={{ width: W, height: H }}
        role="img"
        aria-label={label}
        onPointerDown={(e) => {
          e.currentTarget.setPointerCapture(e.pointerId);
          goTo(e);
        }}
        onPointerMove={(e) => {
          if (e.buttons === 1) goTo(e);
        }}
      />
    </div>
  );
}
