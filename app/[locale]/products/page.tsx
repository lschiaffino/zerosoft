import { getTranslations, setRequestLocale } from 'next-intl/server';
import { Link } from '@/i18n/navigation';
import SuiteGrid from '@/components/site/SuiteGrid';
import SectionSign from '@/components/site/SectionSign';
import SiteNetworkMap from '@/components/site/SiteNetworkMap';
import CloudPricing from '@/components/site/CloudPricing';
import EndLines from '@/components/site/EndLines';
import '@/styles/pages.css';

export async function generateMetadata(props: { params: Promise<{ locale: string }> }) {
  const { locale } = await props.params;
  const t = await getTranslations({ locale, namespace: 'pages.products' });
  return { title: t('meta.title'), description: t('meta.description') };
}

/** /products: el plano de la suite, las once líneas y los precios. */
export default async function ProductsPage(props: { params: Promise<{ locale: string }> }) {
  const { locale } = await props.params;
  setRequestLocale(locale);
  const t = await getTranslations({ locale, namespace: 'pages.products' });
  const tc = await getTranslations({ locale, namespace: 'common' });

  return (
    <main className="lp">
      <section className="lp-hero" aria-labelledby="products-title">
        <div className="lp-hero-copy">
          <h1 id="products-title" className="lp-h1">
            {t('hero.title1')}
            <br />
            <span className="lp-h1-dim">{t('hero.title2')}</span>
          </h1>
          <p className="lp-sub">{t('hero.sub')}</p>
          <div className="lp-ctas">
            <Link className="btn btn-primary btn-lg" href="/app">
              {t('cta.button')}
            </Link>
          </div>
        </div>
        <SiteNetworkMap className="lp-hero-map" />
      </section>

      <section className="lp-section" aria-labelledby="h-suite">
        <SectionSign id="h-suite" title={tc('home.suite.title')} sub={tc('home.suite.titleDim')} />
        <div className="container">
          <SuiteGrid />
        </div>
      </section>

      <section className="lp-section" id="precios" aria-labelledby="h-pricing">
        <SectionSign id="h-pricing" title={tc('pricing.title')} sub={tc('pricing.titleDim')} />
        <div className="container">
          <p className="lp-lede lp-lede-block">{tc('pricing.lead')}</p>
          <CloudPricing headingId="h-pricing" />
        </div>
      </section>

      <section className="lp-end" aria-labelledby="h-end">
        <div className="container lp-end-inner">
          <h2 id="h-end">
            {t('cta.title1')}
            <br />
            <span>{t('cta.title2')}</span>
          </h2>
          <p className="lp-end-sub">{t('cta.sub')}</p>
          <div className="lp-ctas">
            <Link className="btn btn-invert-solid btn-lg" href="/app">
              {t('cta.button')}
            </Link>
          </div>
          <EndLines label={tc('header.products')} />
        </div>
      </section>
    </main>
  );
}
