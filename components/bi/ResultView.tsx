'use client';

import { useMemo, useState } from 'react';
import { useLocale, useTranslations } from 'next-intl';
import Chart from '@/components/analytics/Chart';
import { chartDateLabel, spansYears } from '@/lib/chart-dates';
import { formatValue, pickViz } from '@/lib/bi/viz';
import type { BiResult, Viz } from '@/lib/bi/types';

const PAGE = 50;

function toNumber(v: unknown): number {
  const n = typeof v === 'number' ? v : Number(v);
  return Number.isFinite(n) ? n : 0;
}

/** Resultado de una pregunta: número, gráfico o tabla paginada (con CSV). */
export default function ResultView({ result, viz, compact = false, title }: { result: BiResult; viz: Viz; compact?: boolean; title?: string }) {
  const t = useTranslations('bi.result');
  const locale = useLocale();
  const resolved = useMemo(() => pickViz(result.columns, result.rows.length, viz), [result, viz]);
  const { columns, rows } = result;

  if (!rows.length) return <p className="bi-empty-result">{t('noRows')}</p>;

  if (resolved.type === 'number') {
    const col = resolved.ys[0];
    return (
      <div className="bi-number" data-testid="bi-number">
        <span className="bi-number-value">{formatValue(rows[0][col], locale)}</span>
        <span className="bi-number-label">{title ?? columns[col]?.name}</span>
      </div>
    );
  }

  if (resolved.type === 'line' || resolved.type === 'bar' || resolved.type === 'area') {
    const xCol = columns[resolved.x];
    const raw = rows.slice(0, 500).map((r) => r[resolved.x]);
    const isDate = xCol.type === 'date';
    const withYear = isDate && spansYears(raw.map((v) => String(v ?? '').slice(0, 10)));
    const labels = raw.map((v) => (isDate && typeof v === 'string' && /^\d{4}-\d{2}-\d{2}/.test(v) ? chartDateLabel(v.slice(0, 10), locale, withYear) : formatValue(v, locale)));
    const series = resolved.ys.map((y, i) => ({ label: columns[y].name, data: rows.slice(0, 500).map((r) => toNumber(r[y])), colorIndex: i }));
    return (
      <div className="bi-chart" data-testid="bi-chart" data-kind={resolved.type}>
        <Chart
          series={series}
          labels={labels}
          kind={resolved.type}
          height={compact ? 200 : 280}
          summary={t('chartSummary', { series: series.map((s) => s.label).join(', '), points: String(labels.length) })}
          extras={{ format: (v) => formatValue(v, locale), hideLegend: series.length === 1 }}
        />
      </div>
    );
  }

  if (resolved.type === 'pie') return <Pie columns={columns} rows={rows} x={resolved.x} y={resolved.ys[0]} />;
  if (resolved.type === 'funnel') return <Funnel columns={columns} rows={rows} x={resolved.x} y={resolved.ys[0]} />;
  return <ResultTable result={result} compact={compact} />;
}

function Pie({ columns, rows, x, y }: { columns: BiResult['columns']; rows: unknown[][]; x: number; y: number }) {
  const t = useTranslations('bi.result');
  const locale = useLocale();
  const items = rows.map((r) => ({ label: formatValue(r[x], locale, columns[x]?.type) || '—', value: Math.max(0, toNumber(r[y])) })).sort((a, b) => b.value - a.value);
  const top = items.slice(0, 6);
  const rest = items.slice(6).reduce((s, i) => s + i.value, 0);
  if (rest > 0) top.push({ label: t('other'), value: rest });
  const total = top.reduce((s, i) => s + i.value, 0) || 1;
  let acc = 0;
  const R = 70;
  const C = 2 * Math.PI * R;
  return (
    <figure className="bi-pie" aria-label={t('pieSummary', { name: columns[y]?.name ?? '' })}>
      <svg viewBox="0 0 180 180" width="180" height="180" role="img" aria-hidden="true">
        {top.map((it, i) => {
          const len = (it.value / total) * C;
          const el = <circle key={i} r={R} cx="90" cy="90" fill="none" strokeWidth="26" className={`bi-s${i % 6}`} strokeDasharray={`${len} ${C - len}`} strokeDashoffset={-acc} transform="rotate(-90 90 90)" />;
          acc += len;
          return el;
        })}
      </svg>
      <figcaption>
        <ul className="bi-legend">
          {top.map((it, i) => (
            <li key={i}>
              <span className={`bi-swatch bi-bg${i % 6}`} aria-hidden="true" />
              <span className="bi-legend-label">{it.label}</span>
              <span className="bi-legend-value">
                {formatValue(it.value, locale)} · {Math.round((it.value / total) * 100)}%
              </span>
            </li>
          ))}
        </ul>
      </figcaption>
    </figure>
  );
}

function Funnel({ columns, rows, x, y }: { columns: BiResult['columns']; rows: unknown[][]; x: number; y: number }) {
  const locale = useLocale();
  const steps = rows.slice(0, 12).map((r) => ({ label: formatValue(r[x], locale, columns[x]?.type) || '—', value: toNumber(r[y]) }));
  const first = steps[0]?.value || 1;
  return (
    <ol className="bi-funnel" data-testid="bi-funnel">
      {steps.map((s, i) => {
        const pct = Math.max(0, Math.min(100, (s.value / first) * 100));
        return (
          <li key={i} className="bi-funnel-step">
            <div className="bi-funnel-head">
              <span>{s.label}</span>
              <span className="bi-funnel-num">
                {formatValue(s.value, locale)} · {Math.round(pct)}%
              </span>
            </div>
            <div className="bi-funnel-track">
              <span className="bi-funnel-bar" style={{ width: `${pct}%` }} />
            </div>
          </li>
        );
      })}
    </ol>
  );
}

function csv(result: BiResult): string {
  const esc = (v: unknown) => {
    const s = v === null || v === undefined ? '' : String(v);
    const safe = /^[=+\-@\t\r]/.test(s) ? `'${s}` : s;
    return /[",\n]/.test(safe) ? `"${safe.replace(/"/g, '""')}"` : safe;
  };
  return [result.columns.map((c) => esc(c.name)).join(','), ...result.rows.map((r) => r.map(esc).join(','))].join('\n');
}

export function ResultTable({ result, compact }: { result: BiResult; compact?: boolean }) {
  const t = useTranslations('bi.result');
  const locale = useLocale();
  const [page, setPage] = useState(0);
  const pages = Math.max(1, Math.ceil(result.rows.length / PAGE));
  const rows = result.rows.slice(page * PAGE, page * PAGE + PAGE);
  const download = () => {
    const blob = new Blob([csv(result)], { type: 'text/csv;charset=utf-8' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = 'results.csv';
    a.click();
    URL.revokeObjectURL(a.href);
  };
  return (
    <div className="bi-table-block">
      <div className={`bi-table-wrap${compact ? ' compact' : ''}`} tabIndex={0} aria-label={t('tableLabel')}>
        <table className="table bi-table" data-testid="bi-table">
          <thead>
            <tr>
              {result.columns.map((c, i) => (
                <th key={i} scope="col" className={c.type === 'number' ? 'num' : undefined}>
                  {c.name}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((r, i) => (
              <tr key={i}>
                {r.map((v, j) => (
                  <td key={j} className={result.columns[j]?.type === 'number' ? 'num' : undefined}>
                    {formatValue(v, locale, result.columns[j]?.type)}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {!compact && (
        <div className="bi-table-foot">
          <span className="bi-muted">
            {result.truncated ? t('rowsTruncated', { n: String(result.rows.length) }) : t('rows', { n: String(result.rows.length) })}
          </span>
          {pages > 1 && (
            <span className="bi-pager">
              <button type="button" className="btn btn-sm btn-ghost" onClick={() => setPage((p) => Math.max(0, p - 1))} disabled={page === 0} aria-label={t('prev')}>
                ‹
              </button>
              <span className="bi-muted">{t('page', { n: String(page + 1), total: String(pages) })}</span>
              <button type="button" className="btn btn-sm btn-ghost" onClick={() => setPage((p) => Math.min(pages - 1, p + 1))} disabled={page >= pages - 1} aria-label={t('next')}>
                ›
              </button>
            </span>
          )}
          <button type="button" className="btn btn-sm btn-ghost" onClick={download}>
            {t('csv')}
          </button>
        </div>
      )}
    </div>
  );
}
