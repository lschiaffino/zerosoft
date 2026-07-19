'use client';

import { useTranslations } from 'next-intl';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import {
  ACTIVITY_TYPES,
  LIFECYCLE_STAGES,
  PRIORITIES,
  SOURCES,
} from '@/lib/crm-constants';
import { type CrmReports, type FunnelStage } from '@/lib/crm';
import {
  type Kpis,
  type OwnerMetric,
  type ReportBucket,
  type ReportFilters,
  type ReportRangeLabel,
  type TimeseriesPoint,
} from '@/lib/crm-reports';
import { formatNumber } from '@/lib/utils';
import PipelineSelect from './PipelineSelect';

interface ReportsViewProps {
  reports: CrmReports;
  funnel: FunnelStage[];
  forecastByStage: CrmReports['forecastByStage'];
  pipelines: Array<{ id: string; name: string }>;
  selectedPipelineId: string | null;
  locale: string;
  range: ReportRangeLabel;
  bucket: ReportBucket;
  filters: ReportFilters;
  kpis: Kpis;
  timeseries: TimeseriesPoint[];
  byOwner: OwnerMetric[];
  owners: Array<{ id: string; email: string; name: string | null }>;
  sources: Array<{ value: string; label: string }>;
  priorities: Array<{ value: string; label: string }>;
}

const RANGES: ReportRangeLabel[] = ['7d', '30d', '90d', 'quarter', '12m'];
const BUCKETS: ReportBucket[] = ['day', 'week', 'month', 'quarter'];

function niceCeil(max: number): number {
  if (max <= 1) return 1;
  const pow = Math.pow(10, Math.floor(Math.log10(max)));
  const n = max / pow;
  const nice = n <= 1 ? 1 : n <= 2 ? 2 : n <= 5 ? 5 : 10;
  return nice * pow;
}

function formatMoney(n: number, locale: string): string {
  return new Intl.NumberFormat(locale, {
    style: 'currency',
    currency: 'USD',
    maximumFractionDigits: 0,
  }).format(n);
}

function monthLabel(month: string, locale: string): string {
  const [y, m] = month.split('-').map(Number);
  return new Intl.DateTimeFormat(locale, { month: 'short', timeZone: 'UTC' }).format(
    new Date(Date.UTC(y, m - 1, 1)),
  );
}

function bucketLabel(bucket: string, locale: string): string {
  if (/^\d{4}-\d{2}-\d{2}$/.test(bucket)) {
    return new Intl.DateTimeFormat(locale, { month: 'short', day: 'numeric' }).format(
      new Date(`${bucket}T00:00:00Z`),
    );
  }
  if (/^\d{4}-W\d{2}$/.test(bucket)) {
    return bucket;
  }
  if (/^\d{4}-\d{2}$/.test(bucket)) {
    return monthLabel(bucket, locale);
  }
  if (/^\d{4}-Q\d$/.test(bucket)) {
    return bucket;
  }
  return bucket;
}

interface BarItem {
  name: string;
  count: number;
}

function ProporBars({
  items,
  emptyLabel,
  labelFor,
  titleFor,
  locale,
}: {
  items: BarItem[];
  emptyLabel: string;
  labelFor: (name: string) => string;
  titleFor?: (item: BarItem) => string;
  locale: string;
}) {
  if (items.length === 0) return <p className="muted breakdown-empty">{emptyLabel}</p>;
  const max = Math.max(...items.map((i) => i.count), 1);
  return (
    <div className="breakdown">
      {items.map((item) => (
        <div className="breakdown-row" key={item.name}>
          <span className="breakdown-name" title={item.name}>
            {labelFor(item.name)}
          </span>
          <span className="breakdown-track" title={titleFor ? titleFor(item) : undefined}>
            <span
              className="breakdown-bar"
              style={{ width: `${Math.max((item.count / max) * 100, 2)}%` }}
            />
          </span>
          <span className="breakdown-count mono">{formatNumber(item.count, locale)}</span>
        </div>
      ))}
    </div>
  );
}

function WonLostChart({
  data,
  locale,
  labels,
}: {
  data: CrmReports['wonLostByMonth'];
  locale: string;
  labels: { won: string; lost: string; empty: string };
}) {
  const W = 760;
  const H = 240;
  const pad = { t: 18, r: 14, b: 30, l: 42 };
  const iw = W - pad.l - pad.r;
  const ih = H - pad.t - pad.b;
  const baseline = pad.t + ih;

  const max = niceCeil(Math.max(...data.map((d) => Math.max(d.won, d.lost)), 0));
  const hasData = data.some((d) => d.won > 0 || d.lost > 0);
  const stepX = data.length > 0 ? iw / data.length : iw;
  const bw = Math.min(16, stepX / 4);

  const gridRows = [0, 1, 2, 3, 4].map((k) => {
    const value = (max * k) / 4;
    const y = pad.t + ih - (value / max) * ih;
    return { value, y };
  });

  return (
    <>
      <svg
        className="link-chart"
        viewBox={`0 0 ${W} ${H}`}
        role="img"
        aria-label="won vs lost chart"
        preserveAspectRatio="none"
      >
        {gridRows.map((g) => (
          <g key={g.value}>
            <line className="chart-grid" x1={pad.l} x2={pad.l + iw} y1={g.y} y2={g.y} />
            <text className="chart-ylabel" x={pad.l - 8} y={g.y + 4} textAnchor="end">
              {g.value}
            </text>
          </g>
        ))}
        {hasData &&
          data.map((d, i) => {
            const cx = pad.l + stepX * (i + 0.5);
            const wonH = (d.won / max) * ih;
            const lostH = (d.lost / max) * ih;
            return (
              <g key={d.month}>
                <rect
                  className="chart-bar"
                  x={cx - bw - 2}
                  y={baseline - wonH}
                  width={bw}
                  height={wonH}
                >
                  <title>{`${monthLabel(d.month, locale)} · ${labels.won}: ${d.won}`}</title>
                </rect>
                <rect
                  className="chart-bar-lost"
                  x={cx + 2}
                  y={baseline - lostH}
                  width={bw}
                  height={lostH}
                >
                  <title>{`${monthLabel(d.month, locale)} · ${labels.lost}: ${d.lost}`}</title>
                </rect>
              </g>
            );
          })}
        {data.map((d, i) => (
          <text
            key={d.month}
            className="chart-xlabel"
            x={pad.l + stepX * (i + 0.5)}
            y={H - 8}
            textAnchor="middle"
          >
            {monthLabel(d.month, locale)}
          </text>
        ))}
      </svg>
      {!hasData && <p className="muted breakdown-empty">{labels.empty}</p>}
    </>
  );
}

function TimeseriesChart({
  data,
  locale,
}: {
  data: TimeseriesPoint[];
  locale: string;
}) {
  const W = 760;
  const H = 240;
  const pad = { t: 18, r: 14, b: 36, l: 52 };
  const iw = W - pad.l - pad.r;
  const ih = H - pad.t - pad.b;
  const baseline = pad.t + ih;

  const maxCount = niceCeil(Math.max(...data.map((d) => Math.max(d.contacts, d.deals)), 1));
  const maxAmount = niceCeil(Math.max(...data.map((d) => d.wonAmount), 1));
  const hasData = data.some((d) => d.contacts > 0 || d.deals > 0 || d.wonAmount > 0);
  const stepX = data.length > 0 ? iw / data.length : iw;
  const bw = Math.min(10, stepX / 5);

  return (
    <>
      <svg
        className="link-chart"
        viewBox={`0 0 ${W} ${H}`}
        role="img"
        aria-label="activity over time"
        preserveAspectRatio="none"
      >
        {[0, 1, 2, 3, 4].map((k) => {
          const value = (maxCount * k) / 4;
          const y = pad.t + ih - (value / maxCount) * ih;
          return (
            <g key={k}>
              <line className="chart-grid" x1={pad.l} x2={pad.l + iw} y1={y} y2={y} />
              <text className="chart-ylabel" x={pad.l - 8} y={y + 4} textAnchor="end">
                {formatNumber(value, locale)}
              </text>
            </g>
          );
        })}
        {hasData &&
          data.map((d, i) => {
            const cx = pad.l + stepX * (i + 0.5);
            const contactsH = (d.contacts / maxCount) * ih;
            const dealsH = (d.deals / maxCount) * ih;
            const amountH = (d.wonAmount / maxAmount) * ih;
            return (
              <g key={d.bucket}>
                <rect
                  className="chart-bar"
                  x={cx - bw - bw - 2}
                  y={baseline - contactsH}
                  width={bw}
                  height={contactsH}
                >
                  <title>{`${bucketLabel(d.bucket, locale)} · contacts: ${d.contacts}`}</title>
                </rect>
                <rect
                  className="chart-bar-lost"
                  x={cx - bw / 2}
                  y={baseline - dealsH}
                  width={bw}
                  height={dealsH}
                >
                  <title>{`${bucketLabel(d.bucket, locale)} · deals: ${d.deals}`}</title>
                </rect>
                <rect
                  className="chart-bar-amount"
                  x={cx + bw / 2 + 2}
                  y={baseline - amountH}
                  width={bw}
                  height={amountH}
                >
                  <title>{`${bucketLabel(d.bucket, locale)} · won: ${formatMoney(d.wonAmount, locale)}`}</title>
                </rect>
              </g>
            );
          })}
        {data.map((d, i) => (
          <text
            key={d.bucket}
            className="chart-xlabel"
            x={pad.l + stepX * (i + 0.5)}
            y={H - 8}
            textAnchor="middle"
          >
            {bucketLabel(d.bucket, locale)}
          </text>
        ))}
      </svg>
      {!hasData && <p className="muted breakdown-empty">No data for this period.</p>}
    </>
  );
}

function Delta({ value }: { value: number }) {
  const positive = value >= 0;
  return (
    <span className={`stat-delta ${positive ? 'up' : 'down'}`}>
      {positive ? '▲' : '▼'} {Math.abs(value)}%
    </span>
  );
}

function KpiCard({
  label,
  value,
  delta,
  money = false,
  locale,
}: {
  label: string;
  value: number;
  delta: number;
  money?: boolean;
  locale: string;
}) {
  return (
    <div className="panel stat-card">
      <span className="stat-num">{money ? formatMoney(value, locale) : formatNumber(value, locale)}</span>
      <span className="stat-label">{label}</span>
      <Delta value={delta} />
    </div>
  );
}

function FilterSelect({
  label,
  value,
  options,
  param,
}: {
  label: string;
  value: string;
  options: Array<{ value: string; label: string }>;
  param: string;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();

  function set(v: string) {
    const params = new URLSearchParams(searchParams.toString());
    if (v) params.set(param, v);
    else params.delete(param);
    router.push(`${pathname}?${params.toString()}`);
  }

  return (
    <label className="report-filter">
      <span>{label}</span>
      <select className="filter-select" value={value} onChange={(e) => set(e.target.value)}>
        <option value="">{label}</option>
        {options.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </select>
    </label>
  );
}

function RangeSelector({ range }: { range: ReportRangeLabel }) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();

  function setRange(r: ReportRangeLabel) {
    const params = new URLSearchParams(searchParams.toString());
    params.set('range', r);
    router.push(`${pathname}?${params.toString()}`);
  }

  return (
    <div className="report-tabs">
      {RANGES.map((r) => (
        <button
          key={r}
          type="button"
          className={`report-tab${r === range ? ' active' : ''}`}
          onClick={() => setRange(r)}
        >
          {r}
        </button>
      ))}
    </div>
  );
}

function BucketSelector({ bucket }: { bucket: ReportBucket }) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();

  function setBucket(b: ReportBucket) {
    const params = new URLSearchParams(searchParams.toString());
    params.set('bucket', b);
    router.push(`${pathname}?${params.toString()}`);
  }

  return (
    <div className="report-tabs">
      {BUCKETS.map((b) => (
        <button
          key={b}
          type="button"
          className={`report-tab${b === bucket ? ' active' : ''}`}
          onClick={() => setBucket(b)}
        >
          {b}
        </button>
      ))}
    </div>
  );
}

export default function ReportsView({
  reports,
  funnel,
  forecastByStage,
  pipelines,
  selectedPipelineId,
  locale,
  range,
  bucket,
  filters,
  kpis,
  timeseries,
  byOwner,
  owners,
  sources,
  priorities,
}: ReportsViewProps) {
  const t = useTranslations('crm');

  const funnelMax = Math.max(...funnel.map((s) => s.count), 1);
  const forecastTotal = forecastByStage.reduce((s, f) => s + f.forecast, 0);
  const forecastMax = Math.max(...forecastByStage.map((f) => f.forecast, 1));

  const sourceLabel = (n: string) =>
    (SOURCES as readonly string[]).includes(n) ? t(`enums.source.${n}`) : n;
  const lifecycleLabel = (n: string) =>
    (LIFECYCLE_STAGES as readonly string[]).includes(n) ? t(`enums.lifecycle.${n}`) : n;
  const activityLabel = (n: string) =>
    (ACTIVITY_TYPES as readonly string[]).includes(n) ? t(`enums.activityType.${n}`) : n;
  const priorityLabel = (n: string) =>
    (PRIORITIES as readonly string[]).includes(n) ? t(`enums.priority.${n}`) : n;

  return (
    <div className="reports">
      <div className="report-controls">
        <RangeSelector range={range} />
        <BucketSelector bucket={bucket} />
      </div>

      <div className="report-filters">
        <FilterSelect
          label={t('reports.pipeline')}
          value={selectedPipelineId ?? ''}
          options={pipelines.map((p) => ({ value: p.id, label: p.name }))}
          param="pipeline"
        />
        <FilterSelect
          label={t('deals.form.source')}
          value={filters.source ?? ''}
          options={sources}
          param="source"
        />
        <FilterSelect
          label={t('deals.form.priority')}
          value={filters.priority ?? ''}
          options={priorities}
          param="priority"
        />
        <FilterSelect
          label={t('contacts.form.owner')}
          value={filters.ownerId ?? ''}
          options={owners.map((o) => ({ value: o.id, label: o.name ?? o.email }))}
          param="owner"
        />
      </div>

      <div className="kpi-grid">
        <KpiCard
          label={t('reports.kpi.newContacts')}
          value={kpis.newContacts}
          delta={kpis.newContactsDelta}
          locale={locale}
        />
        <KpiCard
          label={t('reports.kpi.newDeals')}
          value={kpis.newDeals}
          delta={kpis.newDealsDelta}
          locale={locale}
        />
        <KpiCard
          label={t('reports.kpi.wonAmount')}
          value={kpis.wonAmount}
          delta={kpis.wonAmountDelta}
          money
          locale={locale}
        />
        <KpiCard
          label={t('reports.kpi.activities')}
          value={kpis.activities}
          delta={kpis.activitiesDelta}
          locale={locale}
        />
      </div>

      <section className="panel chart-panel">
        <div className="panel-head">
          <p className="section-label">{t('reports.activityOverTime')}</p>
        </div>
        <TimeseriesChart data={timeseries} locale={locale} />
      </section>

      <section className="panel">
        <p className="section-label">{t('reports.byOwner')}</p>
        {byOwner.length === 0 ? (
          <p className="muted breakdown-empty">{t('reports.empty')}</p>
        ) : (
          <table className="table owner-table">
            <thead>
              <tr>
                <th>{t('contacts.form.owner')}</th>
                <th className="th-num">{t('contacts.title')}</th>
                <th className="th-num">{t('deals.title')}</th>
                <th className="th-num">{t('reports.kpi.wonAmount')}</th>
                <th className="th-num">{t('reports.activities')}</th>
              </tr>
            </thead>
            <tbody>
              {byOwner.map((o) => (
                <tr key={o.id}>
                  <td>{o.name ?? o.email}</td>
                  <td className="mono td-num">{formatNumber(o.contacts, locale)}</td>
                  <td className="mono td-num">{formatNumber(o.deals, locale)}</td>
                  <td className="mono td-num">{formatMoney(o.wonAmount, locale)}</td>
                  <td className="mono td-num">{formatNumber(o.activities, locale)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>

      <div className="overview-grid">
        <section className="panel">
          <div className="panel-head">
            <p className="section-label">{t('reports.funnel')}</p>
            {pipelines.length > 1 && (
              <PipelineSelect
                pipelines={pipelines}
                selectedId={selectedPipelineId}
                label={t('reports.pipeline')}
              />
            )}
          </div>
          {funnel.length === 0 ? (
            <p className="muted breakdown-empty">{t('reports.empty')}</p>
          ) : (
            <div className="breakdown">
              {funnel.map((stage, i) => {
                const prev = i > 0 ? funnel[i - 1] : null;
                const conv =
                  prev && prev.count > 0 ? Math.round((stage.count / prev.count) * 100) : null;
                return (
                  <div className="funnel-row" key={stage.id}>
                    <span className="breakdown-name" title={stage.name}>
                      {stage.name}
                    </span>
                    <span
                      className="breakdown-track"
                      title={`${formatNumber(stage.count, locale)} · ${formatMoney(stage.amount, locale)}`}
                    >
                      <span
                        className="breakdown-bar"
                        style={{ width: `${Math.max((stage.count / funnelMax) * 100, 2)}%` }}
                      />
                    </span>
                    <span className="funnel-stats mono">
                      {formatNumber(stage.count, locale)}
                      <span className="funnel-sep">·</span>
                      {formatMoney(stage.amount, locale)}
                      {conv !== null && (
                        <span className="funnel-conv" title={t('reports.vsPrev')}>
                          {conv}%
                        </span>
                      )}
                    </span>
                  </div>
                );
              })}
            </div>
          )}
        </section>

        <section className="panel">
          <div className="panel-head">
            <p className="section-label">{t('reports.forecastByStage')}</p>
            {pipelines.length > 1 && (
              <span className="muted panel-more">
                {pipelines.find((p) => p.id === selectedPipelineId)?.name}
              </span>
            )}
          </div>
          <div className="report-total">
            <span className="stat-num">{formatMoney(forecastTotal, locale)}</span>
            <span className="stat-label">
              {t('reports.total')} · {t('reports.forecast')}
            </span>
          </div>
          {forecastByStage.length === 0 ? (
            <p className="muted breakdown-empty">{t('reports.empty')}</p>
          ) : (
            <div className="breakdown">
              {forecastByStage.map((stage) => (
                <div className="funnel-row" key={stage.id}>
                  <span className="breakdown-name" title={stage.name}>
                    {stage.name}
                  </span>
                  <span
                    className="breakdown-track"
                    title={`${formatNumber(stage.count, locale)} · ${formatMoney(stage.amount, locale)} × ${stage.probability}%`}
                  >
                    <span
                      className="breakdown-bar"
                      style={{ width: `${Math.max((stage.forecast / forecastMax) * 100, 2)}%` }}
                    />
                  </span>
                  <span className="funnel-stats mono">
                    {formatMoney(stage.forecast, locale)}
                    <span className="funnel-sep">·</span>
                    {stage.probability}%
                  </span>
                </div>
              ))}
            </div>
          )}
        </section>
      </div>

      <section className="panel chart-panel">
        <div className="panel-head">
          <p className="section-label">{t('reports.wonLost')}</p>
          <div className="chart-legend">
            <span className="chart-legend-item">
              <span className="chart-swatch" aria-hidden /> {t('overview.won')}
            </span>
            <span className="chart-legend-item">
              <span className="chart-swatch outline" aria-hidden /> {t('overview.lost')}
            </span>
          </div>
        </div>
        <WonLostChart
          data={reports.wonLostByMonth}
          locale={locale}
          labels={{
            won: t('overview.won'),
            lost: t('overview.lost'),
            empty: t('reports.empty'),
          }}
        />
      </section>

      <div className="breakdown-grid">
        <section className="panel">
          <p className="section-label">{t('reports.dealsBySource')}</p>
          <ProporBars
            items={reports.dealsBySource.map((d) => ({ name: d.source, count: d.count }))}
            emptyLabel={t('reports.empty')}
            labelFor={sourceLabel}
            titleFor={(item) => {
              const row = reports.dealsBySource.find((d) => d.source === item.name);
              return row ? formatMoney(row.amount, locale) : '';
            }}
            locale={locale}
          />
        </section>
        <section className="panel">
          <p className="section-label">{t('reports.contactsByLifecycle')}</p>
          <ProporBars
            items={reports.contactsByLifecycle.map((c) => ({ name: c.lifecycle, count: c.count }))}
            emptyLabel={t('reports.empty')}
            labelFor={lifecycleLabel}
            locale={locale}
          />
        </section>
        <section className="panel">
          <p className="section-label">{t('reports.activitiesByType')}</p>
          <ProporBars
            items={reports.activitiesByType.map((a) => ({ name: a.type, count: a.count }))}
            emptyLabel={t('reports.empty')}
            labelFor={activityLabel}
            locale={locale}
          />
        </section>
        <section className="panel">
          <p className="section-label">{t('reports.dealsByPriority')}</p>
          <ProporBars
            items={reports.dealsByPriority.map((p) => ({ name: p.priority, count: p.count }))}
            emptyLabel={t('reports.empty')}
            labelFor={priorityLabel}
            titleFor={(item) => {
              const row = reports.dealsByPriority.find((p) => p.priority === item.name);
              return row ? formatMoney(row.amount, locale) : '';
            }}
            locale={locale}
          />
        </section>
        <section className="panel">
          <p className="section-label">{t('reports.lostReasons')}</p>
          <ProporBars
            items={reports.lostReasons.map((r) => ({ name: r.reason, count: r.count }))}
            emptyLabel={t('reports.empty')}
            labelFor={(n) => n}
            locale={locale}
          />
        </section>
      </div>

      <div className="panel stat-card report-avg">
        <span className="stat-num">
          {reports.avgDaysToClose === null ? '—' : formatNumber(reports.avgDaysToClose, locale)}
        </span>
        <span className="stat-label">{t('reports.avgDaysToClose')}</span>
      </div>
    </div>
  );
}
