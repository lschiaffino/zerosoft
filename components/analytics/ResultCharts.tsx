'use client';

import { useLocale, useTranslations } from 'next-intl';
import type { LifecycleResult, PathsResult, StickinessResult } from '@/lib/analytics/types';
import Chart from './Chart';
import { bucketLabel, fmtNumber, fmtPercent } from './client';

/** Stickiness: cuánta gente estuvo activa N intervalos del rango. */
export function Stickiness({ r }: { r: StickinessResult }) {
  const t = useTranslations('analytics.result');
  const locale = useLocale();
  if (!r.series.some((s) => s.total > 0)) return <p className="an-empty-result">{t('noData')}</p>;
  const labels = Array.from({ length: r.intervals }, (_, i) => t(`stickyN.${r.interval}`, { n: i + 1 }));
  return (
    <div className="an-result">
      <Chart kind="bar" labels={labels} series={r.series.map((s) => ({ label: s.label, data: s.data }))} summary={t('stickySummary', { count: r.series[0].total })} />
      <div className="table-wrap">
        <table className="table table-compact an-table">
          <thead>
            <tr>
              <th scope="col">{t(`stickyHead.${r.interval}`)}</th>
              {r.series.map((s, i) => (
                <th key={i} scope="col" className="num">
                  {s.label}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {labels.map((l, n) =>
              r.series.every((s) => !s.data[n]) ? null : (
                <tr key={n}>
                  <th scope="row">{l}</th>
                  {r.series.map((s, i) => (
                    <td key={i} className="num">
                      {fmtNumber(s.data[n] ?? 0, locale)} <span className="an-muted">({fmtPercent(s.total ? (s.data[n] ?? 0) / s.total : 0, locale)})</span>
                    </td>
                  ))}
                </tr>
              ),
            )}
          </tbody>
        </table>
      </div>
      {r.truncated && <p className="an-note">{t('truncated')}</p>}
    </div>
  );
}

const LIFE = ['new', 'returning', 'resurrecting', 'dormant'] as const;

/** Ciclo de vida: barras apiladas hacia arriba (activos) y hacia abajo (los que se fueron). */
export function Lifecycle({ r }: { r: LifecycleResult }) {
  const t = useTranslations('analytics.result');
  const locale = useLocale();
  const n = r.buckets.length;
  const up = r.buckets.map((_, i) => r.new[i] + r.returning[i] + r.resurrecting[i]);
  const down = r.dormant.map((v) => -v);
  const maxUp = Math.max(1, ...up);
  const maxDown = Math.max(0, ...down);
  if (!up.some((v) => v > 0) && !down.some((v) => v > 0)) return <p className="an-empty-result">{t('noData')}</p>;
  const W = 760;
  const H = 260;
  const pad = { l: 8, r: 8, t: 8, b: 8 };
  const scale = (H - pad.t - pad.b) / (maxUp + maxDown);
  const zero = pad.t + maxUp * scale;
  const step = (W - pad.l - pad.r) / Math.max(n, 1);
  const bw = Math.max(2, step * 0.7);
  return (
    <div className="an-result">
      <div className="an-chart-wrap an-life-chart">
        <svg viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" role="img" aria-label={t('lifeSummary', { periods: n })}>
          {r.buckets.map((b, i) => {
            const x = pad.l + step * i + (step - bw) / 2;
            let y = zero;
            return (
              <g key={b}>
                {(['returning', 'resurrecting', 'new'] as const).map((k) => {
                  const h = r[k][i] * scale;
                  y -= h;
                  return (
                    <rect key={k} className={`an-life-${k}`} x={x} y={y} width={bw} height={Math.max(0, h)}>
                      <title>{`${bucketLabel(b, locale)} · ${t(`life.${k}`)}: ${r[k][i]}`}</title>
                    </rect>
                  );
                })}
                <rect className="an-life-dormant" x={x} y={zero} width={bw} height={Math.max(0, -r.dormant[i] * scale)}>
                  <title>{`${bucketLabel(b, locale)} · ${t('life.dormant')}: ${-r.dormant[i]}`}</title>
                </rect>
              </g>
            );
          })}
          <line className="chart-grid" x1={pad.l} x2={W - pad.r} y1={zero} y2={zero} />
        </svg>
      </div>
      <ul className="an-legend" role="list">
        {LIFE.map((k) => (
          <li key={k}>
            <i className={`an-swatch an-life-swatch-${k}`} aria-hidden="true" />
            {t(`life.${k}`)}
          </li>
        ))}
      </ul>
      <div className="table-wrap">
        <table className="table table-compact an-table">
          <thead>
            <tr>
              <th scope="col">{t('period')}</th>
              {LIFE.map((k) => (
                <th key={k} scope="col" className="num">
                  {t(`life.${k}`)}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {r.buckets.map((b, i) => (
              <tr key={b}>
                <th scope="row">{bucketLabel(b, locale)}</th>
                {LIFE.map((k) => (
                  <td key={k} className="num">
                    {fmtNumber(r[k][i], locale)}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {r.truncated && <p className="an-note">{t('truncated')}</p>}
    </div>
  );
}

/** Diagrama de flujo (Sankey) de los caminos: columnas por paso y bandas proporcionales a las sesiones. */
export function PathsSankey({ r }: { r: PathsResult }) {
  const t = useTranslations('analytics.result');
  const steps = [...new Set(r.links.map((l) => l.step))].sort((a, b) => a - b);
  if (!steps.length) return null;
  const COLS = steps.length + 1;
  const MAX_NODES = 7;
  const W = Math.max(640, COLS * 190);
  const H = 340;
  const NODE_W = 10;
  const colX = (c: number) => (COLS === 1 ? 0 : ((W - 150 - NODE_W) * c) / (COLS - 1));
  // Nodos de cada columna: los de más sesiones.
  const totals: Array<Map<string, number>> = Array.from({ length: COLS }, () => new Map());
  for (const l of r.links) {
    const c = steps.indexOf(l.step);
    totals[c].set(l.from, (totals[c].get(l.from) ?? 0) + l.count);
    totals[c + 1].set(l.to, (totals[c + 1].get(l.to) ?? 0) + l.count);
  }
  const positions = totals.map((m) => {
    const list = [...m.entries()].sort((a, b) => b[1] - a[1]).slice(0, MAX_NODES);
    return list;
  });
  const maxSum = Math.max(1, ...positions.map((p) => p.reduce((a, x) => a + x[1], 0)));
  const GAP = 14;
  const scale = (H - GAP * MAX_NODES) / maxSum;
  const place: Array<Map<string, { y: number; h: number; inY: number; outY: number }>> = positions.map((list) => {
    const m = new Map<string, { y: number; h: number; inY: number; outY: number }>();
    let y = 0;
    for (const [name, total] of list) {
      const h = Math.max(3, total * scale);
      m.set(name, { y, h, inY: y, outY: y });
      y += h + GAP;
    }
    return m;
  });
  const bands = r.links
    .map((l) => ({ l, c: steps.indexOf(l.step) }))
    .sort((a, b) => b.l.count - a.l.count)
    .flatMap(({ l, c }) => {
      const from = place[c].get(l.from);
      const to = place[c + 1].get(l.to);
      if (!from || !to) return [];
      const w = Math.max(1, l.count * scale);
      const y0 = from.outY + w / 2;
      const y1 = to.inY + w / 2;
      from.outY += w;
      to.inY += w;
      const x0 = colX(c) + NODE_W;
      const x1 = colX(c + 1);
      const mid = (x0 + x1) / 2;
      return [{ key: `${c}:${l.from}:${l.to}`, d: `M${x0} ${y0} C${mid} ${y0} ${mid} ${y1} ${x1} ${y1}`, w, label: `${l.from} → ${l.to}: ${l.count}` }];
    });
  return (
    <div className="an-sankey-wrap" role="group" aria-label={t('sankey')}>
      <svg className="an-sankey" width={W} height={H} viewBox={`0 0 ${W} ${H}`} role="img" aria-label={t('pathsSessions', { count: r.sessions })}>
        {bands.map((b) => (
          <path key={b.key} className="an-sankey-band" d={b.d} strokeWidth={b.w} fill="none">
            <title>{b.label}</title>
          </path>
        ))}
        {place.map((col, c) =>
          [...col.entries()].map(([name, p]) => (
            <g key={`${c}:${name}`}>
              <rect className="an-sankey-node" x={colX(c)} y={p.y} width={NODE_W} height={p.h} />
              <text className="an-sankey-label" x={colX(c) + NODE_W + 4} y={p.y + 10}>
                {name.length > 22 ? `${name.slice(0, 21)}…` : name}
                <title>{name}</title>
              </text>
            </g>
          )),
        )}
      </svg>
    </div>
  );
}
