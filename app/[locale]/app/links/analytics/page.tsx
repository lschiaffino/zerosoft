import { getTranslations } from 'next-intl/server';
import { Link } from '@/i18n/navigation';
import { requireUser } from '@/lib/session';
import { getWorkspaceAnalytics, parseWorkspaceRange } from '@/lib/link-analytics';
import { formatNumber } from '@/lib/utils';
import LinkChart from '@/components/link/LinkChart';
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

function delta(now: number, prev: number, newLabel: string): string {
  if (prev === 0) return now > 0 ? `↑ ${newLabel}` : '·';
  const pct = Math.round(((now - prev) / prev) * 100);
  return `${now >= prev ? '↑' : '↓'} ${Math.abs(pct)}%`;
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
  const label = labels.plain;
  const noData = t('analytics.noData');
  const q = `from=${range.from}&to=${range.to}`;

  return (
    <div className="app-page link-analytics">
      <div className="page-head">
        <h1 className="app-title">{t('analytics.title')}</h1>
        <a href={`/api/links/analytics/export.csv?${q}`} className="btn btn-small" data-testid="analytics-export">
          {t('analytics.exportCsv')}
        </a>
      </div>

      <form className="la-range" method="get">
        <div className="range-switch mono">
          {presets.map((p) =>
            p.from === range.from && p.to === range.to ? (
              <span key={p.days} className="range-btn active">
                {p.label}
              </span>
            ) : (
              <Link
                key={p.days}
                href={{ pathname: '/app/links/analytics', query: { from: p.from, to: p.to } }}
                className="range-btn"
              >
                {p.label}
              </Link>
            ),
          )}
        </div>
        <label className="la-date mono">
          {t('analytics.from')}
          <input type="date" name="from" defaultValue={range.from} className="input" />
        </label>
        <label className="la-date mono">
          {t('analytics.to')}
          <input type="date" name="to" defaultValue={range.to} className="input" />
        </label>
        <button type="submit" className="btn btn-small">
          {t('analytics.apply')}
        </button>
      </form>

      <div className="stat-cards la-stats">
        <div className="panel stat-card">
          <span className="stat-num" data-testid="analytics-clicks">
            {formatNumber(a.clicks, locale)}
          </span>
          <span className="stat-label">
            {t('analytics.clicks')} <span className="mono">{delta(a.clicks, a.previous.clicks, t('analytics.new'))}</span>
          </span>
        </div>
        <div className="panel stat-card">
          <span className="stat-num" data-testid="analytics-scans">
            {formatNumber(a.scans, locale)}
          </span>
          <span className="stat-label">
            {t('analytics.scans')} <span className="mono">{delta(a.scans, a.previous.scans, t('analytics.new'))}</span>
          </span>
        </div>
      </div>

      <section className="panel chart-panel">
        <div className="panel-head">
          <p className="section-label">{t('analytics.chartLabel')}</p>
          <div className="la-legend mono">
            <span className="la-key la-key-1">{t('analytics.legendClicks')}</span>
            <span className="la-key la-key-2">{t('analytics.legendScans')}</span>
          </div>
        </div>
        <LinkChart
          data={a.byDay.map((d) => ({ date: d.date, count: d.clicks }))}
          secondary={a.byDay.map((d) => ({ date: d.date, count: d.scans }))}
        />
      </section>

      <section className="panel">
        <p className="section-label">{t('analytics.topLinks')}</p>
        {a.topLinks.length === 0 ? (
          <p className="muted">{t('analytics.empty')}</p>
        ) : (
          <div className="table-wrap">
            <table className="table links-table la-top">
              <thead>
                <tr>
                  <th>{t('analytics.colLink')}</th>
                  <th className="num">{t('analytics.colClicks')}</th>
                  <th className="num">{t('analytics.colScans')}</th>
                </tr>
              </thead>
              <tbody>
                {a.topLinks.map((l) => (
                  <tr key={l.id}>
                    <td className="cell-url">
                      <Link href={`/app/links/${l.id}`} className="mono">
                        {l.short_url.replace(/^https?:\/\//, '')}
                      </Link>
                      <span className="muted la-dest">{l.title || l.url}</span>
                    </td>
                    <td className="num mono">{formatNumber(l.clicks, locale)}</td>
                    <td className="num mono">{formatNumber(l.scans, locale)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <div className="breakdown-grid la-grid">
        <section className="panel">
          <p className="section-label">{t('analytics.referrers')}</p>
          <BreakdownBars items={a.referrers} emptyLabel={noData} labelFor={label} />
        </section>
        <section className="panel">
          <p className="section-label">{t('analytics.countries')}</p>
          <BreakdownBars items={a.countries} emptyLabel={noData} labelFor={labels.country} />
        </section>
        <section className="panel">
          <p className="section-label">{t('analytics.devices')}</p>
          <BreakdownBars items={a.devices} emptyLabel={noData} labelFor={labels.device} />
        </section>
        <section className="panel">
          <p className="section-label">{t('analytics.browsers')}</p>
          <BreakdownBars items={a.browsers} emptyLabel={noData} labelFor={label} />
        </section>
      </div>
    </div>
  );
}
