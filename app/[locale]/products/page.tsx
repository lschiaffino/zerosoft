import { getTranslations, setRequestLocale } from 'next-intl/server';
import { Link } from '@/i18n/navigation';
import ZeroField from '@/components/ZeroField';
import SuiteGrid from '@/components/site/SuiteGrid';
import ZeroDots from '@/components/zero/ZeroDots';
import ZeroMark from '@/components/zero/ZeroMark';
import ProductZero from '@/components/zero/ProductZero';
import { PRODUCT_NAMES, SITE_PRODUCTS } from '@/components/site/catalog';
import '@/styles/pages.css';

export async function generateMetadata(props: { params: Promise<{ locale: string }> }) {
  const params = await props.params;

  const {
    locale
  } = params;

  const t = await getTranslations({ locale, namespace: 'pages.products' });
  return { title: t('meta.title'), description: t('meta.description') };
}

const ROADMAP = ['i1', 'i2', 'i3', 'i4'] as const;
const COMPARE_ROWS = ['r1', 'r2', 'r3', 'r4', 'r5', 'r6'] as const;
/** Roadmap items already shipped (rendered with the solid "done" style). */
const ROADMAP_DONE: readonly string[] = ['i1', 'i2'];

export default async function ProductsPage(props: { params: Promise<{ locale: string }> }) {
  const params = await props.params;

  const {
    locale
  } = params;

  setRequestLocale(locale);
  const t = await getTranslations({ locale, namespace: 'pages.products' });
  const tc = await getTranslations({ locale, namespace: 'common.header' });

  return (
    <main>
      {/* HERO */}
      <section className="page-hero products-hero">
        <ZeroField align="right" sizeFactor={0.92} />
        <div className="container">
          <h1 className="page-hero-title">
            {t('hero.title1')}
            <br />
            <span className="dim">{t('hero.title2')}</span>
          </h1>
          <p className="page-hero-sub">{t('hero.sub')}</p>
        </div>
      </section>

      {/* LA SUITE */}
      <section className="container" style={{ paddingTop: 0 }}>
        <SuiteGrid cta={{ label: tc('startFree'), href: '/app' }} />
      </section>

      {/* THE MATH */}
      <section className="container">
        <ZeroDots />
        <div className="compare">
          <div>
            <p className="compare-col-title">{t('compare.todayTitle')}</p>
            {COMPARE_ROWS.map((r) => (
              <div className="compare-row" key={r}>
                <span className="compare-name">{t(`compare.${r}name`)}</span>
                <span className="compare-price">{t(`compare.${r}price`)}</span>
              </div>
            ))}
          </div>
          <div className="compare-zero">
            <p className="compare-col-title">{t('compare.withTitle')}</p>
            <span className="compare-zero-num">{t('compare.big')}</span>
            <p className="compare-zero-note">{t('compare.note')}</p>
          </div>
        </div>
      </section>

      {/* ROADMAP */}
      <section className="container">
        <ZeroDots />
        <h2 className="section-title">
          {t('roadmap.title')}
          <br />
          <span className="dim">{t('roadmap.titleDim')}</span>
        </h2>
        <div className="road">
          {ROADMAP.map((id) => (
            <div className={`road-item ${ROADMAP_DONE.includes(id) ? 'done' : ''}`} key={id}>
              <span className="road-zero" aria-hidden="true">
                <ZeroMark size={20} />
              </span>
              <p className="road-when">{t(`roadmap.${id}.when`)}</p>
              <h3 className="road-name">{t(`roadmap.${id}.name`)}</h3>
              <p className="road-what">{t(`roadmap.${id}.what`)}</p>
              <span className="road-state">{t(`roadmap.${id}.state`)}</span>
            </div>
          ))}
        </div>
      </section>

      {/* CIERRE */}
      <section className="lp-end">
        <span className="lp-end-zero" aria-hidden="true">
          0
        </span>
        <div className="container lp-end-inner">
          <h2>
            {t('cta.title1')}
            <br />
            <span>{t('cta.title2')}</span>
          </h2>
          <p className="lp-end-sub">{t('cta.sub')}</p>
          <div className="lp-ctas lp-ctas-center">
            <Link className="btn btn-invert-solid btn-lg" href="/app">
              {t('cta.button')}
            </Link>
          </div>
          <ul className="lp-end-apps" aria-label={tc('products')}>
            {SITE_PRODUCTS.map((k) => (
              <li key={k}>
                <Link href={`/products/${k}`}>
                  <ProductZero product={k} size={11} />
                  {PRODUCT_NAMES[k]}
                </Link>
              </li>
            ))}
          </ul>
        </div>
      </section>
    </main>
  );
}
