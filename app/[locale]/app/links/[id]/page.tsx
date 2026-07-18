import { getTranslations } from 'next-intl/server';
import { notFound } from 'next/navigation';
import { Link } from '@/i18n/navigation';
import { requireUser } from '@/lib/session';
import { getUserLink, linkStatus, toLinkDto } from '@/lib/links';
import { getAnalytics, type AnalyticsRange } from '@/lib/track';
import { formatDate, formatNumber, shortUrl } from '@/lib/utils';
import CopyButton from '@/components/link/CopyButton';
import LinkChart from '@/components/link/LinkChart';
import BreakdownBars from '@/components/link/BreakdownBars';
import QrSection from '@/components/link/QrSection';
import EditLinkForm from '@/components/link/EditLinkForm';
import DangerZone from '@/components/link/DangerZone';

export const dynamic = 'force-dynamic';

interface DetailPageProps {
  params: { locale: string; id: string };
  searchParams: Record<string, string | string[] | undefined>;
}

export default async function LinkDetailPage({ params: { locale, id }, searchParams }: DetailPageProps) {
  const user = await requireUser(locale);
  const t = await getTranslations({ locale, namespace: 'link' });

  const link = getUserLink(user.id, id);
  if (!link) notFound();

  const rawRange = typeof searchParams.range === 'string' ? searchParams.range : undefined;
  const range: AnalyticsRange = rawRange === '7d' || rawRange === 'all' ? rawRange : '30d';
  const a = getAnalytics(link.id, link.created_at, range);

  const today = a.byDay[a.byDay.length - 1]?.count ?? 0;
  const last7 = a.byDay.slice(-7).reduce((sum, d) => sum + d.count, 0);
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
          <span className="short-url-big mono">{shortUrl(link.slug)}</span>
          <CopyButton text={shortUrl(link.slug)} />
          <a
            href={shortUrl(link.slug)}
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
          <span className="stat-num">{formatNumber(last7, locale)}</span>
          <span className="stat-label">{t('detail.last7')}</span>
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
