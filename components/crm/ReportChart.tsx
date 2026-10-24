'use client';

import { useCallback, useMemo } from 'react';
import { useTranslations } from 'next-intl';
import { Link } from '@/i18n/navigation';
import {
  type ReportAggregateResult,
  type ReportColumn,
  type ReportResult,
  type ReportViz,
} from '@/lib/crm-report-builder';

const MAX_SERIES = 6;

/** Formateo compartido por el constructor, la lista y los widgets de dashboard. */
export function useReportFormat(locale: string, baseCurrency = 'USD') {
  const t = useTranslations('crm');
  const fieldLabel = useCallback(
    (col: Pick<ReportColumn, 'key' | 'label'>) => {
      if (col.label) return col.label;
      const [obj, name] = col.key.split('.');
      return t(`reportBuilder.fields.${obj}.${name}`);
    },
    [t],
  );
  const money = useCallback(
    (n: number) => new Intl.NumberFormat(locale, { style: 'currency', currency: baseCurrency, maximumFractionDigits: 0 }).format(n),
    [locale, baseCurrency],
  );
  const num = useCallback((n: number) => new Intl.NumberFormat(locale, { maximumFractionDigits: 2 }).format(n), [locale]);

  const value = useCallback(
    (col: ReportColumn | undefined, raw: string | number | null, labels: Record<string, string> = {}): string => {
      if (raw === null || raw === undefined || raw === '') return t('reportBuilder.noValue');
      if (!col) return String(raw);
      const v = String(raw);
      switch (col.enum) {
        case 'owner':
        case 'stage':
        case 'pipeline':
          return labels[`${col.enum}:${v}`] ?? (col.enum === 'owner' ? t('reportBuilder.unknownPerson') : v);
        case 'lifecycle':
        case 'leadStatus':
        case 'source':
        case 'priority':
        case 'activityType': {
          const key = `enums.${col.enum}.${v}`;
          return t.has(key) ? t(key) : v;
        }
        case 'forecastCategory':
          return t.has(`forecast.category.${v}`) ? t(`forecast.category.${v}`) : v;
        default:
          break;
      }
      if (col.type === 'boolean') return v === '1' || v === 'true' ? t('common.yes') : t('common.no');
      if (col.type === 'number') return col.money ? money(Number(raw)) : num(Number(raw));
      if (col.type === 'date') return dateLabel(v, locale);
      return v;
    },
    [t, money, num, locale],
  );
  return { fieldLabel, value, money, num, t };
}

/** Fechas y buckets ('2026-10', '2026-Q4', '2026-W42', '2026-10-24', fecha completa). */
export function dateLabel(v: string, locale: string): string {
  if (/^\d{4}-\d{2}$/.test(v)) {
    const [y, m] = v.split('-').map(Number);
    return new Intl.DateTimeFormat(locale, { month: 'short', year: 'numeric', timeZone: 'UTC' }).format(new Date(Date.UTC(y, m - 1, 1)));
  }
  if (/^\d{4}-\d{2}-\d{2}/.test(v)) {
    const d = new Date(`${v.slice(0, 10)}T00:00:00Z`);
    if (!Number.isNaN(d.getTime())) return new Intl.DateTimeFormat(locale, { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' }).format(d);
  }
  return v;
}

interface ChartProps {
  result: ReportResult;
  viz: ReportViz;
  locale: string;
  baseCurrency?: string;
  /** Compacto en widgets de dashboard: sin leyenda larga ni pie de tabla. */
  compact?: boolean;
}

interface Series {
  key: string;
  label: string;
  cls: string;
}

function metricLabel(r: ReportAggregateResult, fmt: ReturnType<typeof useReportFormat>): string {
  const { t, fieldLabel } = fmt;
  if (r.metric.agg === 'count') {
    const plural = { contact: 'contacts', company: 'companies', deal: 'deals', activity: 'activities' }[r.metric.object];
    return t('reportBuilder.countOf', { object: t(`reportBuilder.sources.${plural}`).toLocaleLowerCase() });
  }
  return `${t(`reportBuilder.aggs.${r.metric.agg}`)} · ${r.metric.field ? fieldLabel(r.metric.field) : ''}`;
}

/** Dibuja el resultado de un reporte según la visualización elegida. */
export default function ReportChart({ result, viz, locale, baseCurrency = 'USD', compact = false }: ChartProps) {
  const fmt = useReportFormat(locale, baseCurrency);
  const { t } = fmt;

  if (result.kind === 'records') return <RecordsTable result={result} fmt={fmt} />;

  const metricCol: ReportColumn | undefined = result.metric.field ?? undefined;
  const fmtValue = (n: number) => (metricCol?.money ? fmt.money(n) : fmt.num(n));

  if (viz === 'kpi' || result.dimensions.length === 0) {
    return (
      <div className="rb-kpi" data-testid="rb-kpi">
        <span className="stat-num">{fmtValue(result.total)}</span>
        <span className="stat-label muted">{metricLabel(result, fmt)}</span>
      </div>
    );
  }
  if (!result.rows.length) return <p className="muted breakdown-empty">{t('reportBuilder.emptyResult')}</p>;

  const truncated = result.truncated ? <p className="muted rb-note">{t('reportBuilder.truncated')}</p> : null;

  if (viz === 'table') {
    return (
      <>
        <div className="rb-scroll">
          <table className="table rb-table" data-testid="rb-table">
            <thead>
              <tr>
                {result.dimensions.map((d) => (
                  <th key={d.key}>{fmt.fieldLabel(d)}</th>
                ))}
                <th className="num">{metricLabel(result, fmt)}</th>
              </tr>
            </thead>
            <tbody>
              {result.rows.map((r, i) => (
                <tr key={i}>
                  {r.keys.map((k, j) => (
                    <td key={j}>{fmt.value(result.dimensions[j], k, result.labels)}</td>
                  ))}
                  <td className="num">{fmtValue(r.value)}</td>
                </tr>
              ))}
            </tbody>
            {!compact && (
              <tfoot>
                <tr>
                  <td colSpan={result.dimensions.length}>{t('reportBuilder.total')}</td>
                  <td className="num">{fmtValue(result.total)}</td>
                </tr>
              </tfoot>
            )}
          </table>
        </div>
        {truncated}
      </>
    );
  }

  return (
    <>
      <AggregateChart result={result} viz={viz} fmt={fmt} fmtValue={fmtValue} compact={compact} />
      {truncated}
    </>
  );
}

function AggregateChart({
  result,
  viz,
  fmt,
  fmtValue,
  compact,
}: {
  result: ReportAggregateResult;
  viz: ReportViz;
  fmt: ReturnType<typeof useReportFormat>;
  fmtValue: (n: number) => string;
  compact: boolean;
}) {
  const [d0, d1] = result.dimensions;
  // Grupos (primera dimensión) y series (segunda), con las series fijas por orden de aparición.
  const { groups, series, cell } = useMemo(() => {
    const groupKeys: Array<string | null> = [];
    const seriesTotals = new Map<string, number>();
    const map = new Map<string, number>();
    const sk = (k: string | null) => k ?? '\u0000';
    for (const r of result.rows) {
      const g = r.keys[0];
      if (!groupKeys.some((x) => x === g)) groupKeys.push(g);
      const s = d1 ? r.keys[1] : null;
      seriesTotals.set(sk(s), (seriesTotals.get(sk(s)) ?? 0) + r.value);
    }
    const ordered = [...seriesTotals.entries()].sort((a, b) => b[1] - a[1]).map(([k]) => k);
    const kept = ordered.slice(0, MAX_SERIES);
    const other = ordered.length > MAX_SERIES;
    for (const r of result.rows) {
      const raw = d1 ? sk(r.keys[1]) : sk(null);
      const s = kept.includes(raw) ? raw : '__other';
      const key = `${sk(r.keys[0])}|${s}`;
      map.set(key, (map.get(key) ?? 0) + r.value);
    }
    const list: Series[] = kept.map((k, i) => ({
      key: k,
      label: d1 ? fmt.value(d1, k === '\u0000' ? null : k, result.labels) : '',
      cls: d1 ? `rb-s${i + 1}` : '',
    }));
    if (other) list.push({ key: '__other', label: fmt.t('reportBuilder.other'), cls: 'rb-s7' });
    return {
      groups: groupKeys.map((g) => ({ key: sk(g), label: fmt.value(d0, g, result.labels) })),
      series: list,
      cell: (g: string, s: string) => map.get(`${g}|${s}`) ?? 0,
    };
  }, [result, d0, d1, fmt]);

  const legend =
    d1 && series.length > 1 ? (
      <div className="rb-legend" aria-label={fmt.fieldLabel(d1)}>
        {series.map((s) => (
          <span key={s.key} className={`rb-legend-item ${s.cls}`}>
            <span className="rb-swatch" aria-hidden /> {s.label}
          </span>
        ))}
      </div>
    ) : null;

  if (viz === 'pie') {
    // Torta sobre la primera dimensión; más de 6 porciones se juntan en "Otros".
    const totals = groups.map((g) => ({ ...g, v: series.reduce((acc, s) => acc + cell(g.key, s.key), 0) })).sort((a, b) => b.v - a.v);
    const kept = totals.slice(0, MAX_SERIES);
    const rest = totals.slice(MAX_SERIES).reduce((acc, g) => acc + g.v, 0);
    const slices = rest > 0 ? [...kept, { key: '__other', label: fmt.t('reportBuilder.other'), v: rest }] : kept;
    const sum = slices.reduce((acc, s) => acc + Math.max(0, s.v), 0) || 1;
    let angle = -Math.PI / 2;
    return (
      <div className="rb-pie" data-testid="rb-pie">
        <svg viewBox="-100 -100 200 200" role="img" aria-label={fmt.fieldLabel(d0)}>
          {slices.map((s, i) => {
            const frac = Math.max(0, s.v) / sum;
            const a0 = angle;
            const a1 = angle + frac * Math.PI * 2;
            angle = a1;
            const cls = `rb-pie-slice ${s.key === '__other' ? 'rb-s7' : `rb-s${i + 1}`}`;
            const title = `${s.label}: ${fmtValue(s.v)} (${Math.round(frac * 100)}%)`;
            if (frac >= 0.9999) return <circle key={s.key} className={cls} r={90}><title>{title}</title></circle>;
            const large = a1 - a0 > Math.PI ? 1 : 0;
            const p = (a: number, r: number) => `${Math.cos(a) * r} ${Math.sin(a) * r}`;
            return (
              <path key={s.key} className={cls} d={`M ${p(a0, 90)} A 90 90 0 ${large} 1 ${p(a1, 90)} L ${p(a1, 50)} A 50 50 0 ${large} 0 ${p(a0, 50)} Z`}>
                <title>{title}</title>
              </path>
            );
          })}
        </svg>
        <div className="rb-legend">
          {slices.map((s, i) => (
            <span key={s.key} className={`rb-legend-item ${s.key === '__other' ? 'rb-s7' : `rb-s${i + 1}`}`}>
              <span className="rb-swatch" aria-hidden /> {s.label} · <span className="mono">{fmtValue(s.v)}</span>
            </span>
          ))}
        </div>
      </div>
    );
  }

  if (viz === 'line') {
    const W = 760;
    const H = 240;
    const pad = { t: 12, r: 12, b: 28, l: 56 };
    const iw = W - pad.l - pad.r;
    const ih = H - pad.t - pad.b;
    const values = groups.flatMap((g) => series.map((s) => cell(g.key, s.key)));
    const max = niceCeil(Math.max(0, ...values));
    const min = Math.min(0, ...values);
    const span = max - min || 1;
    const x = (i: number) => pad.l + (groups.length > 1 ? (i / (groups.length - 1)) * iw : iw / 2);
    const y = (v: number) => pad.t + ih - ((v - min) / span) * ih;
    const every = Math.max(1, Math.ceil(groups.length / (compact ? 4 : 8)));
    return (
      <>
        <svg className="rb-line-svg" viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" role="img" aria-label={fmt.fieldLabel(d0)} data-testid="rb-line">
          {[0, 1, 2, 3, 4].map((k) => {
            const v = min + (span * k) / 4;
            return (
              <g key={k}>
                <line className="chart-grid" x1={pad.l} x2={pad.l + iw} y1={y(v)} y2={y(v)} />
                <text className="rb-axis-label" x={pad.l - 8} y={y(v) + 4} textAnchor="end">
                  {fmt.num(Math.round(v))}
                </text>
              </g>
            );
          })}
          {series.map((s) => (
            <g key={s.key} className={s.cls || 'rb-s1'}>
              <path className="rb-line-path" d={groups.map((g, i) => `${i ? 'L' : 'M'} ${x(i)} ${y(cell(g.key, s.key))}`).join(' ')} vectorEffect="non-scaling-stroke" />
              {groups.map((g, i) => (
                <circle key={g.key} className="rb-line-dot" cx={x(i)} cy={y(cell(g.key, s.key))} r={4} vectorEffect="non-scaling-stroke">
                  <title>{`${g.label}${s.label ? ` · ${s.label}` : ''}: ${fmtValue(cell(g.key, s.key))}`}</title>
                </circle>
              ))}
            </g>
          ))}
          {groups.map((g, i) =>
            i % every === 0 ? (
              <text key={g.key} className="rb-axis-label" x={x(i)} y={H - 8} textAnchor="middle">
                {g.label}
              </text>
            ) : null,
          )}
        </svg>
        {legend}
      </>
    );
  }

  // Barras horizontales (apiladas si hay segunda dimensión).
  const totals = groups.map((g) => series.reduce((acc, s) => acc + Math.max(0, cell(g.key, s.key)), 0));
  const max = Math.max(1, ...totals);
  return (
    <>
      <div className="rb-bars" data-testid="rb-bars">
        {groups.map((g, gi) => (
          <div key={g.key} className="rb-bar-row">
            <span className="rb-bar-label" title={g.label}>
              {g.label}
            </span>
            <span className="rb-bar-track">
              {series.map((s) => {
                const v = cell(g.key, s.key);
                if (v <= 0) return null;
                return (
                  <span
                    key={s.key}
                    className={`rb-bar-seg ${s.cls}`}
                    style={{ width: `${(v / max) * 100}%` }}
                    title={`${g.label}${s.label ? ` · ${s.label}` : ''}: ${fmtValue(v)}`}
                  />
                );
              })}
            </span>
            <span className="rb-bar-value">{fmtValue(totals[gi])}</span>
          </div>
        ))}
      </div>
      {legend}
    </>
  );
}

function niceCeil(max: number): number {
  if (max <= 1) return 1;
  const pow = Math.pow(10, Math.floor(Math.log10(max)));
  const n = max / pow;
  return (n <= 1 ? 1 : n <= 2 ? 2 : n <= 5 ? 5 : 10) * pow;
}

function RecordsTable({ result, fmt }: { result: Extract<ReportResult, { kind: 'records' }>; fmt: ReturnType<typeof useReportFormat> }) {
  if (!result.rows.length) return <p className="muted breakdown-empty">{fmt.t('reportBuilder.emptyResult')}</p>;
  return (
    <>
      <div className="rb-scroll">
        <table className="table rb-table" data-testid="rb-table">
          <thead>
            <tr>
              {result.columns.map((c) => (
                <th key={c.key} className={c.type === 'number' ? 'num' : undefined}>
                  {fmt.fieldLabel(c)}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {result.rows.map((r, i) => (
              <tr key={`${r.id}-${i}`}>
                {r.cells.map((v, j) => {
                  const col = result.columns[j];
                  const text = fmt.value(col, v, result.labels);
                  return (
                    <td key={j} className={col.type === 'number' ? 'num' : undefined}>
                      {j === 0 && r.href ? <Link href={r.href}>{text}</Link> : text}
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="muted rb-note">
        {result.truncated ? fmt.t('reportBuilder.recordsTruncated', { shown: result.rows.length, total: result.total }) : fmt.t('reportBuilder.records', { count: result.total })}
      </p>
    </>
  );
}

/** Filas de CSV para un resultado (mismo texto que se ve en pantalla). */
export function resultToCsvRows(
  result: ReportResult,
  fmt: ReturnType<typeof useReportFormat>,
): { header: string[]; rows: Array<Array<string | number | null>> } {
  if (result.kind === 'records') {
    return {
      header: result.columns.map((c) => fmt.fieldLabel(c)),
      rows: result.rows.map((r) =>
        r.cells.map((v, j) => {
          const col = result.columns[j];
          if (col.type === 'number' && v !== null) return Number(v);
          return v === null ? '' : fmt.value(col, v, result.labels);
        }),
      ),
    };
  }
  const header = [...result.dimensions.map((d) => fmt.fieldLabel(d)), metricLabel(result, fmt)];
  if (!result.dimensions.length) return { header, rows: [[result.total]] };
  return {
    header,
    rows: result.rows.map((r) => [...r.keys.map((k, j) => fmt.value(result.dimensions[j], k, result.labels)), r.value]),
  };
}

