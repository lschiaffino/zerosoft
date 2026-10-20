'use client';

import { useMemo } from 'react';
import { useTranslations } from 'next-intl';
import { buildTemplateScene, templatePreview, type BoardTemplateKey } from '@/lib/board-templates';

/** Dibujo chico de la plantilla: las mismas formas que la escena, sin texto legible. */
export default function TemplatePreview({ template }: { template: BoardTemplateKey }) {
  const tt = useTranslations('board.templates');
  const { viewBox, shapes } = useMemo(() => {
    let n = 0;
    // Ids fijos: el dibujo es el mismo en el servidor y en el cliente.
    return templatePreview(buildTemplateScene(template, (k) => tt(k as never), () => `p${++n}`));
  }, [template, tt]);
  return (
    <svg viewBox={viewBox} preserveAspectRatio="xMidYMid meet" className="board-template-svg">
      {shapes.map((s, i) => {
        if (s.kind === 'rect') return <rect key={i} x={s.x} y={s.y} width={s.w} height={s.h} rx={6} style={{ fill: fillOf(s.fill) }} className="board-template-shape" />;
        if (s.kind === 'ellipse')
          return <ellipse key={i} cx={s.x + s.w / 2} cy={s.y + s.h / 2} rx={s.w / 2} ry={s.h / 2} style={{ fill: fillOf(s.fill) }} className="board-template-shape" />;
        if (s.kind === 'diamond') {
          const pts = `${s.x + s.w / 2},${s.y} ${s.x + s.w},${s.y + s.h / 2} ${s.x + s.w / 2},${s.y + s.h} ${s.x},${s.y + s.h / 2}`;
          return <polygon key={i} points={pts} style={{ fill: fillOf(s.fill) }} className="board-template-shape" />;
        }
        if (s.kind === 'line') return <polyline key={i} points={s.points.map((p) => p.join(',')).join(' ')} fill="none" className="board-template-line" />;
        return <rect key={i} x={s.x} y={s.y} width={s.w} height={s.h} className="board-template-text" />;
      })}
    </svg>
  );
}

/** El color de la plantilla mezclado con el fondo: pastel en claro, apagado en oscuro. */
function fillOf(fill: string): string {
  return fill === 'transparent' ? 'none' : `color-mix(in srgb, ${fill} 72%, var(--bg))`;
}
