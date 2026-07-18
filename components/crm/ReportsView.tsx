import { useTranslations } from 'next-intl';
import {
  ACTIVITY_TYPES,
  LIFECYCLE_STAGES,
  SOURCES,
  type CrmReports,
  type FunnelStage,
} from '@/lib/crm';
import { formatNumber } from '@/lib/utils';
import PipelineSelect from './PipelineSelect';

interface ReportsViewProps {
  reports: CrmReports;
  /** Funnel del pipeline seleccionado (default o el de ?pipeline=). */
  funnel: FunnelStage[];
  /** Forecast por stage del pipeline seleccionado. */
  forecastByStage: CrmReports['forecastByStage'];
  pipelines: Array<{ id: string; name: string }>;
  selectedPipelineId: string | null;
  locale: string;
}

/** Rounds up to a "nice" ceiling (1/2/5 × 10^n) so grid labels look clean. */
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
  // timeZone UTC: sin esto, la medianoche UTC del día 1 cae en el mes anterior
  // en zonas UTC-n y el label se corre un mes.
  return new Intl.DateTimeFormat(locale, { month: 'short', timeZone: 'UTC' }).format(
    new Date(Date.UTC(y, m - 1, 1)),
  );
}

interface BarItem {
  name: string;
  count: number;
}

/** Barras proporcionales horizontales (mismo markup que BreakdownBars de Link). */
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

/** Barras agrupadas won (sólida) / lost (outline) por mes, estilo LinkChart. */
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

export default function ReportsView({
  reports,
  funnel,
  forecastByStage,
  pipelines,
  selectedPipelineId,
  locale,
}: ReportsViewProps) {
  const t = useTranslations('crm');

  const funnelMax = Math.max(...funnel.map((s) => s.count), 1);
  const forecastTotal = forecastByStage.reduce((s, f) => s + f.forecast, 0);
  const forecastMax = Math.max(...forecastByStage.map((f) => f.forecast), 1);

  const sourceLabel = (n: string) =>
    (SOURCES as readonly string[]).includes(n) ? t(`enums.source.${n}`) : n;
  const lifecycleLabel = (n: string) =>
    (LIFECYCLE_STAGES as readonly string[]).includes(n) ? t(`enums.lifecycle.${n}`) : n;
  const activityLabel = (n: string) =>
    (ACTIVITY_TYPES as readonly string[]).includes(n) ? t(`enums.activityType.${n}`) : n;

  return (
    <div className="reports">
      <div className="overview-grid">
        {/* ---------- Funnel ---------- */}
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

        {/* ---------- Forecast ponderado ---------- */}
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

      {/* ---------- Won vs Lost (6 meses) ---------- */}
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

      {/* ---------- Breakdowns ---------- */}
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
      </div>

      {/* ---------- Avg days to close ---------- */}
      <div className="panel stat-card report-avg">
        <span className="stat-num">
          {reports.avgDaysToClose === null
            ? '—'
            : formatNumber(reports.avgDaysToClose, locale)}
        </span>
        <span className="stat-label">{t('reports.avgDaysToClose')}</span>
      </div>
    </div>
  );
}
