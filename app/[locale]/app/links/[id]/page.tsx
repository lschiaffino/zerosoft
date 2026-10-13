import { getTranslations } from 'next-intl/server';
import { notFound } from 'next/navigation';
import { Link } from '@/i18n/navigation';
import { requireUser } from '@/lib/session';
import { getUserLink, linkStatus, toLinkDto } from '@/lib/links';
import {
  getAnalytics,
  getClickCountries,
  listClicks,
  type AnalyticsRange,
  parseRange,
} from '@/lib/track';
import { formatDate, formatDateTime, formatNumber, shortUrl } from '@/lib/utils';
import CopyButton from '@/components/link/CopyButton';
import LinkChart from '@/components/link/LinkChart';
import BreakdownBars from '@/components/link/BreakdownBars';
import QrSection from '@/components/link/QrSection';
import EditLinkForm from '@/components/link/EditLinkForm';
import DangerZone from '@/components/link/DangerZone';

export const dynamic = 'force-dynamic';

interface DetailPageProps {
  params: Promise<{ locale: string; id: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}

export default async function LinkDetailPage(props: DetailPageProps) {
  const searchParams = await props.searchParams;
  const params = await props.params;

  const {
    locale,
    id
  } = params;

  const user = await requireUser(locale);
  const t = await getTranslations({ locale, namespace: 'link' });

  const link = await getUserLink(user.id, id);
  if (!link) notFound();

  const rawRange = typeof searchParams.range === 'string' ? searchParams.range : undefined;
  const range: AnalyticsRange = parseRange(rawRange);
  const country = typeof searchParams.country === 'string' ? searchParams.country : undefined;
  const clickPage = Math.max(Number(searchParams.page ?? '1') || 1, 1);
  const clickPageSize = Math.min(Math.max(Number(searchParams.pageSize ?? '25') || 25, 1), 100);

  const a = await getAnalytics(link.id, link.created_at, range);
  const clickResult = await listClicks(link.id, link.created_at, {
    range,
    country,
    page: clickPage,
    pageSize: clickPageSize,
  });
  const countries = await getClickCountries(link.id);

  const today = a.byDay[a.byDay.length - 1]?.count ?? 0;
  const topRef = a.referrers[0]?.name ?? '—';
  const status = linkStatus(link);

  const statusLabel: Record<string, string> = {
    active: t('table.statusActive'),
    archived: t('table.statusArchived'),
    expired: t('table.statusExpired'),
    protected: t('table.statusProtected'),
  };

  const ranges: Array<{ value: AnalyticsRange; label: string }> = [
    { value: '7d', label: t('detail.range7') },
    { value: '30d', label: t('detail.range30') },
    { value: '90d', label: t('detail.range90') },
    { value: 'all', label: t('detail.rangeAll') },
  ];

  const breakdownLabel = (name: string) =>
    name === 'direct' ? t('common.direct') : name === 'other' ? t('common.other') : name;

  const noData = t('detail.noData');

  return (
    <div className="app-page">
      <Link href="/app/links" className="mono back-link">
        {t('detail.back')}
      </Link>

      <header className="detail-header">
        <div className="detail-short">
          <span className="short-url-big mono">{shortUrl(link.slug, link.domain_hostname ?? null)}</span>
          <CopyButton text={shortUrl(link.slug, link.domain_hostname ?? null)} />
          <a
            href={shortUrl(link.slug, link.domain_hostname ?? null)}
            target="_blank"
            rel="noopener noreferrer"
            className="icon-btn"
            title={t('common.open')}
          >
            ↗
          </a>
        </div>
        <div className="detail-meta">
          <span className={`badge status-${status}`}>{statusLabel[status]}</span>
          <span className="muted mono detail-created">
            {t('detail.createdLabel')}: {formatDate(link.created_at, locale)}
          </span>
        </div>
        <a href={link.url} target="_blank" rel="noopener noreferrer" className="muted detail-dest">
          {link.url}
        </a>
      </header>

      <div className="stat-cards">
        <div className="panel stat-card">
          <span className="stat-num">{formatNumber(a.total, locale)}</span>
          <span className="stat-label">{t('detail.total')}</span>
        </div>
        <div className="panel stat-card">
          <span className="stat-num">{formatNumber(today, locale)}</span>
          <span className="stat-label">{t('detail.today')}</span>
        </div>
        <div className="panel stat-card">
          <span className="stat-num">{formatNumber(a.rangeTotal, locale)}</span>
          <span className="stat-label">
            {t('detail.inRange', { range: ranges.find((r) => r.value === range)?.label ?? range })}
            {a.previousTotal !== null && (
              <span className={`stat-delta mono ${a.rangeTotal >= a.previousTotal ? 'up' : 'down'}`}>
                {' '}
                {a.previousTotal === 0
                  ? a.rangeTotal > 0
                    ? '↑ new'
                    : '—'
                  : `${a.rangeTotal >= a.previousTotal ? '↑' : '↓'} ${Math.abs(Math.round(((a.rangeTotal - a.previousTotal) / a.previousTotal) * 100))}%`}
              </span>
            )}
          </span>
        </div>
        <div className="panel stat-card">
          <span className="stat-num stat-num-small mono">{breakdownLabel(topRef)}</span>
          <span className="stat-label">{t('detail.topRef')}</span>
        </div>
      </div>

      <section className="panel chart-panel">
        <div className="panel-head">
          <p className="section-label">{t('detail.chartLabel')}</p>
          <div className="range-switch mono">
            {ranges.map((r) =>
              r.value === range ? (
                <span key={r.value} className="range-btn active">
                  {r.label}
                </span>
              ) : (
                <Link
                  key={r.value}
                  href={{ pathname: `/app/links/${link.id}`, query: { range: r.value } }}
                  className="range-btn"
                >
                  {r.label}
                </Link>
              ),
            )}
          </div>
        </div>
        <LinkChart data={a.byDay} />
      </section>

      <div className="breakdown-grid">
        <section className="panel">
          <p className="section-label">{t('detail.referrers')}</p>
          <BreakdownBars items={a.referrers} emptyLabel={noData} labelFor={breakdownLabel} />
        </section>
        <section className="panel">
          <p className="section-label">{t('detail.countries')}</p>
          <BreakdownBars
            items={a.countries}
            emptyLabel={noData}
            labelFor={(n) => (n === 'other' ? t('common.other') : n)}
          />
        </section>
        <section className="panel">
          <p className="section-label">{t('detail.devices')}</p>
          <BreakdownBars items={a.devices} emptyLabel={noData} />
        </section>
        <section className="panel">
          <p className="section-label">{t('detail.browsers')}</p>
          <BreakdownBars items={a.browsers} emptyLabel={noData} />
        </section>
        <section className="panel">
          <p className="section-label">{t('detail.os')}</p>
          <BreakdownBars items={a.os} emptyLabel={noData} />
        </section>
        <section className="panel" id="qr">
          <p className="section-label">{t('detail.qrTitle')}</p>
          <QrSection id={link.id} slug={link.slug} />
        </section>
      </div>

      <section className="panel" id="clicks">
        <div className="panel-head">
          <p className="section-label">{t('detail.clickLogTitle')}</p>
          <div className="click-log-controls">
            <div className="range-switch mono">
              {ranges.map((r) =>
                r.value === range ? (
                  <span key={r.value} className="range-btn active">
                    {r.label}
                  </span>
                ) : (
                  <Link
                    key={r.value}
                    href={{
                      pathname: `/app/links/${link.id}`,
                      query: { range: r.value, country, page: String(clickPage) },
                    }}
                    className="range-btn"
                  >
                    {r.label}
                  </Link>
                ),
              )}
            </div>
            <a
              href={`/api/links/${link.id}/export.csv?range=${range}${country ? `&country=${encodeURIComponent(country)}` : ''}`}
              className="btn btn-small"
            >
              {t('detail.exportCsv')}
            </a>
          </div>
        </div>

        {countries.length > 0 && (
          <form className="click-filter-row" method="get" action={`/app/links/${link.id}`}>
            <input type="hidden" name="range" value={range} />
            <label className="mono" htmlFor="country-filter">
              {t('detail.countryFilter')}
            </label>
            <select
              id="country-filter"
              name="country"
              className="input mono filter-select"
              defaultValue={country ?? ''}
            >
              <option value="">{t('detail.allCountries')}</option>
              {countries.map((c) => (
                <option key={c} value={c}>
                  {c}
                </option>
              ))}
            </select>
            <button type="submit" className="btn btn-small">
              {t('detail.applyFilter')}
            </button>
            {country && (
              <Link
                href={{ pathname: `/app/links/${link.id}`, query: { range } }}
                className="btn btn-small btn-ghost"
              >
                {t('detail.clearFilter')}
              </Link>
            )}
          </form>
        )}

        {clickResult.clicks.length === 0 ? (
          <p className="muted">{t('detail.noClicks')}</p>
        ) : (
          <>
            <div className="table-wrap">
              <table className="links-table click-log-table">
                <thead>
                  <tr>
                    <th>{t('detail.colTimestamp')}</th>
                    <th>{t('detail.colCountry')}</th>
                    <th>{t('detail.colReferrer')}</th>
                    <th>{t('detail.colDevice')}</th>
                    <th>{t('detail.colBrowser')}</th>
                    <th>{t('detail.colOs')}</th>
                  </tr>
                </thead>
                <tbody>
                  {clickResult.clicks.map((c) => (
                    <tr key={c.id}>
                      <td className="cell-date mono">{formatDateTime(c.ts, locale)}</td>
                      <td>{c.country ?? '—'}</td>
                      <td className="cell-url mono">{c.referrer ?? '—'}</td>
                      <td>{c.device ?? '—'}</td>
                      <td>{c.browser ?? '—'}</td>
                      <td>{c.os ?? '—'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            {clickResult.total > clickResult.pageSize && (
              <nav className="pager mono">
                {clickResult.page > 1 ? (
                  <Link
                    href={{
                      pathname: `/app/links/${link.id}`,
                      query: { range, ...(country ? { country } : {}), page: String(clickResult.page - 1) },
                    }}
                    className="pager-btn"
                  >
                    {t('table.pagePrev')}
                  </Link>
                ) : (
                  <span className="pager-btn disabled">{t('table.pagePrev')}</span>
                )}
                <span className="pager-info">
                  {t('table.pageOf', {
                    page: clickResult.page,
                    pages: Math.ceil(clickResult.total / clickResult.pageSize),
                  })}
                </span>
                {clickResult.page < Math.ceil(clickResult.total / clickResult.pageSize) ? (
                  <Link
                    href={{
                      pathname: `/app/links/${link.id}`,
                      query: { range, ...(country ? { country } : {}), page: String(clickResult.page + 1) },
                    }}
                    className="pager-btn"
                  >
                    {t('table.pageNext')}
                  </Link>
                ) : (
                  <span className="pager-btn disabled">{t('table.pageNext')}</span>
                )}
              </nav>
            )}
          </>
        )}
      </section>

      <section className="panel" id="edit">
        <p className="section-label">{t('detail.editTitle')}</p>
        <EditLinkForm link={toLinkDto(link)} />
      </section>

      <section className="panel danger-panel">
        <p className="section-label">{t('detail.dangerZone')}</p>
        <DangerZone id={link.id} slug={link.slug} archived={link.archived === 1} />
      </section>
    </div>
  );
}
