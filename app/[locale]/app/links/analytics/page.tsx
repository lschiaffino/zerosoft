import { getTranslations } from 'next-intl/server';
import { Link } from '@/i18n/navigation';
import { requireUser } from '@/lib/session';
import { getWorkspaceAnalytics, parseWorkspaceRange } from '@/lib/link-analytics';
import { formatNumber } from '@/lib/utils';
import PageHeader from '@/components/ui/PageHeader';
import DataTable from '@/components/ui/DataTable';
import EmptyState from '@/components/ui/EmptyState';
import LinkChart from '@/components/link/LinkChart';
import LinkIcon from '@/components/link/LinkIcon';
import { breakdownLabelers } from '@/lib/link-labels';
import BreakdownBars from '@/components/link/BreakdownBars';

export const dynamic = 'force-dynamic';

interface Props {
  params: Promise<{ locale: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}

function one(v: string | string[] | undefined): string | undefined {
  return typeof v === 'string' ? v : undefined;
}

function shift(date: string, days: number): string {
  const d = new Date(`${date}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

function delta(now: number, prev: number, newLabel: string): { text: string; dir: 'up' | 'down' | 'flat' } | null {
  if (prev === 0) return now > 0 ? { text: newLabel, dir: 'up' } : null;
  const pct = Math.round(((now - prev) / prev) * 100);
  if (pct === 0) return { text: '0%', dir: 'flat' };
  return { text: `${pct > 0 ? '+' : '−'}${Math.abs(pct)}%`, dir: pct > 0 ? 'up' : 'down' };
}

export default async function LinkAnalyticsPage(props: Props) {
  const { locale } = await props.params;
  const sp = await props.searchParams;
  const user = await requireUser(locale);
  const t = await getTranslations({ locale, namespace: 'link' });

  const range = parseWorkspaceRange(one(sp.from), one(sp.to));
  const a = await getWorkspaceAnalytics(user.id, range);
  const today = new Date().toISOString().slice(0, 10);
  const presets = [
    { days: 7, label: t('analytics.last7') },
    { days: 30, label: t('analytics.last30') },
    { days: 90, label: t('analytics.last90') },
    { days: 365, label: t('analytics.last365') },
  ].map((p) => ({ ...p, from: shift(today, -(p.days - 1)), to: today }));

  const labels = breakdownLabelers(locale, {
    direct: t('common.direct'),
    other: t('common.other'),
    unknown: t('labels.unknown'),
    variantDefault: t('detail.variantDefault'),
    device: { desktop: t('labels.desktop'), mobile: t('labels.mobile'), tablet: t('labels.tablet') },
    rule: (n) => t('labels.rule', { n }),
    ab: (v) => t('labels.ab', { v }),
    app: (os) => t('labels.app', { os }),
  });
  const noData = t('analytics.noData');
  const q = `from=${range.from}&to=${range.to}`;
  const dClicks = delta(a.clicks, a.previous.clicks, t('analytics.new'));
  const dScans = delta(a.scans, a.previous.scans, t('analytics.new'));

  return (
    <div className="ui-page link-analytics">
      <PageHeader
        title={t('analytics.title')}
        description={t('analytics.sub')}
        actions={
          <a href={`/api/links/analytics/export.csv?${q}`} className="btn" data-testid="analytics-export">
            <LinkIcon name="download" size={15} />
            {t('analytics.exportCsv')}
          </a>
        }
      />

      <form className="lk-toolbar" method="get">
        <div className="btn-group lk-range" role="group" aria-label={t('detail.rangeLabel')}>
          {presets.map((p) => (
            <Link
              key={p.days}
              href={{ pathname: '/app/links/analytics', query: { from: p.from, to: p.to } }}
              className="btn btn-sm"
              aria-current={p.from === range.from && p.to === range.to ? 'true' : undefined}
            >
              {p.label}
            </Link>
          ))}
        </div>
        <div className="lk-dates">
          <label className="lk-inline-field">
            <span className="label">{t('analytics.from')}</span>
            <input type="date" name="from" defaultValue={range.from} className="input mono" />
          </label>
          <label className="lk-inline-field">
            <span className="label">{t('analytics.to')}</span>
            <input type="date" name="to" defaultValue={range.to} className="input mono" />
          </label>
          <button type="submit" className="btn btn-sm">
            {t('analytics.apply')}
          </button>
        </div>
      </form>

      <dl className="lk-stats lk-stats-2">
        <div className="lk-stat">
          <dt>{t('analytics.clicks')}</dt>
          <dd className="data num" data-testid="analytics-clicks">
            {formatNumber(a.clicks, locale)}
          </dd>
          {dClicks && (
            <dd className="lk-stat-sub lk-delta" data-dir={dClicks.dir}>
              {t('detail.vsPrevious', { delta: dClicks.text })}
            </dd>
          )}
        </div>
        <div className="lk-stat">
          <dt>{t('analytics.scans')}</dt>
          <dd className="data num" data-testid="analytics-scans">
            {formatNumber(a.scans, locale)}
          </dd>
          {dScans && (
            <dd className="lk-stat-sub lk-delta" data-dir={dScans.dir}>
              {t('detail.vsPrevious', { delta: dScans.text })}
            </dd>
          )}
        </div>
      </dl>

      <section className="panel lk-panel" aria-labelledby="la-chart-title">
        <div className="lk-panel-head">
          <h2 className="lk-h" id="la-chart-title">
            {t('analytics.chartLabel')}
          </h2>
          <div className="lk-legend">
            <span className="lk-key lk-key-1">{t('analytics.legendClicks')}</span>
            <span className="lk-key lk-key-2">{t('analytics.legendScans')}</span>
          </div>
        </div>
        <LinkChart
          data={a.byDay.map((d) => ({ date: d.date, count: d.clicks }))}
          secondary={a.byDay.map((d) => ({ date: d.date, count: d.scans }))}
        />
      </section>

      <section className="lk-section" aria-labelledby="la-top-title">
        <h2 className="lk-h" id="la-top-title">
          {t('analytics.topLinks')}
        </h2>
        <DataTable
          caption={t('analytics.topLinks')}
          rows={a.topLinks}
          rowKey={(l) => l.id}
          rowHref={(l) => `/app/links/${l.id}`}
          compact
          empty={<EmptyState title={t('analytics.empty')} body={t('analytics.emptyBody')} quiet product="link" />}
          columns={[
            {
              key: 'link',
              header: t('analytics.colLink'),
              data: true,
              cell: (l) => l.short_url.replace(/^https?:\/\//, ''),
            },
            {
              key: 'dest',
              header: t('table.destination'),
              cell: (l) => <span className="lk-dest-text">{l.title || l.url}</span>,
            },
            { key: 'clicks', header: t('analytics.colClicks'), numeric: true, data: true, cell: (l) => formatNumber(l.clicks, locale) },
            { key: 'scans', header: t('analytics.colScans'), numeric: true, data: true, cell: (l) => formatNumber(l.scans, locale) },
          ]}
        />
      </section>

      <div className="lk-grid-2">
        {(
          [
            ['referrers', a.referrers, labels.plain],
            ['countries', a.countries, labels.country],
            ['devices', a.devices, labels.device],
            ['browsers', a.browsers, labels.plain],
          ] as const
        ).map(([key, items, labelFor]) => (
          <section key={key} className="panel lk-panel" aria-labelledby={`la-${key}`}>
            <h2 className="lk-h" id={`la-${key}`}>
              {t(`analytics.${key}`)}
            </h2>
            <BreakdownBars items={items} emptyLabel={noData} labelFor={labelFor} />
          </section>
        ))}
      </div>
    </div>
  );
}
