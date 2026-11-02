'use client';

import { useEffect, useId, useRef, useState } from 'react';
import { chartTicks } from '@/lib/chart-ticks';

export interface ChartSeries {
  label: string;
  data: number[];
  /** Período anterior: línea punteada del mismo color. */
  compare?: number[];
  /** Color (--an-s<i>), para que una serie no cambie de color al ocultar otras. */
  colorIndex?: number;
}

export interface ChartExtras {
  stacked?: boolean;
  goalLines?: Array<{ value: number; label?: string }>;
  yMin?: number | null;
  yMax?: number | null;
  xLabel?: string;
  yLabel?: string;
  format?: (v: number) => string;
  showValues?: boolean;
  hideLegend?: boolean;
  /** La última cubeta todavía junta datos: tramo punteado. */
  lastIncomplete?: boolean;
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
  annotations = [],
  extras = {},
}: {
  series: ChartSeries[];
  labels: string[];
  kind?: 'line' | 'bar' | 'area';
  summary: string;
  height?: number;
  /** Marcas sobre el eje x: índice de la cubeta y texto. */
  annotations?: Array<{ index: number; text: string }>;
  extras?: ChartExtras;
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
  const { stacked, goalLines = [], yMin, yMax, xLabel, yLabel, format, showValues, hideLegend, lastIncomplete } = extras;
  const pad = { t: showValues ? 22 : 12, r: 12, b: xLabel ? 44 : 26, l: yLabel ? 62 : 44 };
  const iw = Math.max(W - pad.l - pad.r, 1);
  const ih = Math.max(H - pad.t - pad.b, 1);
  const n = labels.length;
  const stackedTops = labels.map((_, i) => series.reduce((a, s) => a + Math.max(s.data[i] ?? 0, 0), 0));
  const max = Math.max(0, ...(stacked ? stackedTops : series.flatMap((s) => [...s.data, ...(s.compare ?? [])])), ...goalLines.map((g) => g.value));
  const { top: autoTop, ticks: autoTicks } = chartTicks(max);
  const hi = yMax ?? autoTop;
  const lo = yMin ?? 0;
  const span = hi - lo || 1;
  const ticks = yMax == null && yMin == null ? autoTicks : Array.from({ length: 5 }, (_, i) => Math.round((lo + (span * i) / 4) * 100) / 100);
  const y = (v: number) => pad.t + ih - ((v - lo) / span) * ih;
  const stepX = kind === 'bar' ? iw / Math.max(n, 1) : n > 1 ? iw / (n - 1) : 0;
  const x = (i: number) => (kind === 'bar' ? pad.l + stepX * i + stepX / 2 : pad.l + i * stepX);
  const color = (s: ChartSeries, si: number) => (s.colorIndex ?? si) % 6;
  const clipId = useId();
  const narrow = W < 600;
  const every = Math.max(1, Math.ceil(n / (narrow ? 3 : 8)));
  // La última etiqueta siempre va; la anterior se saca si quedaría encima.
  const xTicks = n ? [...new Set([...Array.from({ length: n }, (_, i) => i).filter((i) => i % every === 0 && (i === 0 || n - 1 - i >= Math.ceil(every * 0.7))), n - 1])] : [];
  const barW = kind === 'bar' ? Math.max(2, stacked ? stepX * 0.8 : (stepX * 0.8) / Math.max(series.length, 1)) : 0;
  const fmt = (v: number) => (format ? format(v) : v >= 10_000 ? `${Math.round(v / 1000)}k` : String(Math.round(v * 100) / 100));
  const tipValue = (v: number | undefined) => (format ? format(v ?? 0) : new Intl.NumberFormat(undefined, { maximumFractionDigits: 2 }).format(v ?? 0));
  // Valores sobre la serie: si no entran todos, uno cada tanto.
  const valueEvery = Math.max(1, Math.ceil(n / Math.max(1, Math.floor(iw / 44))));
  const baseY = y(Math.max(lo, 0));
  const hoverNotes = hover === null ? [] : annotations.filter((a) => a.index === hover);

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
          <clipPath id={clipId}>
            <rect x={pad.l} y={pad.t - (showValues ? 18 : 2)} width={iw + 2} height={ih + (showValues ? 20 : 4)} />
          </clipPath>
          <g clipPath={`url(#${clipId})`}>
            {(kind === 'line' || kind === 'area') &&
              series.map((s, si) => {
                // Con la última cubeta incompleta, el último tramo va punteado.
                const cut = lastIncomplete && n > 1 ? n - 1 : n;
                const points = s.data.map((v, i) => `${x(i)},${y(v)}`);
                return (
                  <g key={si} className={`an-s an-s${color(s, si)}`}>
                    {kind === 'area' && n > 1 && <polygon className="an-area" points={`${x(0)},${baseY} ${points.join(' ')} ${x(n - 1)},${baseY}`} />}
                    {s.compare && <polyline className="an-line-compare" fill="none" points={s.compare.map((v, i) => `${x(i)},${y(v)}`).join(' ')} />}
                    <polyline className="an-line" fill="none" points={points.slice(0, cut).join(' ')} />
                    {cut < n && <polyline className="an-line an-line-incomplete" fill="none" points={points.slice(cut - 1).join(' ')} />}
                    {n === 1 && <circle className="an-dot" cx={x(0)} cy={y(s.data[0])} r={3.5} />}
                    {showValues &&
                      s.data.map((v, i) =>
                        i % valueEvery === 0 || i === n - 1 ? (
                          <text key={i} className="an-value-label" x={x(i)} y={y(v) - 7} textAnchor={i === 0 ? 'start' : i === n - 1 ? 'end' : 'middle'}>
                            {fmt(v)}
                          </text>
                        ) : null,
                      )}
                  </g>
                );
              })}
            {kind === 'bar' &&
              series.map((s, si) => (
                <g key={si} className={`an-s an-s${color(s, si)}`}>
                  {s.data.map((v, i) => {
                    const below = stacked ? series.slice(0, si).reduce((a, o) => a + Math.max(o.data[i] ?? 0, 0), 0) : 0;
                    const top = y(below + Math.max(v, 0));
                    const bottom = stacked ? y(below) : baseY;
                    return (
                      <g key={i}>
                        <rect className="an-bar" x={stacked ? x(i) - barW / 2 : x(i) - (barW * series.length) / 2 + barW * si} y={top} width={barW} height={Math.max(0, bottom - top)} />
                        {showValues && !stacked && i % valueEvery === 0 && (
                          <text className="an-value-label" x={x(i) - (barW * series.length) / 2 + barW * si + barW / 2} y={top - 5} textAnchor="middle">
                            {fmt(v)}
                          </text>
                        )}
                      </g>
                    );
                  })}
                </g>
              ))}
            {/* En barras apiladas, el total arriba de cada columna. */}
            {kind === 'bar' &&
              stacked &&
              showValues &&
              stackedTops.map((v, i) =>
                i % valueEvery === 0 ? (
                  <text key={i} className="an-value-label" x={x(i)} y={y(v) - 5} textAnchor="middle">
                    {fmt(v)}
                  </text>
                ) : null,
              )}
          </g>
          {goalLines.map((g, i) =>
            g.value >= lo && g.value <= hi ? (
              <g key={`g${i}`} className="an-goal">
                <line className="an-goal-line" x1={pad.l} x2={pad.l + iw} y1={y(g.value)} y2={y(g.value)} />
                {g.label && (
                  <text className="an-goal-label" x={pad.l + iw - 4} y={y(g.value) - 5} textAnchor="end">
                    {g.label}
                  </text>
                )}
              </g>
            ) : null,
          )}
          {yLabel && (
            <text className="chart-ylabel an-axis-label" transform={`translate(12 ${pad.t + ih / 2}) rotate(-90)`} textAnchor="middle">
              {yLabel}
            </text>
          )}
          {xLabel && (
            <text className="chart-xlabel an-axis-label" x={pad.l + iw / 2} y={H - 4} textAnchor="middle">
              {xLabel}
            </text>
          )}
          {annotations.map((a, i) => (
            <path key={`a${i}`} className="an-annotation-mark" d={`M${x(a.index) - 4} ${pad.t + ih + 7} L${x(a.index) + 4} ${pad.t + ih + 7} L${x(a.index)} ${pad.t + ih + 1} Z`}>
              <title>{a.text}</title>
            </path>
          ))}
          {hover !== null && n > 0 && <line className="an-hover-line" x1={x(hover)} x2={x(hover)} y1={pad.t} y2={pad.t + ih} />}
          {xTicks.map((i) => (
            <text key={i} className="chart-xlabel" x={x(i)} y={xLabel ? H - 24 : H - 6} textAnchor={kind === 'bar' ? 'middle' : i === 0 ? 'start' : i === n - 1 ? 'end' : 'middle'}>
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
              <span key={si} className={`an-tip-row an-s${color(s, si)}`}>
                <i className="an-swatch" aria-hidden="true" />
                {s.label}: {tipValue(s.data[hover])}
                {s.compare ? ` (${tipValue(s.compare[hover])})` : ''}
              </span>
            ))}
            {hoverNotes.map((a, i) => (
              <span key={`n${i}`} className="an-tip-note">
                {a.text}
              </span>
            ))}
          </div>
        )}
      </div>
      {series.length > 1 && !hideLegend && (
        <ul className="an-legend" role="list">
          {series.map((s, si) => (
            <li key={si} className={`an-s${color(s, si)}`}>
              <i className="an-swatch" aria-hidden="true" />
              {s.label}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
