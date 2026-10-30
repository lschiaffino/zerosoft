'use client';

import { useEffect, useRef, useState } from 'react';
import { chartTicks } from '@/lib/chart-ticks';

export interface ChartSeries {
  label: string;
  data: number[];
  /** Período anterior: línea punteada del mismo color. */
  compare?: number[];
}

const FALLBACK_W = 760;

/**
 * Gráfico de líneas o barras de varias series (SVG a mano, como el de Link):
 * se dibuja al ancho real del contenedor, la serie i usa el color --an-s<i>.
 * Leyenda abajo; el resumen va en aria-label.
 */
export default function Chart({
  series,
  labels,
  kind = 'line',
  summary,
  height = 260,
}: {
  series: ChartSeries[];
  labels: string[];
  kind?: 'line' | 'bar';
  summary: string;
  height?: number;
}) {
  const wrapRef = useRef<HTMLDivElement>(null);
  const [w, setW] = useState<number | null>(null);
  const [hover, setHover] = useState<number | null>(null);

  useEffect(() => {
    const el = wrapRef.current;
    if (!el) return;
    const measure = () => {
      const r = el.getBoundingClientRect();
      if (r.width > 0) setW((prev) => (prev && Math.round(prev) === Math.round(r.width) ? prev : Math.round(r.width)));
    };
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const W = w ?? FALLBACK_W;
  const H = height;
  const pad = { t: 12, r: 12, b: 26, l: 44 };
  const iw = Math.max(W - pad.l - pad.r, 1);
  const ih = Math.max(H - pad.t - pad.b, 1);
  const n = labels.length;
  const max = Math.max(0, ...series.flatMap((s) => [...s.data, ...(s.compare ?? [])]));
  const { top, ticks } = chartTicks(max);
  const y = (v: number) => pad.t + ih - (v / top) * ih;
  const stepX = kind === 'bar' ? iw / Math.max(n, 1) : n > 1 ? iw / (n - 1) : 0;
  const x = (i: number) => (kind === 'bar' ? pad.l + stepX * i + stepX / 2 : pad.l + i * stepX);
  const narrow = W < 600;
  const every = Math.max(1, Math.ceil(n / (narrow ? 3 : 8)));
  const xTicks = n ? [...new Set([...Array.from({ length: n }, (_, i) => i).filter((i) => i % every === 0), n - 1])] : [];
  const barW = kind === 'bar' ? Math.max(2, (stepX * 0.8) / Math.max(series.length, 1)) : 0;
  const fmt = (v: number) => (v >= 10_000 ? `${Math.round(v / 1000)}k` : String(v));

  return (
    <div className="an-chart">
      <div ref={wrapRef} className="an-chart-wrap" style={{ height: H }} onMouseLeave={() => setHover(null)}>
        <svg width={w ? W : undefined} height={H} viewBox={`0 0 ${W} ${H}`} role="img" aria-label={summary} preserveAspectRatio="xMinYMid meet">
          {ticks.map((v) => (
            <g key={v}>
              <line className="chart-grid" x1={pad.l} x2={pad.l + iw} y1={y(v)} y2={y(v)} />
              <text className="chart-ylabel" x={pad.l - 8} y={y(v) + 4} textAnchor="end">
                {fmt(v)}
              </text>
            </g>
          ))}
          {kind === 'line' &&
            series.map((s, si) => (
              <g key={si} className={`an-s an-s${si % 6}`}>
                {s.compare && <polyline className="an-line-compare" fill="none" points={s.compare.map((v, i) => `${x(i)},${y(v)}`).join(' ')} />}
                <polyline className="an-line" fill="none" points={s.data.map((v, i) => `${x(i)},${y(v)}`).join(' ')} />
                {n === 1 && <circle className="an-dot" cx={x(0)} cy={y(s.data[0])} r={3.5} />}
              </g>
            ))}
          {kind === 'bar' &&
            series.map((s, si) => (
              <g key={si} className={`an-s an-s${si % 6}`}>
                {s.data.map((v, i) => (
                  <rect
                    key={i}
                    className="an-bar"
                    x={x(i) - (barW * series.length) / 2 + barW * si}
                    y={y(v)}
                    width={barW}
                    height={Math.max(0, pad.t + ih - y(v))}
                  />
                ))}
              </g>
            ))}
          {hover !== null && n > 0 && <line className="an-hover-line" x1={x(hover)} x2={x(hover)} y1={pad.t} y2={pad.t + ih} />}
          {xTicks.map((i) => (
            <text key={i} className="chart-xlabel" x={x(i)} y={H - 6} textAnchor={kind === 'bar' ? 'middle' : i === 0 ? 'start' : i === n - 1 ? 'end' : 'middle'}>
              {labels[i]}
            </text>
          ))}
          {/* Zonas para el detalle al pasar el mouse. */}
          {n > 0 &&
            labels.map((_, i) => (
              <rect
                key={`h${i}`}
                x={kind === 'bar' ? pad.l + stepX * i : x(i) - (stepX || iw) / 2}
                y={pad.t}
                width={stepX || iw}
                height={ih}
                fill="transparent"
                onMouseEnter={() => setHover(i)}
              />
            ))}
        </svg>
        {hover !== null && n > 0 && (
          <div className="an-tooltip" style={{ left: Math.min(Math.max(x(hover), 80), W - 80) }} role="presentation">
            <strong>{labels[hover]}</strong>
            {series.map((s, si) => (
              <span key={si} className={`an-tip-row an-s${si % 6}`}>
                <i className="an-swatch" aria-hidden="true" />
                {s.label}: {s.data[hover] ?? 0}
                {s.compare ? ` (${s.compare[hover] ?? 0})` : ''}
              </span>
            ))}
          </div>
        )}
      </div>
      {series.length > 1 && (
        <ul className="an-legend" role="list">
          {series.map((s, si) => (
            <li key={si} className={`an-s${si % 6}`}>
              <i className="an-swatch" aria-hidden="true" />
              {s.label}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
