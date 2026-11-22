'use client';

import { useLayoutEffect, useRef, useState, type KeyboardEvent, type ReactNode } from 'react';
import type { DrillSegment, TileResult, TileViz, ValueFormat } from '@/lib/crm-dashboard-library';

/**
 * Gráficos de los tiles de Dashboards (SVG y HTML, sin dependencias).
 *
 * Reglas (skill dataviz): una sola escala, barras finas con la punta
 * redondeada y la base recta, líneas de 2px, grilla de 1px recesiva, color
 * categórico en orden fijo (--rb-1…), el texto siempre en tokens de texto,
 * leyenda con dos series o más, tooltip al pasar o enfocar, y cada marca es
 * un botón que abre los registros (drill-down) con Enter o clic.
 */

type Chart = Extract<TileResult, { kind: 'chart' }>;

export interface ChartText {
  category: (key: string, label: string | null) => string;
  series: (key: string, label: string | null) => string;
  value: (n: number, format?: ValueFormat) => string;
  axis: (n: number, format?: ValueFormat) => string;
  extra: (n: number | null, kind: 'count' | 'conversion') => string | null;
  /** Nombre accesible de un segmento ("Negotiation, Won: 3"). */
  aria: (parts: string[]) => string;
  total: string;
}

interface Props {
  data: Chart;
  viz: TileViz;
  text: ChartText;
  onDrill: ((segment: DrillSegment) => void) | null;
  /** Para el nombre accesible del gráfico. */
  title: string;
}

/** Color de una serie por su posición (orden fijo; nunca se recicla: >6 cae en "otro"). */
function seriesClass(i: number, n: number): string {
  if (n === 1) return 'cdb-s0';
  return `cdb-s${Math.min(i + 1, 7)}`;
}

/** Won/lost y tipos de actividad tienen color fijo por identidad, no por rango. */
function seriesSlot(key: string, i: number, n: number): string {
  const fixed: Record<string, string> = { won: 'cdb-s2', lost: 'cdb-s3', call: 'cdb-s1', email: 'cdb-s4', meeting: 'cdb-s2', task: 'cdb-s3' };
  return fixed[key] ?? seriesClass(i, n);
}

function useWidth<T extends HTMLElement>(): [React.RefObject<T | null>, number] {
  const ref = useRef<T>(null);
  const [w, setW] = useState(0);
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    setW(el.clientWidth);
    const ro = new ResizeObserver(() => setW(el.clientWidth));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  return [ref, w];
}

function niceMax(max: number): number {
  if (max <= 0) return 1;
  const pow = Math.pow(10, Math.floor(Math.log10(max)));
  const n = max / pow;
  const nice = n <= 1 ? 1 : n <= 2 ? 2 : n <= 2.5 ? 2.5 : n <= 5 ? 5 : 10;
  return nice * pow;
}

function activate(e: KeyboardEvent, fn: () => void) {
  if (e.key === 'Enter' || e.key === ' ') {
    e.preventDefault();
    fn();
  }
}

interface Tip {
  x: number;
  y: number;
  title: string;
  rows: Array<{ cls: string; label: string; value: string }>;
}

function Tooltip({ tip }: { tip: Tip | null }) {
  if (!tip) return null;
  return (
    <div className="cdb-tip" style={{ left: tip.x, top: tip.y }} role="presentation">
      <div className="cdb-tip-title">{tip.title}</div>
      {tip.rows.map((r) => (
        <div key={r.label} className="cdb-tip-row">
          <span className={`cdb-key ${r.cls}`} aria-hidden />
          <span className="cdb-tip-label">{r.label}</span>
          <span className="cdb-tip-value">{r.value}</span>
        </div>
      ))}
    </div>
  );
}

function Legend({ data, text }: { data: Chart; text: ChartText }) {
  if (data.series.length < 2) return null;
  return (
    <ul className="cdb-legend">
      {data.series.map((s, i) => (
        <li key={s.key}>
          <span className={`cdb-key ${seriesSlot(s.key, i, data.series.length)}`} aria-hidden />
          {text.series(s.key, s.label)}
        </li>
      ))}
    </ul>
  );
}

// ---------- Columnas, líneas y áreas (eje de tiempo o pocas categorías) ----------

function Columns({ data, viz, text, onDrill, title }: Props) {
  const [ref, width] = useWidth<HTMLDivElement>();
  const [tip, setTip] = useState<Tip | null>(null);
  const [hover, setHover] = useState<number | null>(null);
  const H = 200;
  const pad = { t: 12, r: 8, b: 26, l: 44 };
  const W = Math.max(width, 200);
  const iw = W - pad.l - pad.r;
  const ih = H - pad.t - pad.b;
  const n = data.categories.length;
  const stacked = viz === 'stacked';
  const sums = data.categories.map((_c, i) =>
    stacked ? data.series.reduce((a, s) => a + Math.max(0, s.values[i]), 0) : Math.max(0, ...data.series.map((s) => s.values[i])),
  );
  const max = niceMax(Math.max(0, ...sums));
  const step = n ? iw / n : iw;
  const y = (v: number) => pad.t + ih - (v / max) * ih;
  const ticks = [0, 0.5, 1].map((k) => k * max);
  const labelEvery = Math.max(1, Math.ceil(54 / Math.max(step, 1)));
  const lineLike = viz === 'line' || viz === 'area';
  const grouped = !stacked && !lineLike && data.series.length > 1;
  const barW = Math.min(24, Math.max(3, (grouped ? step / (data.series.length + 1) : step * 0.6) - 2));

  const showTip = (i: number) => {
    const cx = pad.l + step * (i + 0.5);
    setHover(i);
    setTip({
      x: Math.min(Math.max(cx, 80), W - 80),
      y: Math.max(y(sums[i]) - 8, 0),
      title: text.category(data.categories[i].key, data.categories[i].label),
      rows: data.series.map((s, si) => ({ cls: seriesSlot(s.key, si, data.series.length), label: text.series(s.key, s.label), value: text.value(s.values[i], data.format) })),
    });
  };
  const hide = () => {
    setTip(null);
    setHover(null);
  };

  return (
    <div className="cdb-chart" ref={ref} onMouseLeave={hide}>
      {width > 0 && (
        <svg width={W} height={H} role="group" aria-label={title} className="cdb-svg">
          {ticks.map((v) => (
            <g key={v}>
              <line className="cdb-grid" x1={pad.l} x2={W - pad.r} y1={y(v)} y2={y(v)} />
              <text className="cdb-axis" x={pad.l - 6} y={y(v) + 4} textAnchor="end">
                {text.axis(v, data.format)}
              </text>
            </g>
          ))}
          {lineLike &&
            data.series.map((s, si) => {
              const pts = s.values.map((v, i) => [pad.l + step * (i + 0.5), y(Math.max(0, v))] as const);
              if (!pts.length) return null;
              const d = pts.map((p, i) => `${i ? 'L' : 'M'}${p[0].toFixed(1)},${p[1].toFixed(1)}`).join(' ');
              const cls = seriesSlot(s.key, si, data.series.length);
              return (
                <g key={s.key} className={cls}>
                  {viz === 'area' && (
                    <path className="cdb-area" d={`${d} L${pts[pts.length - 1][0].toFixed(1)},${y(0)} L${pts[0][0].toFixed(1)},${y(0)} Z`} />
                  )}
                  <path className="cdb-line" d={d} />
                  {pts.map((p, i) =>
                    hover === i || pts.length === 1 || i === pts.length - 1 ? <circle key={i} className="cdb-dot" cx={p[0]} cy={p[1]} r={4} /> : null,
                  )}
                </g>
              );
            })}
          {!lineLike &&
            data.categories.map((c, i) => {
              const cx = pad.l + step * (i + 0.5);
              let acc = 0;
              return (
                <g key={c.key}>
                  {data.series.map((s, si) => {
                    const v = Math.max(0, s.values[i]);
                    if (v <= 0) return null;
                    const cls = seriesSlot(s.key, si, data.series.length);
                    let x = cx - barW / 2;
                    let top = y(v);
                    let h = y(0) - y(v);
                    if (stacked) {
                      top = y(acc + v);
                      h = y(acc) - y(acc + v);
                      acc += v;
                      // 2px de superficie entre segmentos apilados.
                      if (acc !== v) h = Math.max(0, h - 2);
                    } else if (grouped) {
                      x = cx - (barW * data.series.length + 2 * (data.series.length - 1)) / 2 + si * (barW + 2);
                    }
                    const r = Math.min(3, barW / 2, h);
                    return (
                      <path
                        key={s.key}
                        className={`cdb-bar ${cls}${hover === i ? ' is-hover' : ''}`}
                        d={`M${x},${top + h} V${top + r} Q${x},${top} ${x + r},${top} H${x + barW - r} Q${x + barW},${top} ${x + barW},${top + r} V${top + h} Z`}
                      />
                    );
                  })}
                </g>
              );
            })}
          {data.categories.map((c, i) =>
            i % labelEvery === 0 ? (
              <text key={c.key} className="cdb-axis" x={pad.l + step * (i + 0.5)} y={H - 8} textAnchor="middle">
                {text.category(c.key, c.label)}
              </text>
            ) : null,
          )}
          {/* Áreas de toque (más grandes que la marca): tooltip y drill-down por categoría. */}
          {data.categories.map((c, i) => {
            const parts = [text.category(c.key, c.label), ...data.series.map((s) => `${text.series(s.key, s.label)}: ${text.value(s.values[i], data.format)}`)];
            return (
              <rect
                key={c.key}
                className="cdb-hit"
                x={pad.l + step * i}
                y={pad.t}
                width={step}
                height={ih}
                role={onDrill ? 'button' : 'img'}
                tabIndex={0}
                aria-label={text.aria(parts)}
                data-testid="cdb-mark"
                onMouseEnter={() => showTip(i)}
                onFocus={() => showTip(i)}
                onBlur={hide}
                onClick={onDrill ? () => onDrill({ category: c.key }) : undefined}
                onKeyDown={onDrill ? (e) => activate(e, () => onDrill({ category: c.key })) : undefined}
              />
            );
          })}
        </svg>
      )}
      <Tooltip tip={tip} />
      <Legend data={data} text={text} />
    </div>
  );
}

// ---------- Barras horizontales (etapas, personas, fuentes) ----------

function HBars({ data, viz, text, onDrill, title }: Props) {
  const stacked = viz === 'stacked';
  const totals = data.categories.map((_c, i) => data.series.reduce((a, s) => a + Math.max(0, s.values[i]), 0));
  const max = Math.max(0, ...(stacked ? totals : data.categories.map((_c, i) => Math.max(0, ...data.series.map((s) => s.values[i])))));
  return (
    <div className="cdb-hbars" role="group" aria-label={title}>
      {data.categories.map((c, i) => {
        const label = text.category(c.key, c.label);
        const value = stacked ? totals[i] : data.series[0]?.values[i] ?? 0;
        const extra = data.extra ? text.extra(data.extra.values[i], data.extra.label) : null;
        const parts = [label, ...data.series.map((s) => `${text.series(s.key, s.label)}: ${text.value(s.values[i], data.format)}`), ...(extra ? [extra] : [])];
        const row = (
          <>
            <span className="cdb-hbar-label" title={label}>
              {label}
            </span>
            <span className="cdb-hbar-track">
              {data.series.map((s, si) => {
                const v = Math.max(0, s.values[i]);
                if (!stacked && si > 0) return null;
                if (v <= 0) return null;
                return (
                  <span
                    key={s.key}
                    className={`cdb-hbar ${seriesSlot(s.key, si, stacked ? data.series.length : 1)}`}
                    style={{ width: `${max ? (v / max) * 100 : 0}%` }}
                    title={`${text.series(s.key, s.label)}: ${text.value(v, data.format)}`}
                  />
                );
              })}
            </span>
            <span className="cdb-hbar-value">
              {text.value(value, data.format)}
              {extra && <span className="cdb-hbar-extra">{extra}</span>}
            </span>
          </>
        );
        return onDrill ? (
          <button key={c.key} type="button" className="cdb-hbar-row" aria-label={text.aria(parts)} data-testid="cdb-mark" onClick={() => onDrill({ category: c.key })}>
            {row}
          </button>
        ) : (
          <div key={c.key} className="cdb-hbar-row" aria-label={text.aria(parts)} role="img">
            {row}
          </div>
        );
      })}
      {stacked && !onDrill && <Legend data={data} text={text} />}
      {stacked && onDrill && data.series.length > 1 && (
        <div className="cdb-series-drill">
          {data.series.map((s, si) => (
            <button key={s.key} type="button" className="cdb-link" onClick={() => onDrill({ series: s.key })}>
              <span className={`cdb-key ${seriesSlot(s.key, si, data.series.length)}`} aria-hidden />
              {text.series(s.key, s.label)} · {text.value(s.values.reduce((a, b) => a + b, 0), data.format)}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

// ---------- Embudo ----------

function Funnel({ data, text, onDrill, title }: Props) {
  const vals = data.series[0]?.values ?? [];
  const max = Math.max(1, ...vals);
  return (
    <ol className="cdb-funnel" aria-label={title}>
      {data.categories.map((c, i) => {
        const label = text.category(c.key, c.label);
        const conv = data.extra ? text.extra(data.extra.values[i], 'conversion') : null;
        const inner = (
          <>
            <span className="cdb-funnel-label">{label}</span>
            <span className="cdb-funnel-track">
              <span className="cdb-funnel-bar cdb-s0" style={{ width: `${Math.max((vals[i] / max) * 100, vals[i] > 0 ? 2 : 0)}%` }} />
            </span>
            <span className="cdb-funnel-value">
              {text.value(vals[i], data.format)}
              {conv && <span className="cdb-hbar-extra">{conv}</span>}
            </span>
          </>
        );
        return (
          <li key={c.key}>
            {onDrill ? (
              <button type="button" className="cdb-funnel-row" data-testid="cdb-mark" aria-label={text.aria([label, text.value(vals[i], data.format), ...(conv ? [conv] : [])])} onClick={() => onDrill({ category: c.key })}>
                {inner}
              </button>
            ) : (
              <div className="cdb-funnel-row">{inner}</div>
            )}
          </li>
        );
      })}
    </ol>
  );
}

// ---------- Dona (partes de un todo, pocas categorías) ----------

function Donut({ data, text, onDrill, title }: Props) {
  const vals = data.series[0]?.values ?? [];
  const total = vals.reduce((a, b) => a + Math.max(0, b), 0);
  // Más de 6 partes: el resto se junta en "otro" (no se generan colores nuevos).
  const top = data.categories.slice(0, 6).map((c, i) => ({ c, v: vals[i] }));
  const restV = vals.slice(6).reduce((a, b) => a + b, 0);
  const R = 64;
  const r = 42;
  let a0 = -Math.PI / 2;
  const arc = (v: number) => {
    const a1 = a0 + (total ? (v / total) * Math.PI * 2 : 0);
    const large = a1 - a0 > Math.PI ? 1 : 0;
    const p = (ang: number, rad: number) => `${(80 + rad * Math.cos(ang)).toFixed(2)},${(80 + rad * Math.sin(ang)).toFixed(2)}`;
    const d = `M${p(a0, R)} A${R},${R} 0 ${large} 1 ${p(a1 - 0.0001, R)} L${p(a1 - 0.0001, r)} A${r},${r} 0 ${large} 0 ${p(a0, r)} Z`;
    a0 = a1;
    return d;
  };
  // Si "otro" ya es una de las partes, el resto se suma ahí (no dos filas "Otro").
  const own = top.find((p) => p.c.key === 'other');
  const parts =
    own && restV > 0
      ? top.map((p) => (p === own ? { ...p, v: p.v + restV } : p))
      : [...top, ...(restV > 0 ? [{ c: { key: '__other', label: null as string | null }, v: restV }] : [])];
  return (
    <div className="cdb-donut">
      <svg viewBox="0 0 160 160" width={160} height={160} role="img" aria-label={title} className="cdb-donut-svg">
        {total > 0 && parts.map((p, i) => (p.v > 0 ? <path key={p.c.key} className={`cdb-slice cdb-s${i < 6 ? i + 1 : 7}`} d={arc(p.v)} /> : null))}
        <text x={80} y={78} textAnchor="middle" className="cdb-donut-total">
          {text.value(total, data.format)}
        </text>
        <text x={80} y={96} textAnchor="middle" className="cdb-axis">
          {text.total}
        </text>
      </svg>
      <ul className="cdb-donut-legend">
        {parts.map((p, i) => {
          const label = p.c.key === '__other' ? text.category('other', null) : text.category(p.c.key, p.c.label);
          const pct = total ? Math.round((p.v / total) * 100) : 0;
          const inner = (
            <>
              <span className={`cdb-key cdb-s${i < 6 ? i + 1 : 7}`} aria-hidden />
              <span className="cdb-donut-label">{label}</span>
              <span className="cdb-donut-value">
                {text.value(p.v, data.format)} · {pct}%
              </span>
            </>
          );
          return (
            <li key={p.c.key}>
              {onDrill && p.c.key !== '__other' ? (
                <button type="button" className="cdb-donut-row" data-testid="cdb-mark" onClick={() => onDrill({ category: p.c.key })}>
                  {inner}
                </button>
              ) : (
                <div className="cdb-donut-row">{inner}</div>
              )}
            </li>
          );
        })}
      </ul>
    </div>
  );
}

// ---------- Tabla (también la vista "ver como tabla" de cualquier gráfico) ----------

export function ChartTable({ data, text, onDrill }: Omit<Props, 'viz' | 'title'>) {
  const showSeries = data.series.length > 1;
  return (
    <div className="cdb-table-wrap">
      <table className="table cdb-table">
        <thead>
          <tr>
            <th scope="col" />
            {data.series.map((s) => (
              <th key={s.key} scope="col" className="num">
                {showSeries ? text.series(s.key, s.label) : text.total}
              </th>
            ))}
            {data.extra && <th scope="col" className="num" />}
          </tr>
        </thead>
        <tbody>
          {data.categories.map((c, i) => (
            <tr key={c.key}>
              <th scope="row">
                {onDrill ? (
                  <button type="button" className="cdb-link" onClick={() => onDrill({ category: c.key })}>
                    {text.category(c.key, c.label)}
                  </button>
                ) : (
                  text.category(c.key, c.label)
                )}
              </th>
              {data.series.map((s) => (
                <td key={s.key} className="num">
                  {text.value(s.values[i], data.format)}
                </td>
              ))}
              {data.extra && <td className="num cdb-muted">{text.extra(data.extra.values[i], data.extra.label) ?? ''}</td>}
            </tr>
          ))}
        </tbody>
        {data.total !== null && data.series.length > 0 && (
          <tfoot>
            <tr>
              <th scope="row">{text.total}</th>
              <td className="num" colSpan={data.series.length + (data.extra ? 1 : 0)}>
                {text.value(data.total, data.format)}
              </td>
            </tr>
          </tfoot>
        )}
      </table>
    </div>
  );
}

export default function DashChart(props: Props): ReactNode {
  const { viz, data } = props;
  if (viz === 'table') return <ChartTable data={data} text={props.text} onDrill={props.onDrill} />;
  if (viz === 'funnel') return <Funnel {...props} />;
  if (viz === 'donut') return <Donut {...props} />;
  if (viz === 'hbar') return <HBars {...props} />;
  // Apiladas: con categorías de tiempo, columnas; con personas, barras horizontales (los nombres se leen).
  if (viz === 'stacked' && data.categoryKind !== 'bucket') return <HBars {...props} />;
  return <Columns {...props} />;
}
