'use client';

import { useLocale, useTranslations } from 'next-intl';
import { Link } from '@/i18n/navigation';
import type { FunnelResult, InsightResult, PathsResult, RetentionResult, SqlResult, TrendDisplay, TrendsResult } from '@/lib/analytics/types';
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

/** Torta de los totales: un anillo por porciones, con la leyenda al lado. */
function Pie({ items, summary }: { items: Array<{ label: string; value: number }>; summary: string }) {
  const locale = useLocale();
  const total = items.reduce((a, x) => a + Math.max(x.value, 0), 0) || 1;
  let acc = 0;
  const R = 15.915; // circunferencia 100: el largo del trazo es el porcentaje.
  return (
    <div className="an-pie">
      <svg viewBox="0 0 42 42" className="an-pie-svg" role="img" aria-label={summary}>
        {items.map((x, i) => {
          const pct = (Math.max(x.value, 0) / total) * 100;
          const el = <circle key={i} className={`an-pie-slice an-s${i % 6}`} cx="21" cy="21" r={R} fill="none" strokeDasharray={`${pct} ${100 - pct}`} strokeDashoffset={25 - acc} />;
          acc += pct;
          return el;
        })}
      </svg>
      <ul className="an-pie-legend" role="list">
        {items.map((x, i) => (
          <li key={i} className={`an-s${i % 6}`}>
            <i className="an-swatch" aria-hidden="true" />
            <span className="an-pie-name">{x.label}</span>
            <span className="an-mono">{fmtNumber(x.value, locale)}</span>
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
  const labels = r.buckets.map((b) => bucketLabel(b, locale));
  const names = r.series.map((s) => seriesName(s, t('other'), t('none')));
  const total = r.series.reduce((a, s) => a + s.total, 0);
  if (!r.series.length || total === 0 && r.series.every((s) => (s.compareTotal ?? 0) === 0)) {
    return <p className="an-empty-result">{t('noData')}</p>;
  }
  return (
    <div className="an-result">
      {display === 'number' ? (
        <div className="an-bignums">
          {r.series.map((s, i) => {
            const d = delta(s.total, s.compareTotal ?? null);
            return (
              <div key={i} className="an-bignum">
                <span className="an-bignum-value">{fmtNumber(s.total, locale)}</span>
                <span className="an-bignum-label">{names[i]}</span>
                {d !== null && <span className={`an-delta ${d >= 0 ? 'is-up' : 'is-down'}`}>{t('vsPrevious', { delta: fmtPercent(d, locale) })}</span>}
              </div>
            );
          })}
        </div>
      ) : display === 'table' ? null : display === 'pie' ? (
        <Pie items={r.series.map((s, i) => ({ label: names[i], value: s.total }))} summary={t('trendSummary', { total: fmtNumber(total, locale) })} />
      ) : (
        <Chart
          kind={display === 'bar' ? 'bar' : display === 'area' ? 'area' : 'line'}
          annotations={(annotations ?? []).flatMap((a) => {
            // La anotación cae en la cubeta de su día (o en la semana o mes que lo contiene).
            const index = r.buckets.findIndex((b, i) => b.slice(0, 10) <= a.date && (i + 1 < r.buckets.length ? a.date < r.buckets[i + 1].slice(0, 10) || b.slice(0, 10) === a.date : true));
            return index >= 0 && a.date >= r.buckets[0].slice(0, 10) ? [{ index, text: a.content }] : [];
          })}
          labels={labels}
          series={r.series.map((s, i) => ({
            label: names[i],
            data: display === 'cumulative' ? running(s.data) : s.data,
            compare: s.compare && (display === 'cumulative' ? running(s.compare) : s.compare),
          }))}
          summary={t('trendSummary', { total: fmtNumber(total, locale) })}
        />
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
            </tr>
          </thead>
          <tbody>
            {r.series.map((s, i) => (
              <tr key={i}>
                <td>
                  <span className={`an-s${i % 6}`}>
                    <i className="an-swatch" aria-hidden="true" />
                  </span>{' '}
                  {names[i]}
                </td>
                <td className="num">{fmtNumber(s.total, locale)}</td>
                {r.series.some((x) => x.compare) && <td className="num">{fmtNumber(s.compareTotal ?? 0, locale)}</td>}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function Funnel({ r, peopleHref }: { r: FunnelResult; peopleHref?: (ids: string[]) => string }) {
  const t = useTranslations('analytics.result');
  const locale = useLocale();
  const first = r.steps[0]?.count ?? 0;
  if (!first) return <p className="an-empty-result">{t('noData')}</p>;
  const last = r.steps[r.steps.length - 1];
  return (
    <div className="an-result">
      <p className="an-funnel-total">
        {t('funnelTotal', { conversion: fmtPercent(last.conversion, locale), count: fmtNumber(last.count, locale), start: fmtNumber(first, locale), n: first })}
      </p>
      <ol className="an-funnel" role="list">
        {r.steps.map((s, i) => (
          <li key={i} className="an-funnel-step">
            <div className="an-funnel-head">
              <span className="an-funnel-n">{i + 1}</span>
              <span className="an-funnel-name">{s.label}</span>
              <span className="an-funnel-count">
                {fmtNumber(s.count, locale)} · {fmtPercent(s.conversion, locale)}
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
                  {peopleHref && r.droppedPersons[i]?.length ? (
                    <Link href={peopleHref(r.droppedPersons[i])} className="an-link">
                      {t('dropped', { count: s.dropped })}
                    </Link>
                  ) : (
                    t('dropped', { count: s.dropped })
                  )}
                </span>
              )}
            </div>
          </li>
        ))}
      </ol>
      {r.truncated && <p className="an-note">{t('truncated')}</p>}
    </div>
  );
}

function Retention({ r }: { r: RetentionResult }) {
  const t = useTranslations('analytics.result');
  const locale = useLocale();
  if (!r.cohorts.some((c) => c.size > 0)) return <p className="an-empty-result">{t('noData')}</p>;
  const n = r.cohorts.length;
  return (
    <div className="an-result">
      <div className="table-wrap">
        <table className="table table-compact an-retention">
          <thead>
            <tr>
              <th scope="col">{t('cohort')}</th>
              <th scope="col" className="num">
                {t('people')}
              </th>
              {Array.from({ length: n }, (_, k) => (
                <th key={k} scope="col" className="num">
                  {r.period === 'day' ? t('dayN', { n: k }) : t('weekN', { n: k })}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {r.cohorts.map((c) => (
              <tr key={c.start}>
                <th scope="row">{bucketLabel(c.start, locale)}</th>
                <td className="num">{fmtNumber(c.size, locale)}</td>
                {Array.from({ length: n }, (_, k) => {
                  const v = c.values[k];
                  if (v === undefined) return <td key={k} />;
                  const pct = c.size ? v / c.size : 0;
                  return (
                    <td key={k} className="num an-ret-cell" style={{ ['--an-ret' as string]: String(pct) }} title={`${v}`}>
                      {c.size ? fmtPercent(pct, locale) : '–'}
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {r.truncated && <p className="an-note">{t('truncated')}</p>}
    </div>
  );
}

function Paths({ r }: { r: PathsResult }) {
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
            </tr>
          </thead>
          <tbody>
            {r.topPaths.slice(0, 15).map((p, i) => (
              <tr key={i}>
                <td className="an-path-cell">{p.path.join(' → ')}</td>
                <td className="num">{fmtNumber(p.count, locale)}</td>
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
}: {
  result: InsightResult;
  display?: TrendDisplay;
  peopleHref?: (ids: string[]) => string;
  annotations?: Array<{ date: string; content: string }>;
}) {
  switch (result.kind) {
    case 'trends':
      return <Trends r={result} display={display} annotations={annotations} />;
    case 'funnel':
      return <Funnel r={result} peopleHref={peopleHref} />;
    case 'retention':
      return <Retention r={result} />;
    case 'paths':
      return <Paths r={result} />;
    case 'sql':
      return <Sql r={result} />;
    case 'stickiness':
      return <Stickiness r={result} />;
    case 'lifecycle':
      return <Lifecycle r={result} />;
  }
}
