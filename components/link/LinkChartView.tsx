'use client';

import { useEffect, useRef, useState } from 'react';
import { chartTicks } from '@/lib/chart-ticks';

interface LinkChartViewProps {
  counts: number[];
  /** Segunda serie (misma longitud), dibujada como línea punteada. */
  secondary?: number[];
  /** Etiqueta del eje X para cada punto. */
  labels: string[];
  summary: string;
}

/** Ancho con el que se dibuja antes de medir (y sin JS). */
const FALLBACK_W = 760;
/** Por debajo de este ancho el eje X muestra solo primero, medio y último. */
const NARROW = 600;

/**
 * SVG de área a mano (sin dependencias). Se dibuja al tamaño real del
 * contenedor (ResizeObserver): el viewBox coincide con los píxeles, así las
 * etiquetas quedan en 11px en cualquier ancho en vez de escalarse con el SVG.
 */
export default function LinkChartView({ counts, secondary, labels, summary }: LinkChartViewProps) {
  const wrapRef = useRef<HTMLDivElement>(null);
  const [size, setSize] = useState<{ w: number; h: number } | null>(null);

  useEffect(() => {
    const el = wrapRef.current;
    if (!el) return;
    const measure = () => {
      const r = el.getBoundingClientRect();
      if (r.width > 0 && r.height > 0) {
        setSize((prev) =>
          prev && Math.round(prev.w) === Math.round(r.width) && Math.round(prev.h) === Math.round(r.height)
            ? prev
            : { w: Math.round(r.width), h: Math.round(r.height) },
        );
      }
    };
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const W = size?.w ?? FALLBACK_W;
  const H = size?.h ?? 240;
  const narrow = W < NARROW;
  const pad = { t: 14, r: 12, b: 28, l: 36 };
  const iw = Math.max(W - pad.l - pad.r, 1);
  const ih = Math.max(H - pad.t - pad.b, 1);

  const dataMax = Math.max(0, ...counts, ...(secondary ?? []));
  const { top, ticks } = chartTicks(dataMax);
  const n = counts.length;
  const stepX = n > 1 ? iw / (n - 1) : 0;
  const x = (i: number) => pad.l + i * stepX;
  const y = (v: number) => pad.t + ih - (v / top) * ih;
  const line = counts.map((c, i) => `${x(i).toFixed(1)},${y(c).toFixed(1)}`).join(' ');
  const line2 = (secondary ?? []).map((c, i) => `${x(i).toFixed(1)},${y(c).toFixed(1)}`).join(' ');
  const baseline = pad.t + ih;
  const area = `${pad.l},${baseline} ${line} ${(pad.l + iw).toFixed(1)},${baseline}`;

  // Eje X: en angosto, primero / medio / último; si no, una etiqueta cada ~8.
  let xTicks: number[];
  if (n === 0) xTicks = [];
  else if (narrow) xTicks = [...new Set([0, Math.floor((n - 1) / 2), n - 1])];
  else {
    const every = Math.max(5, Math.ceil(n / 8));
    xTicks = [];
    for (let i = 0; i < n; i += every) if (n - 1 - i >= every / 2) xTicks.push(i);
    xTicks.push(n - 1);
  }

  return (
    <div ref={wrapRef} className="link-chart-wrap">
      <svg
        className="link-chart"
        width={size ? W : undefined}
        height={size ? H : undefined}
        viewBox={`0 0 ${W} ${H}`}
        preserveAspectRatio="xMinYMid meet"
        role="img"
        aria-label={summary}
      >
        {ticks.map((v) => (
          <g key={v}>
            <line className="chart-grid" x1={pad.l} x2={pad.l + iw} y1={y(v)} y2={y(v)} />
            <text className="chart-ylabel" x={pad.l - 8} y={y(v) + 4} textAnchor="end">
              {v}
            </text>
          </g>
        ))}
        {n > 0 && (
          <>
            <polygon className="chart-area" points={area} />
            <polyline className="chart-line" points={line} fill="none" />
            {line2 && <polyline className="chart-line-2" points={line2} fill="none" />}
            <circle className="chart-dot" cx={x(n - 1)} cy={y(counts[n - 1])} r={3.5} />
          </>
        )}
        {xTicks.map((i) => (
          <text
            key={i}
            className="chart-xlabel"
            x={x(i)}
            y={H - 8}
            textAnchor={i === 0 ? 'start' : i === n - 1 ? 'end' : 'middle'}
          >
            {labels[i]}
          </text>
        ))}
      </svg>
    </div>
  );
}
