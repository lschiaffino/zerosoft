import { getTranslations } from 'next-intl/server';
import { Link } from '@/i18n/navigation';
import { requireUser } from '@/lib/session';
import { getUserOverview } from '@/lib/track';
import { formatNumber, shortUrl } from '@/lib/utils';
import LinkChart from '@/components/link/LinkChart';
import PageHeader from '@/components/ui/PageHeader';

export const dynamic = 'force-dynamic';

/** Resumen de Link: clics, links top y recientes (antes era /app). */
export default async function LinkOverviewPage(props: { params: Promise<{ locale: string }> }) {
  const params = await props.params;

  const {
    locale
  } = params;

  const user = await requireUser(locale);
  const t = await getTranslations({ locale, namespace: 'link' });
  const tHome = await getTranslations({ locale, namespace: 'common.appHome' });
  const o = await getUserOverview(user.id);

  const maxTop = Math.max(...o.topLinks.map((l) => l.clicks), 1);

  return (
    <div className="app-page link-overview">
      <PageHeader
        title={tHome('linkSummary')}
        actions={
          <Link href="/app/links/new" className="btn btn-solid">
            {t('tabs.new')}
          </Link>
        }
      />

      <div className="stat-cards">
        <div className="panel stat-card">
          <span className="stat-num">{formatNumber(o.activeLinks, locale)}</span>
          <span className="stat-label">{t('overview.activeLinks')}</span>
        </div>
        <div className="panel stat-card">
          <span className="stat-num">{formatNumber(o.totalClicks, locale)}</span>
          <span className="stat-label">{t('overview.totalClicks')}</span>
        </div>
        <div className="panel stat-card">
          <span className="stat-num">{formatNumber(o.clicksToday, locale)}</span>
          <span className="stat-label">{t('overview.clicksToday')}</span>
        </div>
        <div className="panel stat-card">
          {/* Sin clics no hay top link: estado vacío en vez de un 0 o de un link con 0 clics. */}
          {o.topLink && o.topLink.clicks > 0 ? (
            <>
              <span className="stat-num stat-num-small mono">/{o.topLink.slug}</span>
              <span className="stat-label">
                {t('overview.topLink')} · {formatNumber(o.topLink.clicks, locale)}
              </span>
            </>
          ) : (
            <>
              <span className="stat-num stat-num-small muted" data-testid="top-link-empty">
                {t('overview.noTopLink')}
              </span>
              <span className="stat-label">{t('overview.topLink')}</span>
            </>
          )}
        </div>
      </div>

      <section className="panel chart-panel">
        <p className="section-label">{t('overview.chartLabel')}</p>
        <LinkChart data={o.byDay} />
      </section>

      <div className="overview-grid">
        <section className="panel">
          <p className="section-label">{t('overview.topLinks')}</p>
          {o.topLinks.length === 0 ? (
            <p className="muted">{t('overview.noClicksYet')}</p>
          ) : (
            <div className="toplinks">
              {o.topLinks.map((l) => (
                <Link key={l.id} href={`/app/links/${l.id}`} className="toplinks-row">
                  <span className="mono toplinks-slug">/{l.slug}</span>
                  <span className="breakdown-track">
                    <span
                      className="breakdown-bar"
                      style={{ width: `${Math.max((l.clicks / maxTop) * 100, 2)}%` }}
                    />
                  </span>
                  <span className="mono toplinks-count">{formatNumber(l.clicks, locale)}</span>
                </Link>
              ))}
            </div>
          )}
        </section>

        <section className="panel">
          <div className="panel-head">
            <p className="section-label">{t('overview.recent')}</p>
            <Link href="/app/links" className="mono panel-more">
              {t('overview.viewAll')} →
            </Link>
          </div>
          {o.recent.length === 0 ? (
            <div className="empty-inline">
              <p className="empty-zeros mono" aria-hidden>
                0 0 0 0 0
              </p>
              <p className="muted">{t('overview.emptySub')}</p>
              <Link href="/app/links/new" className="btn btn-solid btn-small">
                {t('overview.emptyCta')}
              </Link>
            </div>
          ) : (
            <ul className="recent-list">
              {o.recent.map((l) => (
                <li key={l.id}>
                  <Link href={`/app/links/${l.id}`} className="recent-row">
                    <span className="mono recent-slug">{shortUrl(l.slug, l.domain_hostname)}</span>
                    <span className="muted recent-url">{l.url}</span>
                    <span className="mono recent-clicks">{formatNumber(l.clicks, locale)}</span>
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>
    </div>
  );
}
