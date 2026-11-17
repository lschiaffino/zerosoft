'use client';

import { useEffect, useRef, useState, type KeyboardEvent, type PointerEvent } from 'react';
import { useTranslations } from 'next-intl';
import { fmtClock } from '@/lib/rec-schema';

interface Props {
  /** % de espectadores que vio cada tramo. */
  retention: number[];
  /** Reproducciones de cada tramo, con re-vistas. */
  plays: number[];
  unique: number;
  /** Duración visible en segundos. */
  duration: number;
  /** Tramos re-vistos (rewatchPeaks). */
  peaks: number[];
  summary: string;
}

const FALLBACK_W = 640;

/**
 * Retención como Loom o Wistia: área con el % de espectadores en cada momento
 * y, punteada, las reproducciones (con re-vistas) en % de espectadores, así
 * un pico arriba de la curva es una parte que se volvió a ver. Al pasar el
 * mouse (o con las flechas) muestra el minuto, el % y las reproducciones.
 */
export default function RecRetentionChart({ retention, plays, unique, duration, peaks, summary }: Props) {
  const t = useTranslations('rec.insights');
  const wrap = useRef<HTMLDivElement>(null);
  const [w, setW] = useState<number | null>(null);
  const [hover, setHover] = useState<number | null>(null);

  useEffect(() => {
    const el = wrap.current;
    if (!el) return;
    const measure = () => {
      const r = el.getBoundingClientRect();
      if (r.width > 0) setW((prev) => (prev === Math.round(r.width) ? prev : Math.round(r.width)));
    };
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const W = w ?? FALLBACK_W;
  const H = W < 480 ? 180 : 220;
  const pad = { t: 12, r: 12, b: 26, l: 40 };
  const iw = Math.max(W - pad.l - pad.r, 1);
  const ih = Math.max(H - pad.t - pad.b, 1);
  const n = retention.length;
  const playsPct = plays.map((p) => (unique ? (p / unique) * 100 : 0));
  const showPlays = playsPct.some((p, i) => p > (retention[i] ?? 0) + 0.5);
  // Con re-vistas la escala puede pasar el 100 %, hasta 300 %.
  const top = showPlays ? Math.min(300, Math.max(100, Math.ceil(Math.max(...playsPct) / 50) * 50)) : 100;
  const step = top <= 150 ? 50 : 100;
  const ticks = Array.from({ length: Math.floor(top / step) + 1 }, (_, i) => i * step);
  if (ticks[ticks.length - 1] !== top) ticks.push(top);
  const x = (i: number) => pad.l + (n > 1 ? (i / (n - 1)) * iw : iw / 2);
  const y = (v: number) => pad.t + ih - (Math.min(v, top) / top) * ih;
  const pts = (vals: number[]) => vals.map((v, i) => `${x(i).toFixed(1)},${y(v).toFixed(1)}`).join(' ');
  const base = pad.t + ih;
  const area = n ? `${pad.l},${base} ${pts(retention)} ${x(n - 1).toFixed(1)},${base}` : '';
  const at = (i: number) => fmtClock(duration > 0 && n ? ((i + 0.5) / n) * duration : 0);
  const peakSet = new Set(peaks);

  const pick = (e: PointerEvent<SVGSVGElement>) => {
    const r = e.currentTarget.getBoundingClientRect();
    const px = ((e.clientX - r.left) / r.width) * W;
    const i = Math.round(((px - pad.l) / iw) * (n - 1));
    setHover(Math.max(0, Math.min(n - 1, i)));
  };
  const onKey = (e: KeyboardEvent<HTMLDivElement>) => {
    if (!n) return;
    const step = e.shiftKey ? 5 : 1;
    if (e.key === 'ArrowRight') setHover((h) => Math.min(n - 1, (h ?? -1) + step));
    else if (e.key === 'ArrowLeft') setHover((h) => Math.max(0, (h ?? n) - step));
    else if (e.key === 'Home') setHover(0);
    else if (e.key === 'End') setHover(n - 1);
    else if (e.key === 'Escape') setHover(null);
    else return;
    e.preventDefault();
  };

  const tipLeft = hover === null ? 0 : Math.min(Math.max(x(hover), 70), W - 70);

  return (
    <div className="rec-ret">
      <div
        ref={wrap}
        className="rec-ret-wrap"
        tabIndex={0}
        role="group"
        aria-label={summary}
        onKeyDown={onKey}
        onBlur={() => setHover(null)}
        data-testid="rec-retention-chart"
      >
        <svg width={w ? W : undefined} height={H} viewBox={`0 0 ${W} ${H}`} className="rec-ret-svg" aria-hidden="true" onPointerMove={pick} onPointerDown={pick} onPointerLeave={() => setHover(null)}>
          {ticks.map((v) => (
            <g key={v}>
              <line className="chart-grid" x1={pad.l} x2={pad.l + iw} y1={y(v)} y2={y(v)} />
              <text className="chart-ylabel" x={pad.l - 6} y={y(v) + 4} textAnchor="end">
                {v}%
              </text>
            </g>
          ))}
          {n > 0 && (
            <>
              <polygon className="rec-ret-area" points={area} />
              <polyline className="rec-ret-line" points={pts(retention)} fill="none" />
              {showPlays && <polyline className="rec-ret-plays" points={pts(playsPct)} fill="none" />}
              {peaks.map((i) => (
                <circle key={i} className="rec-ret-peak" cx={x(i)} cy={y(playsPct[i])} r={3} />
              ))}
            </>
          )}
          {hover !== null && (
            <g>
              <line className="rec-ret-guide" x1={x(hover)} x2={x(hover)} y1={pad.t} y2={base} />
              <circle className="rec-ret-dot" cx={x(hover)} cy={y(retention[hover])} r={4} />
            </g>
          )}
          <text className="chart-xlabel" x={pad.l} y={H - 6} textAnchor="start">
            0:00
          </text>
          {W >= 360 && (
            <text className="chart-xlabel" x={pad.l + iw / 2} y={H - 6} textAnchor="middle">
              {fmtClock(duration / 2)}
            </text>
          )}
          <text className="chart-xlabel" x={pad.l + iw} y={H - 6} textAnchor="end">
            {fmtClock(duration)}
          </text>
        </svg>
        {hover !== null && (
          <div className="rec-ret-tip" style={{ left: tipLeft }} data-testid="rec-retention-tip">
            <strong className="data">{at(hover)}</strong>
            <span>{t('tipViewers', { pct: retention[hover] })}</span>
            <span>{t('tipPlays', { plays: Math.round(plays[hover] ?? 0) })}</span>
            {peakSet.has(hover) && <span className="rec-ret-tip-flag">{t('rewatched')}</span>}
          </div>
        )}
      </div>
      <div className="rec-ret-legend muted">
        <span>
          <i className="rec-ret-key area" aria-hidden="true" />
          {t('retentionLegend')}
        </span>
        {showPlays && (
          <span>
            <i className="rec-ret-key plays" aria-hidden="true" />
            {t('playsLegend')}
          </span>
        )}
      </div>
    </div>
  );
}
