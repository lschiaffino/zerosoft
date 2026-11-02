'use client';

import { useState } from 'react';
import { useLocale, useTranslations } from 'next-intl';
import { Link } from '@/i18n/navigation';
import type { FunnelPathMode, FunnelQuery, FunnelResult, InsightQuery, InsightResult, PathsResult, RetentionResult, SqlResult, TrendDisplay, TrendsResult } from '@/lib/analytics/types';
import { retentionMean, retentionRate } from '@/lib/analytics/retention-view';
import { formatTrendValue } from '@/lib/analytics/trend-core';
import Chart from './Chart';
import { Lifecycle, PathsSankey, Stickiness } from './ResultCharts';
import { bucketLabel, delta, fmtDuration, fmtNumber, fmtPercent } from './client';

function seriesName(s: { label: string; breakdownValue: string | null }, other: string, none: string): string {
  if (s.breakdownValue === null) return s.label;
  const v = s.breakdownValue === '$other' ? other : s.breakdownValue === '(none)' ? none : s.breakdownValue;
  return `${s.label} · ${v}`;
}

/** Suma acumulada, para la vista "Acumulado". */
const running = (data: number[]) => {
  let acc = 0;
  return data.map((v) => Math.round((acc += v) * 100) / 100);
};

/** Torta o anillo de los totales, con la leyenda al lado. */
function Pie({ items, summary, donut, format }: { items: Array<{ label: string; value: number; color: number }>; summary: string; donut?: boolean; format: (v: number) => string }) {
  const locale = useLocale();
  const total = items.reduce((a, x) => a + Math.max(x.value, 0), 0) || 1;
  let acc = 0;
  // Radio con circunferencia 100 en el anillo. La torta usa el mismo círculo con un trazo que llega al centro.
  const R = donut ? 15.915 : 7.9575;
  const scale = donut ? 1 : 0.5;
  return (
    <div className="an-pie">
      <svg viewBox="0 0 42 42" className={`an-pie-svg${donut ? '' : ' is-solid'}`} role="img" aria-label={summary}>
        {items.map((x, i) => {
          const pct = (Math.max(x.value, 0) / total) * 100 * scale;
          const el = <circle key={i} className={`an-pie-slice an-s${x.color % 6}`} cx="21" cy="21" r={R} fill="none" strokeDasharray={`${pct} ${100 * scale - pct}`} strokeDashoffset={25 * scale - acc} />;
          acc += pct;
          return el;
        })}
      </svg>
      <ul className="an-pie-legend" role="list">
        {items.map((x, i) => (
          <li key={i} className={`an-s${x.color % 6}`}>
            <i className="an-swatch" aria-hidden="true" />
            <span className="an-pie-name">{x.label}</span>
            <span className="an-mono">{format(x.value)}</span>
            <span className="an-muted an-small">{fmtPercent(Math.max(x.value, 0) / total, locale)}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

/** El total de cada serie como una barra horizontal. */
function TotalBars({ items, format }: { items: Array<{ label: string; value: number; color: number }>; format: (v: number) => string }) {
  const peak = Math.max(...items.map((x) => x.value), 1);
  return (
    <ul className="an-hist an-total-bars" role="list">
      {items.map((x, i) => (
        <li key={i} className={`an-hist-row an-s${x.color % 6}`}>
          <span className="an-hist-label an-pie-name">{x.label}</span>
          <span className="an-hist-bar" aria-hidden="true">
            {x.value > 0 && <span className="an-total-fill" style={{ width: `${Math.max(1, (x.value / peak) * 100)}%` }} />}
          </span>
          <span className="an-mono an-hist-n">{format(x.value)}</span>
        </li>
      ))}
    </ul>
  );
}

/** Una sola barra partida en segmentos, con el porcentaje en la leyenda. */
function ProportionBar({ items, format, summary }: { items: Array<{ label: string; value: number; color: number }>; format: (v: number) => string; summary: string }) {
  const locale = useLocale();
  const total = items.reduce((a, x) => a + Math.max(x.value, 0), 0) || 1;
  return (
    <div className="an-proportion">
      <div className="an-proportion-bar" role="img" aria-label={summary}>
        {items.map((x, i) => (
          <span key={i} className={`an-s${x.color % 6}`} style={{ width: `${(Math.max(x.value, 0) / total) * 100}%` }} />
        ))}
      </div>
      <ul className="an-pie-legend" role="list">
        {items.map((x, i) => (
          <li key={i} className={`an-s${x.color % 6}`}>
            <i className="an-swatch" aria-hidden="true" />
            <span className="an-pie-name">{x.label}</span>
            <span className="an-mono">{format(x.value)}</span>
            <span className="an-muted an-small">{fmtPercent(Math.max(x.value, 0) / total, locale)}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

function Trends({ r, display, annotations }: { r: TrendsResult; display: TrendDisplay; annotations?: Array<{ date: string; content: string }> }) {
  const t = useTranslations('analytics.result');
  const locale = useLocale();
  const [hidden, setHidden] = useState<Set<number>>(new Set());
  const labels = r.buckets.map((b) => bucketLabel(b, locale));
  const names = r.series.map((s) => seriesName(s, t('other'), t('none')));
  const total = r.series.reduce((a, s) => a + s.total, 0);
  const o = r.options;
  const format = (v: number) => formatTrendValue(v, o, locale);
  const formatted = Boolean(o?.unit && o.unit !== 'none') || Boolean(o?.prefix) || Boolean(o?.suffix);
  if (!r.series.length || total === 0 && r.series.every((s) => (s.compareTotal ?? 0) === 0)) {
    return <p className="an-empty-result">{t('noData')}</p>;
  }
  const visible = r.series.map((s, i) => ({ s, i })).filter((x) => !hidden.has(x.i));
  const items = visible.map(({ s, i }) => ({ label: names[i], value: s.total, color: i }));
  const summary = t('trendSummary', { total: fmtNumber(total, locale) });
  const toggle = (i: number) =>
    setHidden((prev) => {
      const next = new Set(prev);
      if (next.has(i)) next.delete(i);
      else next.add(i);
      return next;
    });
  const many = r.series.length > 1;
  return (
    <div className="an-result">
      {r.weekendsHidden && <p className="an-note">{t('weekendsHidden')}</p>}
      {Boolean(o?.smoothing) && <p className="an-note">{t('smoothedNote', { n: o?.smoothing ?? 0 })}</p>}
      {!visible.length ? (
        <p className="an-empty-result">{t('allHidden')}</p>
      ) : display === 'number' ? (
        <div className="an-bignums">
          {visible.map(({ s, i }) => {
            const d = delta(s.total, s.compareTotal ?? null);
            return (
              <div key={i} className="an-bignum">
                <span className="an-bignum-value">{formatted ? format(s.total) : fmtNumber(s.total, locale)}</span>
                <span className="an-bignum-label">{names[i]}</span>
                {d !== null && <span className={`an-delta ${d >= 0 ? 'is-up' : 'is-down'}`}>{t('vsPrevious', { delta: fmtPercent(d, locale) })}</span>}
              </div>
            );
          })}
        </div>
      ) : display === 'table' ? null : display === 'pie' || display === 'donut' ? (
        <Pie items={items} summary={summary} donut={display === 'donut'} format={format} />
      ) : display === 'bar_total' ? (
        <TotalBars items={items} format={format} />
      ) : display === 'proportion' ? (
        <ProportionBar items={items} format={format} summary={summary} />
      ) : (
        <Chart
          kind={display === 'bar' || display === 'stacked' ? 'bar' : display === 'area' ? 'area' : 'line'}
          annotations={(annotations ?? []).flatMap((a) => {
            // La anotación cae en la cubeta de su día (o en la semana o mes que lo contiene).
            const index = r.buckets.findIndex((b, i) => b.slice(0, 10) <= a.date && (i + 1 < r.buckets.length ? a.date < r.buckets[i + 1].slice(0, 10) || b.slice(0, 10) === a.date : true));
            return index >= 0 && a.date >= r.buckets[0].slice(0, 10) ? [{ index, text: a.content }] : [];
          })}
          labels={labels}
          series={visible.map(({ s, i }) => ({
            label: names[i],
            colorIndex: i,
            data: display === 'cumulative' ? running(s.data) : s.data,
            compare: s.compare && (display === 'cumulative' ? running(s.compare) : s.compare),
          }))}
          summary={summary}
          extras={{
            stacked: display === 'stacked',
            goalLines: o?.goalLines,
            yMin: o?.yMin,
            yMax: o?.yMax,
            xLabel: o?.xLabel,
            yLabel: o?.yLabel,
            format: formatted ? format : undefined,
            showValues: o?.showValues,
            hideLegend: o?.hideLegend,
            lastIncomplete: r.lastIncomplete && display !== 'cumulative',
          }}
        />
      )}
      {many && (
        <div className="an-row an-wrap an-series-actions">
          <button type="button" className="btn btn-ghost btn-sm" disabled={!hidden.size} onClick={() => setHidden(new Set())}>
            {t('showAll')}
          </button>
          <button type="button" className="btn btn-ghost btn-sm" disabled={hidden.size === r.series.length} onClick={() => setHidden(new Set(r.series.map((_, i) => i)))}>
            {t('hideAll')}
          </button>
        </div>
      )}
      <div className="table-wrap">
        <table className="table table-compact an-table">
          <thead>
            <tr>
              <th scope="col">{t('series')}</th>
              <th scope="col" className="num">
                {t('total')}
              </th>
              {r.series.some((s) => s.compare) && (
                <th scope="col" className="num">
                  {t('previous')}
                </th>
              )}
              {many && <th scope="col" className="an-sr-col"><span className="sr-only">{t('isolate')}</span></th>}
            </tr>
          </thead>
          <tbody>
            {r.series.map((s, i) => (
              <tr key={i} className={hidden.has(i) ? 'an-row-off' : undefined}>
                <td>
                  {many ? (
                    <label className="ui-check an-series-check">
                      <input type="checkbox" checked={!hidden.has(i)} onChange={() => toggle(i)} />
                      <span className={`an-s${i % 6}`}>
                        <i className="an-swatch" aria-hidden="true" />
                      </span>{' '}
                      {names[i]}
                    </label>
                  ) : (
                    <>
                      <span className={`an-s${i % 6}`}>
                        <i className="an-swatch" aria-hidden="true" />
                      </span>{' '}
                      {names[i]}
                    </>
                  )}
                </td>
                <td className="num">{formatted ? format(s.total) : fmtNumber(s.total, locale)}</td>
                {r.series.some((x) => x.compare) && <td className="num">{formatted ? format(s.compareTotal ?? 0) : fmtNumber(s.compareTotal ?? 0, locale)}</td>}
                {many && (
                  <td className="an-td-action">
                    <button type="button" className="btn btn-ghost btn-sm" aria-label={t('hideOthersOf', { name: names[i] })} onClick={() => setHidden(new Set(r.series.map((_, k) => k).filter((k) => k !== i)))}>
                      {t('hideOthers')}
                    </button>
                  </td>
                )}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

/** Tiempo hasta convertir: una barra por rango de duración, con selector de pasos. */
function FunnelTimes({ r }: { r: FunnelResult }) {
  const t = useTranslations('analytics.result');
  const locale = useLocale();
  const times = r.times ?? [];
  const [pick, setPick] = useState(times.length - 1);
  const cur = times[Math.min(pick, times.length - 1)];
  if (!cur || !cur.count) return <p className="an-empty-result">{t('noConversions')}</p>;
  const peak = Math.max(...cur.bins.map((b) => b.count), 1);
  return (
    <div className="an-funnel-times">
      <div className="an-row an-wrap">
        <select className="select" aria-label={t('timeSteps')} value={Math.min(pick, times.length - 1)} onChange={(e) => setPick(Number(e.target.value))}>
          {times.map((x, i) => (
            <option key={i} value={i}>
              {t('timeFromTo', { from: x.fromStep + 1, to: x.toStep + 1 })}
            </option>
          ))}
        </select>
        <span className="an-muted an-small">{t('timeStats', { avg: fmtDuration(cur.avgMs ?? 0), median: fmtDuration(cur.medianMs ?? 0), count: fmtNumber(cur.count, locale) })}</span>
      </div>
      <ul className="an-hist" role="list">
        {cur.bins.map((b, i) => (
          <li key={i} className="an-hist-row">
            <span className="an-hist-label an-mono">{b.fromMs === b.toMs ? fmtDuration(b.fromMs) : `${fmtDuration(b.fromMs)} – ${fmtDuration(b.toMs)}`}</span>
            <span className="an-hist-bar" aria-hidden="true">
              {b.count > 0 && <span style={{ width: `${Math.max(2, (b.count / peak) * 100)}%` }} />}
            </span>
            <span className="an-mono an-hist-n">
              {fmtNumber(b.count, locale)} · {fmtPercent(b.count / cur.count, locale)}
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}

/** Conversión por fecha de entrada, con pasos a elegir y sin períodos incompletos si se pide. */
function FunnelHistorical({ r }: { r: FunnelResult }) {
  const t = useTranslations('analytics.result');
  const locale = useLocale();
  const n = r.steps.length;
  const [from, setFrom] = useState(0);
  const [to, setTo] = useState(n - 1);
  const [hide, setHide] = useState(false);
  const toStep = Math.min(Math.max(to, from + 1), n - 1);
  const list = (r.historical ?? []).filter((b) => !hide || !b.incomplete);
  const rate = (b: { counts: number[] }) => (b.counts[from] ? Math.round((b.counts[toStep] / b.counts[from]) * 1000) / 10 : 0);
  if (!r.historical) return <p className="an-empty-result">{t('noData')}</p>;
  return (
    <div className="an-funnel-times">
      <div className="an-row an-wrap">
        <select className="select" aria-label={t('historicalFrom')} value={from} onChange={(e) => setFrom(Number(e.target.value))}>
          {r.steps.slice(0, -1).map((_, i) => (
            <option key={i} value={i}>
              {t('stepFrom', { n: i + 1 })}
            </option>
          ))}
        </select>
        <select className="select" aria-label={t('historicalTo')} value={toStep} onChange={(e) => setTo(Number(e.target.value))}>
          {r.steps.map((_, i) =>
            i > from ? (
              <option key={i} value={i}>
                {t('stepTo', { n: i + 1 })}
              </option>
            ) : null,
          )}
        </select>
        <label className="ui-check">
          <input type="checkbox" checked={hide} onChange={(e) => setHide(e.target.checked)} /> {t('hideIncomplete')}
        </label>
      </div>
      {list.length ? (
        <Chart
          kind="line"
          labels={list.map((b) => bucketLabel(b.bucket, locale))}
          series={[{ label: t('conversionRate'), data: list.map(rate) }]}
          summary={t('historicalSummary', { from: from + 1, to: toStep + 1 })}
        />
      ) : (
        <p className="an-empty-result">{t('noData')}</p>
      )}
      <div className="table-wrap">
        <table className="table table-compact an-table">
          <thead>
            <tr>
              <th scope="col">{t('entered')}</th>
              <th scope="col" className="num">
                {t('stepFrom', { n: from + 1 })}
              </th>
              <th scope="col" className="num">
                {t('stepTo', { n: toStep + 1 })}
              </th>
              <th scope="col" className="num">
                {t('conversionRate')}
              </th>
            </tr>
          </thead>
          <tbody>
            {list.map((b) => (
              <tr key={b.bucket}>
                <td>
                  {bucketLabel(b.bucket, locale)}
                  {b.incomplete && <span className="an-muted an-small"> · {t('incomplete')}</span>}
                </td>
                <td className="num">{fmtNumber(b.counts[from], locale)}</td>
                <td className="num">{fmtNumber(b.counts[toStep], locale)}</td>
                <td className="num">{b.counts[from] ? fmtPercent(b.counts[toStep] / b.counts[from], locale) : '·'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

/** Pasos por valor de la apertura. */
function FunnelBreakdown({ r }: { r: FunnelResult }) {
  const t = useTranslations('analytics.result');
  const locale = useLocale();
  const rows = r.breakdown ?? [];
  if (!rows.length) return <p className="an-note">{t('noBreakdownValues')}</p>;
  return (
    <div className="table-wrap">
      <table className="table table-compact an-table an-funnel-breakdown">
        <thead>
          <tr>
            <th scope="col">{t('breakdownValue')}</th>
            {r.steps.map((_, i) => (
              <th key={i} scope="col" className="num">
                {t('stepHead', { n: i + 1 })}
              </th>
            ))}
            <th scope="col" className="num">
              {t('conversionRate')}
            </th>
          </tr>
        </thead>
        <tbody>
          {rows.map((b, i) => (
            <tr key={i}>
              <td className="an-break">{b.value === null ? t('none') : b.value === '$other' ? t('other') : b.value}</td>
              {b.counts.map((c, k) => (
                <td key={k} className="num">
                  {fmtNumber(c, locale)}
                </td>
              ))}
              <td className="num">{b.counts[0] ? fmtPercent(b.counts[b.counts.length - 1] / b.counts[0], locale) : '·'}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/** Enlaces a caminos desde un paso: lo que vino antes, entre medio, después y al abandonar. */
function StepPaths({ query, step }: { query: FunnelQuery; step: number }) {
  const t = useTranslations('analytics.result');
  const n = query.steps.length;
  const href = (mode: FunnelPathMode) => {
    const paths = { kind: 'paths', dateRange: query.dateRange, steps: 4, source: 'all', funnel: { query, step, mode } };
    return `/app/analytics/insights/new?query=${encodeURIComponent(JSON.stringify(paths))}`;
  };
  const modes: FunnelPathMode[] = [
    'before',
    ...(step > 0 ? (['between'] as const) : []),
    'after',
    ...(step > 0 ? (['after_dropoff', 'before_dropoff'] as const) : []),
  ];
  return (
    <details className="an-step-paths">
      <summary>{t('stepPaths')}</summary>
      <ul className="an-step-paths-list" role="list">
        {modes.map((m) => (
          <li key={m}>
            <Link href={href(m)} className="an-link">
              {t(`pathModes.${m}`, { n: step + 1, prev: step, total: n })}
            </Link>
          </li>
        ))}
      </ul>
    </details>
  );
}

function Funnel({ r, peopleHref, query }: { r: FunnelResult; peopleHref?: (ids: string[]) => string; query?: FunnelQuery }) {
  const t = useTranslations('analytics.result');
  const locale = useLocale();
  const first = r.steps[0]?.count ?? 0;
  if (!first) return <p className="an-empty-result">{t('noData')}</p>;
  const last = r.steps[r.steps.length - 1];
  const totalKey = r.unit === 'session' ? 'funnelTotalSessions' : r.unit === 'group' ? 'funnelTotalGroups' : 'funnelTotal';
  const display = r.display ?? 'steps';
  const unordered = r.order === 'unordered';
  return (
    <div className="an-result">
      <p className="an-funnel-total">{t(totalKey, { conversion: fmtPercent(last.conversion, locale), count: fmtNumber(last.count, locale), start: fmtNumber(first, locale), n: first })}</p>
      {display === 'time' ? (
        <FunnelTimes r={r} />
      ) : display === 'trends' ? (
        <FunnelHistorical r={r} />
      ) : (
        <ol className="an-funnel" role="list">
          {r.steps.map((s, i) => {
            const reached = r.reachedPersons?.[i] ?? [];
            const count = `${fmtNumber(s.count, locale)} · ${fmtPercent(s.conversion, locale)}`;
            return (
              <li key={i} className="an-funnel-step">
                <div className="an-funnel-head">
                  <span className="an-funnel-n">{i + 1}</span>
                  <span className="an-funnel-name">{unordered ? t('completedSteps', { n: i + 1 }) : s.label}</span>
                  <span className="an-funnel-count">
                    {peopleHref && reached.length && r.unit !== 'group' ? (
                      <Link href={peopleHref(reached)} className="an-link">
                        {count}
                      </Link>
                    ) : (
                      count
                    )}
                  </span>
                </div>
                <div className="an-funnel-bar" aria-hidden="true">
                  {s.conversion > 0 && <span style={{ width: `${Math.max(1, s.conversion * 100)}%` }} />}
                </div>
                <div className="an-funnel-meta">
                  {i > 0 && (
                    <span>
                      {t('fromPrevious', { pct: fmtPercent(s.stepConversion, locale) })}
                      {s.medianMs !== null && ` · ${t('medianTime', { time: fmtDuration(s.medianMs) })}`}
                    </span>
                  )}
                  {i + 1 < r.steps.length && s.dropped > 0 && (
                    <span>
                      {peopleHref && r.droppedPersons[i]?.length && r.unit !== 'group' ? (
                        <Link href={peopleHref(r.droppedPersons[i])} className="an-link">
                          {t('dropped', { count: s.dropped })}
                        </Link>
                      ) : (
                        t('dropped', { count: s.dropped })
                      )}
                    </span>
                  )}
                </div>
                {peopleHref && s.count > 100 && r.unit !== 'group' && <p className="an-note an-flush">{t('peopleCap')}</p>}
                {query && !unordered && <StepPaths query={query} step={i} />}
              </li>
            );
          })}
        </ol>
      )}
      {display === 'steps' && r.breakdown && <FunnelBreakdown r={r} />}
      {r.truncated && <p className="an-note">{t('truncated')}</p>}
    </div>
  );
}

function retentionHead(t: (k: string, v: { n: number }) => string, period: RetentionResult['period'], k: number, labelStart: number) {
  const key = period === 'hour' ? 'hourN' : period === 'month' ? 'monthN' : period === 'day' ? 'dayN' : 'weekN';
  return t(key, { n: k + labelStart });
}

function RetentionRows({
  cohorts,
  n,
  reference,
  onCell,
}: {
  cohorts: RetentionResult['cohorts'];
  n: number;
  reference: 'period0' | 'previous';
  onCell?: (cohort: number, k: number) => void;
}) {
  const locale = useLocale();
  const t = useTranslations('analytics.result');
  return (
    <>
      {cohorts.map((c, i) => (
        <tr key={c.start}>
          <th scope="row">{bucketLabel(c.start, locale)}</th>
          <td className="num">{fmtNumber(c.size, locale)}</td>
          {Array.from({ length: n }, (_, k) => {
            const v = c.values[k];
            if (v === undefined) return <td key={k} />;
            const pct = retentionRate(c.values, c.size, k, reference);
            const text = pct === null ? '–' : fmtPercent(pct, locale);
            return (
              <td key={k} className="num an-ret-cell" style={{ ['--an-ret' as string]: String(pct ?? 0) }} title={`${v}`}>
                {onCell && v > 0 ? (
                  <button type="button" className="an-ret-btn" onClick={() => onCell(i, k)} aria-label={t('retentionCell', { start: bucketLabel(c.start, locale), n: k, count: v })}>
                    {text}
                  </button>
                ) : (
                  text
                )}
              </td>
            );
          })}
        </tr>
      ))}
    </>
  );
}

function Retention({ r, onDrill }: { r: RetentionResult; onDrill?: (cell: { cohort: number; k: number; value?: string | null }) => void }) {
  const t = useTranslations('analytics.result');
  const locale = useLocale();
  const [picked, setPicked] = useState<string>('');
  const o = r.options ?? {};
  const reference = o.reference ?? 'period0';
  const labelStart = o.labelStart ?? 0;
  const pickedRow = r.breakdown && picked ? r.breakdown.find((b) => String(b.value) === picked) : undefined;
  const cohorts = pickedRow?.cohorts ?? r.cohorts;
  if (!r.cohorts.some((c) => c.size > 0)) return <p className="an-empty-result">{t('noData')}</p>;
  const n = r.cohorts.length;
  const heads = Array.from({ length: n }, (_, k) => retentionHead(t as never, r.period, k, labelStart));
  const live = cohorts.filter((c) => c.size > 0);
  const mean = retentionMean(live, n, reference, o.mean ?? 'weighted');
  const show = o.show ?? 'both';
  const asPct = (v: number | null) => (v === null ? 0 : Math.round(v * 1000) / 10);
  const peak = live.slice(-6);
  return (
    <div className="an-result">
      {r.breakdown && (
        <>
          <div className="table-wrap">
            <table className="table table-compact an-table an-ret-values">
              <thead>
                <tr>
                  <th scope="col">{t('breakdownValue')}</th>
                  <th scope="col" className="num">
                    {r.unit === 'group' ? t('groupsCol') : t('people')}
                  </th>
                  {heads.map((h) => (
                    <th key={h} scope="col" className="num">
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {r.breakdown.map((b) => {
                  const m = retentionMean(b.cohorts.filter((c) => c.size > 0), n, reference, o.mean ?? 'weighted');
                  const name = b.value === null ? t('none') : b.value;
                  return (
                    <tr key={String(b.value)} className={picked === String(b.value) ? 'is-picked' : undefined}>
                      <th scope="row" className="an-break">
                        <button type="button" className="an-ret-btn an-link" aria-pressed={picked === String(b.value)} onClick={() => setPicked(picked === String(b.value) ? '' : String(b.value))}>
                          {name}
                        </button>
                      </th>
                      <td className="num">{fmtNumber(b.cohorts.reduce((a, c) => a + c.size, 0), locale)}</td>
                      {m.map((v, k) => (
                        <td key={k} className="num">
                          {v === null ? '–' : fmtPercent(v, locale)}
                        </td>
                      ))}
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          {pickedRow && <p className="an-note">{t('retentionValue', { value: pickedRow.value === null ? t('none') : pickedRow.value })}</p>}
        </>
      )}
      {show !== 'table' && (
        <Chart
          kind={o.chart === 'bar' ? 'bar' : 'line'}
          labels={heads}
          series={[{ label: t('retentionMeanRow'), data: mean.map(asPct) }, ...peak.map((c) => ({ label: bucketLabel(c.start, locale), data: c.values.map((_, k) => asPct(retentionRate(c.values, c.size, k, reference))) }))].map((x) => ({
            ...x,
            data: Array.from({ length: n }, (_, k) => x.data[k] ?? 0),
          }))}
          summary={t('retentionChart')}
          extras={{ format: (v) => `${v}%` }}
        />
      )}
      {show !== 'graph' && (
        <div className="table-wrap">
          <table className="table table-compact an-retention">
            <thead>
              <tr>
                <th scope="col">{t('cohort')}</th>
                <th scope="col" className="num">
                  {r.unit === 'group' ? t('groupsCol') : t('people')}
                </th>
                {heads.map((h) => (
                  <th key={h} scope="col" className="num">
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              <tr className="an-ret-mean">
                <th scope="row">{t('retentionMeanRow')}</th>
                <td className="num">{fmtNumber(live.reduce((a, c) => a + c.size, 0), locale)}</td>
                {mean.map((v, k) => (
                  <td key={k} className="num">
                    {v === null ? '–' : fmtPercent(v, locale)}
                  </td>
                ))}
              </tr>
              <RetentionRows
                cohorts={cohorts}
                n={n}
                reference={reference}
                onCell={onDrill && r.unit !== 'group' ? (cohort, k) => onDrill({ cohort, k, ...(pickedRow ? { value: pickedRow.value } : {}) }) : undefined}
              />
            </tbody>
          </table>
        </div>
      )}
      {r.truncated && <p className="an-note">{t('truncated')}</p>}
    </div>
  );
}

/** Un nodo de camino como paso de embudo: una página es un $pageview en esa URL; si no, el evento. */
function nodeStep(node: string) {
  return node.startsWith('/') ? { event: '$pageview', filters: [{ key: '$pathname', op: 'eq', value: node, type: 'event' }] } : { event: node, filters: [] };
}

function funnelFromPath(path: string[]): string {
  const steps = (path.length >= 2 ? path.slice(0, 10) : [path[0], path[0]]).map(nodeStep);
  return `/app/analytics/insights/new?query=${encodeURIComponent(JSON.stringify({ kind: 'funnel', steps }))}`;
}

function Paths({ r, linkFunnels }: { r: PathsResult; linkFunnels?: boolean }) {
  const t = useTranslations('analytics.result');
  const locale = useLocale();
  if (!r.sessions) return <p className="an-empty-result">{t('noData')}</p>;
  const steps = [...new Set(r.links.map((l) => l.step))];
  return (
    <div className="an-result">
      <p className="an-note">{t('pathsSessions', { count: r.sessions })}</p>
      <PathsSankey r={r} />
      <div className="an-paths">
        {steps.map((s) => {
          const links = r.links.filter((l) => l.step === s).slice(0, 8);
          const max = Math.max(...links.map((l) => l.count), 1);
          return (
            <section key={s} className="an-paths-step" aria-label={t('stepN', { n: s + 1 })}>
              <h4 className="an-h4">{t('stepArrow', { from: s + 1, to: s + 2 })}</h4>
              <ul role="list">
                {links.map((l, i) => (
                  <li key={i} className="an-path-link">
                    <span className="an-path-from">{l.from}</span>
                    <span aria-hidden="true">→</span>
                    <span className="an-path-to">{l.to}</span>
                    <span className="an-path-count">{fmtNumber(l.count, locale)}</span>
                    <span className="an-path-bar" aria-hidden="true">
                      <span style={{ width: `${(l.count / max) * 100}%` }} />
                    </span>
                  </li>
                ))}
              </ul>
            </section>
          );
        })}
      </div>
      <h4 className="an-h4">{t('topPaths')}</h4>
      <div className="table-wrap">
        <table className="table table-compact an-table">
          <thead>
            <tr>
              <th scope="col">{t('path')}</th>
              <th scope="col" className="num">
                {t('sessions')}
              </th>
              {linkFunnels && (
                <th scope="col">
                  <span className="sr-only">{t('viewFunnel')}</span>
                </th>
              )}
            </tr>
          </thead>
          <tbody>
            {r.topPaths.slice(0, 15).map((p, i) => (
              <tr key={i}>
                <td className="an-path-cell">{p.path.join(' → ')}</td>
                <td className="num">{fmtNumber(p.count, locale)}</td>
                {linkFunnels && (
                  <td className="an-td-action">
                    <Link href={funnelFromPath(p.path)} className="an-link">
                      {t('viewFunnel')}
                    </Link>
                  </td>
                )}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {r.truncated && <p className="an-note">{t('truncated')}</p>}
    </div>
  );
}

function Sql({ r }: { r: SqlResult }) {
  const t = useTranslations('analytics.result');
  if (!r.rows.length) return <p className="an-empty-result">{t('noRows')}</p>;
  return (
    <div className="an-result">
      <p className="an-note">{t('sqlRows', { count: r.rows.length, ms: r.ms })}</p>
      <div className="table-wrap an-sql-wrap">
        <table className="table table-compact an-table">
          <thead>
            <tr>
              {r.columns.map((c, i) => (
                <th key={i} scope="col">
                  {c}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {r.rows.map((row, i) => (
              <tr key={i}>
                {row.map((v, j) => (
                  <td key={j} className="an-sql-cell">
                    {v === null ? <span className="an-null">null</span> : String(v)}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {r.truncated && <p className="an-note">{t('sqlTruncated')}</p>}
    </div>
  );
}

/** Resultado de un insight, según su tipo. */
export default function InsightResultView({
  result,
  display = 'line',
  peopleHref,
  annotations,
  query,
  onRetentionCell,
}: {
  result: InsightResult;
  display?: TrendDisplay;
  peopleHref?: (ids: string[]) => string;
  annotations?: Array<{ date: string; content: string }>;
  /** La consulta, en el editor: habilita enlaces entre embudos y caminos. */
  query?: InsightQuery;
  /** Abrir quiénes están en una celda de retención. */
  onRetentionCell?: (cell: { cohort: number; k: number; value?: string | null }) => void;
}) {
  switch (result.kind) {
    case 'trends':
      return <Trends r={result} display={display} annotations={annotations} />;
    case 'funnel':
      return <Funnel r={result} peopleHref={peopleHref} query={query?.kind === 'funnel' ? query : undefined} />;
    case 'retention':
      return <Retention r={result} onDrill={onRetentionCell} />;
    case 'paths':
      return <Paths r={result} linkFunnels={Boolean(query)} />;
    case 'sql':
      return <Sql r={result} />;
    case 'stickiness':
      return <Stickiness r={result} />;
    case 'lifecycle':
      return <Lifecycle r={result} />;
  }
}
