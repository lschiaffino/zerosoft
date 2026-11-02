import { getTranslations, setRequestLocale } from 'next-intl/server';
import { staticPageMetadata, staticPageText } from '@/lib/seo-pages';
import { absoluteUrl, breadcrumbLd, graphLd, jsonLdString, localePath } from '@/lib/seo';
import { Link } from '@/i18n/navigation';
import SuiteGrid from '@/components/site/SuiteGrid';
import SectionSign from '@/components/site/SectionSign';
import HeroVisual from '@/components/site/HeroVisual';
import CloudPricing from '@/components/site/CloudPricing';
import ProductLinks from '@/components/site/ProductLinks';
import ParityOverview from '@/components/products/ParityOverview';
import { ZeroEdge } from '@/components/zero/ZeroTexture';
import { PARITY } from '@/content/feature-parity';
import { computeParity } from '@/lib/feature-parity';
import { PRODUCT_KEYS } from '@/lib/products';
import '@/styles/pages.css';

export async function generateMetadata(props: { params: Promise<{ locale: string }> }) {
  const { locale } = await props.params;
  return staticPageMetadata('products', locale);
}

/** /products: el cero, las once apps y los precios. */
export default async function ProductsPage(props: { params: Promise<{ locale: string }> }) {
  const { locale } = await props.params;
  setRequestLocale(locale);
  const t = await getTranslations({ locale, namespace: 'pages.products' });
  const tc = await getTranslations({ locale, namespace: 'common' });
  // Paridad de cada app contra su competidor, calculada de content/feature-parity.
  const parity = Object.fromEntries(
    PRODUCT_KEYS.map((k) => {
      const score = computeParity(PARITY[k].rows);
      const competitor = PARITY[k].competitor;
      return [k, PARITY[k].percentHidden ? t('parityCounts', { have: score.have, partial: score.partial, counted: score.counted, competitor }) : t('parityShort', { percent: score.percent, competitor })];
    }),
  );
  const seoText = await staticPageText('products', locale);
  const ld = graphLd([
    breadcrumbLd(locale, [
      { name: 'zerosoft', path: '' },
      { name: seoText.title, path: '/products' },
    ]),
    { '@type': 'CollectionPage', name: seoText.title, description: seoText.description, url: absoluteUrl(localePath(locale, '/products')), inLanguage: locale },
  ]);


  return (
    <main className="lp">
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: jsonLdString(ld) }} />
      <section className="lp-hero" aria-labelledby="products-title">
        <div className="lp-hero-copy">
          <h1 id="products-title" className="lp-h1">
            {t('hero.title1')}
            <br />
            <span className="lp-h1-dim">{t('hero.title2')}</span>
          </h1>
          <p className="lp-sub">{t('hero.sub')}</p>
          <div className="lp-ctas">
            <Link className="btn btn-primary btn-lg" href="/app/start">
              {t('cta.button')}
            </Link>
          </div>
        </div>
        <HeroVisual className="lp-hero-map" />
      </section>

      <section className="lp-section" aria-labelledby="h-suite">
        <SectionSign id="h-suite" title={tc('home.suite.title')} />
        <div className="container">
          <SuiteGrid parity={parity} />
        </div>
      </section>

      <ParityOverview locale={locale} headingId="h-parity" />

      <section className="lp-section" id="precios" aria-labelledby="h-pricing">
        <SectionSign id="h-pricing" title={tc('pricing.title')} sub={tc('pricing.titleDim')} />
        <div className="container">
          <p className="lp-lede lp-lede-block">{tc('pricing.lead')}</p>
          <CloudPricing headingId="h-pricing" />
        </div>
      </section>

      <ZeroEdge />
      <section className="lp-end" aria-labelledby="h-end">
        <div className="container lp-end-inner">
          <h2 id="h-end">
            {t('cta.title1')}
            <br />
            <span>{t('cta.title2')}</span>
          </h2>
          <p className="lp-end-sub">{t('cta.sub')}</p>
          <div className="lp-ctas">
            <Link className="btn btn-invert-solid btn-lg" href="/app/start">
              {t('cta.button')}
            </Link>
          </div>
          <ProductLinks label={tc('header.products')} />
        </div>
      </section>
    </main>
  );
}
