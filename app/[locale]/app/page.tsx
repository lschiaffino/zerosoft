import { getTranslations } from 'next-intl/server';
import { Link } from '@/i18n/navigation';
import { requireUser } from '@/lib/session';
import { getUserOverview } from '@/lib/track';
import { formatNumber, shortUrl } from '@/lib/utils';
import LinkChart from '@/components/link/LinkChart';
import NetworkMap, { type NetworkMapLabels } from '@/components/brand/NetworkMap';
import ProductGlyph from '@/components/brand/ProductGlyph';
import PageHeader from '@/components/ui/PageHeader';
import { NET_STATIONS } from '@/lib/brand-network';
import { getBrandTheme } from '@/lib/brand-theme-server';
import { PRODUCT_CONFIG, PRODUCT_KEYS, type ProductKey } from '@/lib/products';

export const dynamic = 'force-dynamic';

export default async function OverviewPage(props: { params: Promise<{ locale: string }> }) {
  const params = await props.params;

  const {
    locale
  } = params;

  const user = await requireUser(locale);
  const t = await getTranslations({ locale, namespace: 'link' });
  const tHome = await getTranslations({ locale, namespace: 'common.appHome' });
  const tProducts = await getTranslations({ locale, namespace: 'common.products' });
  const tBrand = await getTranslations({ locale, namespace: 'brand' });
  const o = await getUserOverview(user.id);
  const brand = await getBrandTheme();

  // El plano de la red como launcher: cada línea y estación entra a su app.
  const mapLabels: NetworkMapLabels = {
    title: tHome('mapTitle'),
    hint: tBrand('map.hint'),
    hintTouch: tBrand('map.hintTouch'),
    lines: Object.fromEntries(PRODUCT_KEYS.map((k) => [k, tBrand(`map.lines.${k}`)])) as Record<ProductKey, string>,
    stations: Object.fromEntries(
      NET_STATIONS.map((s) => [s.id, { name: tBrand(`map.stations.${s.id}.name`), desc: tBrand(`map.stations.${s.id}.desc`) }]),
    ),
  };
  const appHrefs = Object.fromEntries(PRODUCT_KEYS.map((k) => [k, `/${locale}${PRODUCT_CONFIG[k].launch}`])) as Record<
    ProductKey,
    string
  >;

  const maxTop = Math.max(...o.topLinks.map((l) => l.clicks), 1);

  return (
    <div className="app-page app-home">
      <PageHeader
        title={brand === 'subte' ? tHome('subteTitle') : tHome('title')}
        description={brand === 'subte' ? tHome('subteLead') : tHome('lead')}
      />

      {brand === 'subte' ? (
        // Tema subte: el plano de la red como launcher (cada línea entra a su app).
        <section className="app-home-network" aria-label={tHome('mapTitle')}>
          <div className="app-home-map">
            <NetworkMap locale={locale} labels={mapLabels} hrefs={appHrefs} />
          </div>
          <nav className="app-home-lines" aria-label={tHome('lines')}>
            <ul>
              {PRODUCT_KEYS.map((k) => (
                <li key={k}>
                  <Link href={PRODUCT_CONFIG[k].launch} className="app-home-line" aria-label={tHome('open', { name: PRODUCT_CONFIG[k].name })}>
                    <ProductGlyph product={k} size={14} onLine />
                    <span className="app-home-line-name">{PRODUCT_CONFIG[k].name}</span>
                    <span className="app-home-line-desc">{tProducts(`${k}.desc`)}</span>
                  </Link>
                </li>
              ))}
            </ul>
          </nav>
        </section>
      ) : (
        // Marca default: las once apps en una grilla sobria, cada una con su cero.
        <nav className="app-home-apps" aria-label={tHome('apps')}>
          <ul>
            {PRODUCT_KEYS.map((k) => (
              <li key={k}>
                <Link
                  href={PRODUCT_CONFIG[k].launch}
                  className={`app-home-app card-${k}`}
                  aria-label={tHome('open', { name: PRODUCT_CONFIG[k].name })}
                >
                  <ProductGlyph product={k} size={20} />
                  <span className="app-home-app-name">{PRODUCT_CONFIG[k].name}</span>
                  <span className="app-home-app-desc">{tProducts(`${k}.desc`)}</span>
                </Link>
              </li>
            ))}
          </ul>
        </nav>
      )}

      <h2 className="app-home-sub">
        <ProductGlyph product="link" size={14} onLine />
        {tHome('linkSummary')}
      </h2>

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
          {o.topLink ? (
            <>
              <span className="stat-num stat-num-small mono">/{o.topLink.slug}</span>
              <span className="stat-label">
                {t('overview.topLink')} · {formatNumber(o.topLink.clicks, locale)}
              </span>
            </>
          ) : (
            <>
              <span className="stat-num">0</span>
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
