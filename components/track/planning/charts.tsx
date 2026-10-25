'use client';

import { useId, useState } from 'react';

/** Paleta categórica de los segmentos: los colores de las apps (tokens globales). */
export const SERIES = ['var(--c-link)', 'var(--c-track)', 'var(--c-cal)', 'var(--c-crm)', 'var(--c-chat)', 'var(--c-flow)', 'var(--c-notes)', 'var(--c-board)'];

export interface BarDatum {
  key: string;
  label: string;
  value: number;
  segments?: Array<{ key: string; value: number }>;
}

const W = 640;
const H = 240;
const PAD = { l: 40, r: 8, t: 12, b: 44 };

function niceMax(v: number): number {
  if (v <= 0) return 1;
  const p = 10 ** Math.floor(Math.log10(v));
  const n = v / p;
  return (n <= 1 ? 1 : n <= 2 ? 2 : n <= 5 ? 5 : 10) * p;
}

const fmt = (n: number) => (Number.isInteger(n) ? String(n) : n.toFixed(1));

/**
 * Barras (apiladas si hay segmentos) en SVG. Clic en una barra la elige
 * (onSelect) para ver sus issues; con teclado, cada barra es un botón.
 */
export function BarChart({
  data,
  segmentKeys,
  selected,
  onSelect,
  label,
  unit,
}: {
  data: BarDatum[];
  segmentKeys: Array<{ key: string; label: string }>;
  selected?: string | null;
  onSelect?: (key: string) => void;
  label: string;
  unit: string;
}) {
  const [hover, setHover] = useState<string | null>(null);
  const max = niceMax(Math.max(0, ...data.map((d) => d.value)));
  const innerW = W - PAD.l - PAD.r;
  const innerH = H - PAD.t - PAD.b;
  const slot = innerW / Math.max(1, data.length);
  const bw = Math.max(4, Math.min(48, slot * 0.7));
  const y = (v: number) => PAD.t + innerH - (v / max) * innerH;
  const ticks = [0, max / 2, max];
  const segColor = (k: string) => SERIES[Math.max(0, segmentKeys.findIndex((s) => s.key === k)) % SERIES.length];
  const showEvery = Math.ceil(data.length / 12);
  return (
    <figure className="tp-chart">
      <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label={label} className="tp-chart-svg">
        {ticks.map((v) => (
          <g key={v}>
            <line className="chart-grid" x1={PAD.l} x2={W - PAD.r} y1={y(v)} y2={y(v)} />
            <text className="chart-ylabel" x={PAD.l - 6} y={y(v) + 3} textAnchor="end">
              {fmt(v)}
            </text>
          </g>
        ))}
        {data.map((d, i) => {
          const x = PAD.l + slot * i + (slot - bw) / 2;
          const on = selected === d.key || hover === d.key;
          let acc = 0;
          const segs = d.segments?.length ? d.segments : [{ key: '__all', value: d.value }];
          return (
            <g
              key={d.key}
              className={`tp-bar-g${on ? ' on' : ''}`}
              onMouseEnter={() => setHover(d.key)}
              onMouseLeave={() => setHover(null)}
              onClick={() => onSelect?.(d.key)}
            >
              <title>{`${d.label || '—'}: ${fmt(d.value)} ${unit}`}</title>
              <rect x={PAD.l + slot * i} y={PAD.t} width={slot} height={innerH} fill="transparent" />
              {segs.map((s) => {
                const h = (s.value / max) * innerH;
                const yy = PAD.t + innerH - acc - h;
                acc += h;
                return (
                  <rect
                    key={s.key}
                    x={x}
                    y={yy}
                    width={bw}
                    height={Math.max(0, h)}
                    className={s.key === '__all' ? 'chart-bar' : undefined}
                    style={s.key === '__all' ? undefined : { fill: segColor(s.key) }}
                  />
                );
              })}
              {i % showEvery === 0 && (
                <text className="chart-xlabel" x={x + bw / 2} y={H - PAD.b + 14} textAnchor="end" transform={`rotate(-30 ${x + bw / 2} ${H - PAD.b + 14})`}>
                  {(d.label || '—').slice(0, 14)}
                </text>
              )}
            </g>
          );
        })}
      </svg>
      {segmentKeys.length > 0 && <Legend items={segmentKeys.map((s, i) => ({ label: s.label || '—', color: SERIES[i % SERIES.length] }))} />}
      {onSelect && (
        <div className="sr-only">
          {data.map((d) => (
            <button key={d.key} type="button" onClick={() => onSelect(d.key)}>
              {`${d.label || '—'}: ${fmt(d.value)} ${unit}`}
            </button>
          ))}
        </div>
      )}
    </figure>
  );
}

export function Legend({ items }: { items: Array<{ label: string; color: string; dashed?: boolean }> }) {
  return (
    <figcaption className="tp-legend">
      {items.map((it) => (
        <span key={it.label} className="tp-legend-item">
          <span className={`tp-legend-swatch${it.dashed ? ' dashed' : ''}`} style={{ background: it.dashed ? 'transparent' : it.color, borderColor: it.color }} />
          {it.label}
        </span>
      ))}
    </figcaption>
  );
}

export interface LineSeries {
  key: string;
  label: string;
  color: string;
  values: number[];
  area?: boolean;
  dashed?: boolean;
}

/** Líneas acumuladas (burn-up): alcance, empezados y terminados. */
export function LineChart({ labels, series, label }: { labels: string[]; series: LineSeries[]; label: string }) {
  const id = useId();
  const max = niceMax(Math.max(0, ...series.flatMap((s) => s.values)));
  const innerW = W - PAD.l - PAD.r;
  const innerH = H - PAD.t - PAD.b;
  const n = Math.max(1, labels.length - 1);
  const x = (i: number) => PAD.l + (labels.length <= 1 ? innerW / 2 : (innerW * i) / n);
  const y = (v: number) => PAD.t + innerH - (v / max) * innerH;
  const ticks = [0, max / 2, max];
  const showEvery = Math.ceil(labels.length / 10);
  return (
    <figure className="tp-chart">
      <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label={label} className="tp-chart-svg">
        {ticks.map((v) => (
          <g key={v}>
            <line className="chart-grid" x1={PAD.l} x2={W - PAD.r} y1={y(v)} y2={y(v)} />
            <text className="chart-ylabel" x={PAD.l - 6} y={y(v) + 3} textAnchor="end">
              {fmt(v)}
            </text>
          </g>
        ))}
        {series.map((s) => {
          const pts = s.values.map((v, i) => `${x(i)},${y(v)}`).join(' ');
          return (
            <g key={s.key}>
              {s.area && s.values.length > 0 && (
                <polygon points={`${x(0)},${y(0)} ${pts} ${x(s.values.length - 1)},${y(0)}`} style={{ fill: s.color, opacity: 0.14 }} />
              )}
              <polyline
                points={pts}
                fill="none"
                style={{ stroke: s.color }}
                strokeWidth={2}
                strokeDasharray={s.dashed ? '5 4' : undefined}
                strokeLinejoin="round"
                vectorEffect="non-scaling-stroke"
              />
            </g>
          );
        })}
        {labels.map((l, i) =>
          i % showEvery === 0 ? (
            <text key={`${id}-${l}`} className="chart-xlabel" x={x(i)} y={H - PAD.b + 16} textAnchor="middle">
              {l}
            </text>
          ) : null,
        )}
      </svg>
      <Legend items={series.map((s) => ({ label: s.label, color: s.color, dashed: s.dashed }))} />
    </figure>
  );
}
