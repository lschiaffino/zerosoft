import { getTranslations } from 'next-intl/server';
import { Link } from '@/i18n/navigation';
import Reveal from '@/components/Reveal';
import BrowserFrame from './BrowserFrame';
import LinkMockup from './mockups/LinkMockup';
import TrackMockup from './mockups/TrackMockup';
import CrmMockup from './mockups/CrmMockup';
import CalMockup from './mockups/CalMockup';

export const PRODUCT_CONFIG = {
  link: { num: '04', name: 'Link', available: true, launch: '/app' },
  track: { num: '01', name: 'Track', available: false, launch: '/app' },
  crm: { num: '02', name: 'CRM', available: true, launch: '/app/crm' },
  cal: { num: '03', name: 'Cal', available: false, launch: '/app' },
} as const;

export type ProductKey = keyof typeof PRODUCT_CONFIG;

export const PRODUCT_KEYS = Object.keys(PRODUCT_CONFIG) as ProductKey[];

const MOCKUPS = {
  link: LinkMockup,
  track: TrackMockup,
  crm: CrmMockup,
  cal: CalMockup,
} as const;

const FEATURE_IDS = ['f1', 'f2', 'f3', 'f4', 'f5', 'f6', 'f7', 'f8', 'f9'] as const;
const FAQ_IDS = ['f1', 'f2', 'f3', 'f4', 'f5'] as const;

/**
 * Full product detail page: hero, fake-UI browser shot, features,
 * price math, the two ways to have it, FAQ and final CTA.
 * All copy lives in messages/<locale>/pages.json.
 */
export default async function ProductPage({
  locale,
  product,
}: {
  locale: string;
  product: ProductKey;
}) {
  const t = await getTranslations({ locale, namespace: 'pages' });
  const tc = await getTranslations({ locale, namespace: 'common.products' });

  const cfg = PRODUCT_CONFIG[product];
  const Mockup = MOCKUPS[product];
  const p = `products.${product}`;

  return (
    <main>
      {/* HERO */}
      <section className="pd-hero container">
        <Link href="/products" className="pd-back">
          {t('product.back')}
        </Link>
        <p className="pd-num">
          {cfg.num} / 04 — {t(`${p}.hero.tag`)}
        </p>
        <h1 className="pd-title">{cfg.name}</h1>
        <p className="pd-sub">{t(`${p}.hero.sub`)}</p>
        <div className="pd-actions">
          {cfg.available ? (
            <Link className="btn btn-solid" href={cfg.launch}>
              {t('product.launch', { name: cfg.name })}
            </Link>
          ) : (
            <a className="btn btn-solid" href="mailto:hola@zerosoft.ai">
              {t('product.notify')}
            </a>
          )}
          <Link className="btn btn-ghost" href="/#manifiesto">
            {t('product.manifesto')}
          </Link>
          <span className="badge">{tc(`${product}.status`)}</span>
        </div>
      </section>

      {/* PRODUCT SHOT */}
      <section className="pd-shot container">
        <Reveal>
          <BrowserFrame url={t('product.browserUrl')}>
            <Mockup />
          </BrowserFrame>
        </Reveal>
      </section>

      {/* FEATURES */}
      <section className="container">
        <p className="section-label">{t('product.featuresLabel')}</p>
        <Reveal as="div">
          <h2 className="section-title">
            {t(`${p}.featuresTitle`)}
            <br />
            <span className="dim">{t(`${p}.featuresTitleDim`)}</span>
          </h2>
        </Reveal>
        <div className="feat-grid">
          {FEATURE_IDS.map((id, i) => (
            <Reveal className="feat" key={id}>
              <span className="feat-num">0{i + 1}</span>
              <h3>{t(`${p}.${id}.t`)}</h3>
              <p>{t(`${p}.${id}.d`)}</p>
            </Reveal>
          ))}
        </div>
      </section>

      {/* PRICE MATH */}
      <section className="container">
        <p className="section-label">{t('product.compareLabel')}</p>
        <Reveal className="compare">
          <div>
            <p className="compare-col-title">{t('product.compareToday')}</p>
            <div className="compare-row">
              <span className="compare-name">{t(`${p}.compare.rival`)}</span>
              <span className="compare-price">
                {t(`${p}.compare.price`)} {t(`${p}.compare.per`)}
              </span>
            </div>
            <div className="compare-row">
              <span className="compare-name">{t('product.compareTeam')}</span>
              <span className="compare-price">
                {t(`${p}.compare.team`)} {t('product.compareYear')}
              </span>
            </div>
          </div>
          <div className="compare-zero">
            <p className="compare-col-title">{t('product.compareZero')}</p>
            <span className="compare-zero-num">{t(`${p}.compare.zero`)}</span>
            <p className="compare-zero-note">{t(`${p}.compare.note`)}</p>
          </div>
        </Reveal>
      </section>

      {/* TWO WAYS */}
      <section className="container">
        <p className="section-label">{t('product.modelLabel')}</p>
        <div className="model-grid">
          <Reveal className="model-card">
            <p className="model-key">A</p>
            <h3>{t('product.model.a.title')}</h3>
            <p className="model-desc">{t('product.model.a.desc')}</p>
            <p className="model-price">
              {t('product.model.a.price')} <span>{t('product.model.a.priceNote')}</span>
            </p>
          </Reveal>
          <Reveal className="model-card model-card-dark">
            <p className="model-key">B</p>
            <h3>{t('product.model.b.title')}</h3>
            <p className="model-desc">{t('product.model.b.desc')}</p>
            <p className="model-price">
              {t('product.model.b.price')} <span>{t('product.model.b.priceNote')}</span>
            </p>
          </Reveal>
        </div>
      </section>

      {/* FAQ */}
      <section className="container">
        <p className="section-label">{t('product.faqLabel')}</p>
        <Reveal as="div">
          <h2 className="section-title">
            {t('product.faqTitle')}
            <br />
            <span className="dim">{t('product.faqTitleDim')}</span>
          </h2>
        </Reveal>
        <Reveal className="faq">
          {FAQ_IDS.map((id) => (
            <details className="faq-item" key={id}>
              <summary>
                {t(`${p}.faq.${id}.q`)}
                <span className="faq-plus" aria-hidden="true">
                  +
                </span>
              </summary>
              <p className="faq-a">{t(`${p}.faq.${id}.a`)}</p>
            </details>
          ))}
        </Reveal>
      </section>

      {/* FINAL CTA */}
      <section className="end">
        <span className="end-zero" aria-hidden="true">
          0
        </span>
        <div className="end-content">
          <p className="section-label light">{t(`${p}.cta.label`)}</p>
          <h2>
            {t(`${p}.cta.title1`)}
            <br />
            {t(`${p}.cta.title2`)}
          </h2>
          <p className="end-sub">{t(`${p}.cta.sub`)}</p>
          {cfg.available ? (
            <Link className="btn btn-invert" href={cfg.launch}>
              {t(`${p}.cta.button`)}
            </Link>
          ) : (
            <a className="btn btn-invert" href="mailto:hola@zerosoft.ai">
              {t(`${p}.cta.button`)}
            </a>
          )}
        </div>
      </section>
    </main>
  );
}
