'use client';

import { useEffect, useLayoutEffect, useRef, useState, type CSSProperties } from 'react';
import { useRouter } from 'next/navigation';
import { chartTicks } from '@/lib/chart-ticks';
import { ANALYTICS_TZ_COOKIE as TZ_COOKIE } from '@/lib/groups-analytics-shared';

/**
 * Lines, reportes: lo que necesita el navegador. El número que cuenta, el
 * gráfico de líneas o barras (SVG a mano, al ancho real del contenedor) y la
 * zona horaria de quien mira. Las animaciones son de CSS
 * (styles/lines-analytics.css) y se apagan con prefers-reduced-motion.
 */

const useBeforePaint = typeof window === 'undefined' ? useEffect : useLayoutEffect;

function prefersReducedMotion(): boolean {
  return typeof window !== 'undefined' && typeof window.matchMedia === 'function' && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
}

/** Un número que cuenta desde cero al aparecer. El servidor ya manda el valor final. */
export function CountUp({ value, locale, decimals = 0 }: { value: number; locale: string; decimals?: number }) {
  const [shown, setShown] = useState(value);
  useBeforePaint(() => {
    if (!Number.isFinite(value) || value === 0 || prefersReducedMotion()) {
      setShown(value);
      return;
    }
    const duration = 700;
    const start = performance.now();
    let raf = 0;
    setShown(0);
    const step = (now: number) => {
      const p = Math.min(1, (now - start) / duration);
      setShown(p < 1 ? value * (1 - Math.pow(1 - p, 3)) : value);
      if (p < 1) raf = requestAnimationFrame(step);
    };
    raf = requestAnimationFrame(step);
    // Con la pestaña en segundo plano no hay cuadros: el valor final llega igual.
    const done = window.setTimeout(() => setShown(value), duration + 300);
    return () => {
      cancelAnimationFrame(raf);
      window.clearTimeout(done);
    };
  }, [value]);
  const text = new Intl.NumberFormat(locale, { minimumFractionDigits: 0, maximumFractionDigits: decimals }).format(decimals ? Math.round(shown * 10 ** decimals) / 10 ** decimals : Math.round(shown));
  return (
    <span className="la-num" data-value={value}>
      {text}
    </span>
  );
}

export interface TrendSeries {
  name: string;
  /** null: sin dato ese día (la línea se corta). */
  values: Array<number | null>;
  /** El período anterior, alineado por posición: línea punteada. */
  compare?: Array<number | null>;
}

const FALLBACK_W = 720;

/** Tramos seguidos de puntos con dato. */
function runs(values: Array<number | null>): Array<Array<[number, number]>> {
  const out: Array<Array<[number, number]>> = [];
  let cur: Array<[number, number]> = [];
  values.forEach((v, i) => {
    if (v == null || !Number.isFinite(v)) {
      if (cur.length) out.push(cur);
      cur = [];
    } else {
      cur.push([i, v]);
    }
  });
  if (cur.length) out.push(cur);
  return out;
}

/**
 * Líneas (con área en la primera serie y el período anterior punteado) o
 * barras apiladas. Al pasar el mouse o tocar, el detalle del punto.
 */
export function TrendChart({
  labels,
  series,
  kind = 'line',
  height = 240,
  summary,
  locale,
  unit = '',
  compareLabel,
}: {
  labels: string[];
  series: TrendSeries[];
  kind?: 'line' | 'bars';
  height?: number;
  /** Resumen para lectores de pantalla. */
  summary: string;
  locale: string;
  /** Unidad que acompaña al valor en el detalle (por ejemplo "min"). */
  unit?: string;
  compareLabel?: string;
}) {
  const wrapRef = useRef<HTMLDivElement>(null);
  const [w, setW] = useState<number | null>(null);
  const [hover, setHover] = useState<number | null>(null);

  useEffect(() => {
    const el = wrapRef.current;
    if (!el) return;
    const measure = () => {
      const width = Math.round(el.getBoundingClientRect().width);
      if (width > 0) setW((prev) => (prev === width ? prev : width));
    };
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const W = w ?? FALLBACK_W;
  const H = height;
  const n = labels.length;
  const narrow = W < 520;
  const pad = { t: 10, r: 8, b: 24, l: narrow ? 30 : 40 };
  const iw = Math.max(W - pad.l - pad.r, 1);
  const ih = Math.max(H - pad.t - pad.b, 1);
  const stacked = kind === 'bars';
  const num = (v: number | null | undefined) => (v != null && Number.isFinite(v) ? v : 0);
  const max = stacked
    ? Math.max(0, ...labels.map((_, i) => series.reduce((a, s) => a + Math.max(0, num(s.values[i])), 0)))
    : Math.max(0, ...series.flatMap((s) => [...s.values, ...(s.compare ?? [])].map(num)));
  const { top, ticks } = chartTicks(max);
  const y = (v: number) => pad.t + ih - (Math.max(0, v) / top) * ih;
  const stepX = stacked ? iw / Math.max(n, 1) : n > 1 ? iw / (n - 1) : 0;
  const x = (i: number) => (stacked ? pad.l + stepX * i + stepX / 2 : n > 1 ? pad.l + stepX * i : pad.l + iw / 2);
  const barW = Math.max(1, Math.min(28, stepX * 0.72));
  const every = Math.max(1, Math.ceil(n / (narrow ? 4 : 8)));
  const xTicks = n ? [...new Set([...Array.from({ length: n }, (_, i) => i).filter((i) => i % every === 0 && (i === 0 || n - 1 - i >= Math.ceil(every * 0.7))), n - 1])] : [];
  const fmtAxis = (v: number) => (v >= 10_000 ? `${Math.round(v / 1000)}k` : String(v));
  const fmt = new Intl.NumberFormat(locale, { maximumFractionDigits: 1 });
  const tip = (v: number | null | undefined) => (v == null || !Number.isFinite(v) ? '—' : `${fmt.format(v)}${unit ? ` ${unit}` : ''}`);
  const baseY = y(0);
  const hasCompare = series.some((s) => s.compare?.some((v) => v != null));
  // El escalonado de las barras entra siempre en ~400 ms, haya 7 o 366.
  const stepMs = Math.max(1, Math.min(14, Math.round(400 / Math.max(n, 1))));
  const pick = (i: number) => setHover(i);

  return (
    <div className="la-chart">
      <div ref={wrapRef} className="la-chart-wrap" style={{ height: H }} onMouseLeave={() => setHover(null)}>
        <svg width={w ? W : undefined} height={H} viewBox={`0 0 ${W} ${H}`} role="img" aria-label={summary} preserveAspectRatio="xMinYMid meet">
          {ticks.map((v) => (
            <g key={v}>
              <line className="la-grid-line" x1={pad.l} x2={pad.l + iw} y1={y(v)} y2={y(v)} />
              <text className="la-axis" x={pad.l - 6} y={y(v) + 4} textAnchor="end">
                {fmtAxis(v)}
              </text>
            </g>
          ))}
          {kind === 'line' &&
            series.map((s, si) => (
              <g key={si} className={`la-s${si % 3}`}>
                {si === 0 &&
                  runs(s.values)
                    .filter((r) => r.length > 1)
                    .map((r, ri) => (
                      <polygon key={`a${ri}`} className="la-area" points={`${x(r[0][0])},${baseY} ${r.map(([i, v]) => `${x(i)},${y(v)}`).join(' ')} ${x(r[r.length - 1][0])},${baseY}`} />
                    ))}
                {s.compare &&
                  runs(s.compare)
                    .filter((r) => r.length > 1)
                    .map((r, ri) => <polyline key={`c${ri}`} className="la-line-compare" points={r.map(([i, v]) => `${x(i)},${y(v)}`).join(' ')} />)}
                {runs(s.values).map((r, ri) =>
                  r.length > 1 ? (
                    <polyline key={`l${ri}`} className="la-line" pathLength={1} points={r.map(([i, v]) => `${x(i)},${y(v)}`).join(' ')} />
                  ) : (
                    <circle key={`d${ri}`} className="la-dot" cx={x(r[0][0])} cy={y(r[0][1])} r={3} />
                  ),
                )}
              </g>
            ))}
          {kind === 'bars' &&
            series.map((s, si) => (
              <g key={si} className={`la-s${si % 3}`} style={{ '--la-step': `${stepMs}ms` } as CSSProperties}>
                {s.values.map((v, i) => {
                  const below = series.slice(0, si).reduce((a, o) => a + Math.max(0, num(o.values[i])), 0);
                  const topY = y(below + Math.max(0, num(v)));
                  const h = Math.max(0, y(below) - topY);
                  return h > 0 ? <rect key={i} className="la-bar" style={{ '--i': i } as CSSProperties} x={x(i) - barW / 2} y={topY} width={barW} height={h} /> : null;
                })}
              </g>
            ))}
          {hover !== null && n > 0 && <line className="la-hover-line" x1={x(hover)} x2={x(hover)} y1={pad.t} y2={pad.t + ih} />}
          {hover !== null &&
            kind === 'line' &&
            series.map((s, si) => {
              const v = s.values[hover];
              return v == null ? null : (
                <g key={`h${si}`} className={`la-s${si % 3}`}>
                  <circle cx={x(hover)} cy={y(v)} r={3.5} fill="var(--la-c)" />
                </g>
              );
            })}
          {xTicks.map((i) => (
            <text key={i} className="la-axis" x={x(i)} y={H - 6} textAnchor={stacked ? 'middle' : i === 0 ? 'start' : i === n - 1 ? 'end' : 'middle'}>
              {labels[i]}
            </text>
          ))}
          {labels.map((_, i) => (
            <rect
              key={`z${i}`}
              x={stacked ? pad.l + stepX * i : x(i) - (stepX || iw) / 2}
              y={pad.t}
              width={stepX || iw}
              height={ih}
              fill="transparent"
              onMouseEnter={() => pick(i)}
              onPointerDown={() => pick(i)}
            />
          ))}
        </svg>
        {hover !== null && n > 0 && (
          <div className="la-tooltip" style={{ left: Math.min(Math.max(x(hover), 84), Math.max(84, W - 84)) }} role="presentation">
            <strong>{labels[hover]}</strong>
            {series.map((s, si) => (
              <span key={si} className={`la-tip-row la-s${si % 3}`}>
                <i className="la-swatch" aria-hidden="true" />
                {s.name}: {tip(s.values[hover])}
                {s.compare ? ` (${tip(s.compare[hover])})` : ''}
              </span>
            ))}
          </div>
        )}
      </div>
      {(series.length > 1 || hasCompare) && (
        <ul className="la-legend" role="list">
          {series.map((s, si) => (
            <li key={si} className={`la-s${si % 3}`}>
              <i className="la-swatch" aria-hidden="true" />
              {s.name}
            </li>
          ))}
          {hasCompare && compareLabel && (
            <li>
              <i className="la-legend-compare" aria-hidden="true" />
              {compareLabel}
            </li>
          )}
        </ul>
      )}
    </div>
  );
}

/**
 * Guarda la zona horaria del navegador en una cookie para que el servidor
 * arme los días y las horas en hora local. Si el reporte se armó con otra
 * zona, se pide de nuevo una sola vez.
 */
export function TimeZoneSync({ serverTz }: { serverTz: string }) {
  const router = useRouter();
  useEffect(() => {
    let tz = '';
    try {
      tz = Intl.DateTimeFormat().resolvedOptions().timeZone ?? '';
    } catch {
      tz = '';
    }
    if (!tz || tz === serverTz) return;
    const had = document.cookie.split('; ').find((c) => c.startsWith(`${TZ_COOKIE}=`));
    const value = encodeURIComponent(tz);
    if (had === `${TZ_COOKIE}=${value}`) return;
    document.cookie = `${TZ_COOKIE}=${value}; path=/; max-age=31536000; samesite=lax`;
    router.refresh();
  }, [router, serverTz]);
  return null;
}
