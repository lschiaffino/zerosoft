import { getTranslations } from 'next-intl/server';
import { Link } from '@/i18n/navigation';
import { PRODUCT_CONFIG, type SiteProductKey as ProductKey } from '@/lib/products';
import Reveal from '@/components/Reveal';
import Icon from '@/components/site/Icon';
import { FEATURE_ICONS, GITHUB_URL, HAS_API, PRODUCT_NAMES, SITE_PRODUCTS } from '@/components/site/catalog';
import BrowserFrame from './BrowserFrame';
import VideoPlayer from '@/components/VideoPlayer';
import LinkMockup from './mockups/LinkMockup';
import TrackMockup from './mockups/TrackMockup';
import CrmMockup from './mockups/CrmMockup';
import CalMockup from './mockups/CalMockup';
import DocsMockup from './mockups/DocsMockup';
import ChatMockup from './mockups/ChatMockup';

const MOCKUPS = {
  link: LinkMockup,
  track: TrackMockup,
  crm: CrmMockup,
  cal: CalMockup,
  docs: DocsMockup,
  chat: ChatMockup,
} as const;

/** Ruta real de cada app, para la barra de URL del mockup. */
const APP_PATH: Record<ProductKey, string> = {
  link: 'links',
  crm: 'crm',
  cal: 'calendar',
  track: 'track',
  chat: 'chat',
  docs: 'docs',
};

const FEATURE_IDS = ['f1', 'f2', 'f3', 'f4', 'f5', 'f6', 'f7', 'f8', 'f9'] as const;
const FAQ_IDS = ['f1', 'f2', 'f3', 'f4', 'f5'] as const;
const STEP_IDS = ['s1', 's2', 's3'] as const;

/**
 * Página de detalle de producto: hero con el color del producto, vista del
 * producto, features con íconos, cómo funciona, la cuenta, las tres formas de
 * tenerlo, FAQ, el resto de la suite y CTA final.
 * El copy vive en messages/<locale>/pages.json (products.<key> y product.*).
 */
export default async function ProductPage({ locale, product }: { locale: string; product: ProductKey }) {
  const t = await getTranslations({ locale, namespace: 'pages' });
  const tc = await getTranslations({ locale, namespace: 'common.products' });
  const tcm = await getTranslations({ locale, namespace: 'common' });
  const tv = await getTranslations({ locale, namespace: 'videos' });

  const cfg = PRODUCT_CONFIG[product];
  const Mockup = MOCKUPS[product];
  const p = `products.${product}`;
  const rival = t(`${p}.compare.rival`);
  const icons = FEATURE_ICONS[product];

  return (
    <main className={`pd-page card-${product}`}>
      {/* HERO */}
      <section className="pd2-hero">
        <div className="container pd2-hero-inner">
          <nav className="pd2-crumbs" aria-label="Breadcrumb">
            <Link href="/products">{tcm('header.products')}</Link>
            <span aria-hidden="true">/</span>
            <span aria-current="page">{cfg.name}</span>
          </nav>
          <p className="pd2-pill">
            <span className="pd2-pill-zero" aria-hidden="true">
              0
            </span>
            {t('product.alternative', { rival })}
            <span className="pd2-pill-status">{tc(`${product}.status`)}</span>
          </p>
          <h1 className="pd2-title">
            <span className="pd2-title-name">{cfg.name}</span>
            <span className="pd2-tagline">{tc(`${product}.desc`)}</span>
          </h1>
          <p className="pd2-sub">{t(`${p}.hero.sub`)}</p>
          <div className="pd2-actions">
            <Link className="btn btn-solid btn-lg" href={cfg.launch}>
              {t('product.launch', { name: cfg.name })} <Icon name="arrow" size={16} />
            </Link>
            <a className="btn btn-ghost btn-lg" href={GITHUB_URL} target="_blank" rel="noreferrer">
              <Icon name="github" size={16} /> {t('product.selfHost')}
            </a>
            {HAS_API.includes(product) && (
              <Link className="btn btn-ghost btn-lg" href="/docs">
                <Icon name="code" size={16} /> {t('product.apiDocs')}
              </Link>
            )}
          </div>
        </div>
      </section>

      {/* PRODUCT SHOT */}
      <section className="pd2-shot container">
        <Reveal>
          <BrowserFrame url={`zerosoft.ai/app/${APP_PATH[product]}`}>
            <Mockup />
          </BrowserFrame>
        </Reveal>
        <p className="pd2-shot-note">{t('product.previewNote')}</p>
      </section>

      {/* FEATURES */}
      <section className="lp-section container" id="features">
        <div className="lp-head">
          <p className="section-label">{t('product.featuresLabel')}</p>
          <Reveal as="h2" className="lp-title">
            {t(`${p}.featuresTitle`)} <span className="dim">{t(`${p}.featuresTitleDim`)}</span>
          </Reveal>
        </div>
        <Reveal className="pd2-feat-grid">
          {FEATURE_IDS.map((id, i) => (
            <div className="pd2-feat" key={id}>
              <span className="pd2-feat-icon">
                <Icon name={icons[i]} size={19} />
              </span>
              <h3>{t(`${p}.${id}.t`)}</h3>
              <p>{t(`${p}.${id}.d`)}</p>
            </div>
          ))}
        </Reveal>
      </section>

      {/* HOW IT WORKS */}
      <section className="lp-section lp-section-tint" id="how">
        <div className="container">
          <div className="lp-head">
            <p className="section-label">{t('product.howLabel')}</p>
            <Reveal as="h2" className="lp-title">
              {t('product.howTitle')} <span className="dim">{t('product.howTitleDim')}</span>
            </Reveal>
          </div>
          <div className="pd2-steps">
            {STEP_IDS.map((id, i) => (
              <Reveal as="div" className="pd2-step" key={id}>
                <span className="pd2-step-num">{String(i + 1).padStart(2, '0')}</span>
                <h3>{t(`${p}.steps.${id}.t`)}</h3>
                <p>{t(`${p}.steps.${id}.d`)}</p>
              </Reveal>
            ))}
          </div>
        </div>
      </section>

      {/* PRICE MATH */}
      {/* VIDEO: grabación real de la app */}
      <section className="lp-section container" id="video">
        <div className="lp-head">
          <p className="section-label">{tv('embedLabel')}</p>
          <Reveal as="h2" className="lp-title">
            {tv(`items.${product}.title`)} <span className="dim">{tv('embedTitleDim')}</span>
          </Reveal>
          <p className="lp-sub">{tv(`items.${product}.desc`)}</p>
        </div>
        <div className="lp-video">
          <VideoPlayer
            src={`/videos/${product}.mp4`}
            poster={`/videos/${product}.jpg`}
            title={tv(`items.${product}.title`)}
            autoPlayOnVisible
          />
          <p className="lp-video-note">
            {tv('note')} <Link href="/videos">{tv('allVideos')} →</Link>
          </p>
        </div>
      </section>

      <section className="lp-section container" id="pricing">
        <div className="lp-head">
          <p className="section-label">{t('product.compareLabel')}</p>
        </div>
        <Reveal className="pd2-compare">
          <div className="pd2-compare-today">
            <p className="pd2-compare-label">{t('product.compareToday')}</p>
            <div className="pd2-compare-rows">
              <div className="pd2-compare-row">
                <strong>{rival}</strong>
                <span>
                  {t(`${p}.compare.price`)} {t(`${p}.compare.per`)}
                </span>
              </div>
              <div className="pd2-compare-row">
                <strong>{t('product.compareTeam')}</strong>
                <span className="pd2-compare-big">
                  {t(`${p}.compare.team`)} {t('product.compareYear')}
                </span>
              </div>
            </div>
            <p className="pd2-compare-note">{t(`${p}.compare.note`)}</p>
          </div>
          <div className="pd2-compare-zero">
            <p className="pd2-compare-label">{t('product.compareZero')}</p>
            <span className="pd2-compare-num">{t(`${p}.compare.zero`)}</span>
            <p>{tcm('model.a.desc')}</p>
            <a className="btn btn-invert" href={GITHUB_URL} target="_blank" rel="noreferrer">
              <Icon name="github" size={15} /> {t('product.selfHost')}
            </a>
          </div>
        </Reveal>
      </section>

      {/* THREE WAYS */}
      <section className="lp-section lp-section-tint" id="model">
        <div className="container">
          <div className="lp-head">
            <p className="section-label">{t('product.modelLabel')}</p>
          </div>
          <div className="plans">
            {(['a', 'b', 'c'] as const).map((key) => (
              <Reveal key={key} className={`plan${key === 'b' ? ' plan-featured' : ''}`}>
                <div className="plan-top">
                  <span className="plan-icon">
                    <Icon name={key === 'a' ? 'server' : key === 'b' ? 'globe' : 'shield'} size={18} />
                  </span>
                  <h3>{t(`product.model.${key}.title`)}</h3>
                </div>
                <p className="plan-price">
                  {t(`product.model.${key}.price`)} <span>{t(`product.model.${key}.priceNote`)}</span>
                </p>
                <p className="plan-desc">{t(`product.model.${key}.desc`)}</p>
              </Reveal>
            ))}
          </div>
        </div>
      </section>

      {/* FAQ */}
      <section className="lp-section container pd-faq" id="faq">
        <div>
          <p className="section-label">{t('product.faqLabel')}</p>
          <h2 className="lp-title">
            {t('product.faqTitle')} <span className="dim">{t('product.faqTitleDim')}</span>
          </h2>
        </div>
        <div className="faq">
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
        </div>
      </section>

      {/* REST OF THE SUITE */}
      <section className="lp-section container" style={{ paddingTop: 0 }}>
        <div className="lp-head">
          <p className="section-label">{t('product.suiteLabel')}</p>
          <h2 className="lp-title">
            {t('product.suiteTitle')} <span className="dim">{t('product.suiteTitleDim')}</span>
          </h2>
        </div>
        <div className="pd2-suite">
          {SITE_PRODUCTS.filter((k) => k !== product).map((k) => (
            <Link key={k} href={`/products/${k}`} className={`card-${k}`}>
              <span className="pd2-suite-name">
                <i aria-hidden="true" />
                {PRODUCT_NAMES[k]}
              </span>
              <span className="pd2-suite-tag">{tcm(`header.desc.${k}`)}</span>
            </Link>
          ))}
        </div>
      </section>

      {/* FINAL CTA */}
      <section className="lp-end">
        <span className="lp-end-zero" aria-hidden="true">
          0
        </span>
        <div className="container lp-end-inner">
          <p className="section-label light">{t(`${p}.cta.label`)}</p>
          <h2>
            {t(`${p}.cta.title1`)}
            <br />
            <span>{t(`${p}.cta.title2`)}</span>
          </h2>
          <p className="lp-end-sub">{t(`${p}.cta.sub`)}</p>
          <div className="lp-ctas lp-ctas-center">
            <Link className="btn btn-invert-solid btn-lg" href={cfg.launch}>
              {t(`${p}.cta.button`)}
            </Link>
            <a className="btn btn-invert btn-lg" href={GITHUB_URL} target="_blank" rel="noreferrer">
              <Icon name="github" size={16} /> {t('product.selfHost')}
            </a>
          </div>
        </div>
      </section>
    </main>
  );
}
