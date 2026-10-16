import type { ComponentType, ReactNode } from 'react';
import { getTranslations } from 'next-intl/server';
import { Link } from '@/i18n/navigation';
import { PRODUCT_CONFIG, type SiteProductKey as ProductKey } from '@/lib/products';
import Icon from '@/components/site/Icon';
import { GITHUB_URL, HAS_API, PRODUCT_PAGES, SECTION_IDS, type PageSection } from '@/components/site/catalog';
import SectionSign from '@/components/site/SectionSign';
import SiteNetworkMap from '@/components/site/SiteNetworkMap';
import CloudPricing from '@/components/site/CloudPricing';
import EndLines from '@/components/site/EndLines';
import Station from '@/components/brand/Station';
import BrowserFrame from './BrowserFrame';
import ProductLineNav from './ProductLineNav';
import VideoPlayer from '@/components/VideoPlayer';
import LinkMockup from './mockups/LinkMockup';
import TrackMockup from './mockups/TrackMockup';
import CrmMockup from './mockups/CrmMockup';
import CalMockup from './mockups/CalMockup';
import DocsMockup from './mockups/DocsMockup';
import ChatMockup from './mockups/ChatMockup';
import AgentsMockup from './mockups/AgentsMockup';
import FlowMockup from './mockups/FlowMockup';
import RobotsMockup from './mockups/RobotsMockup';
import NotesMockup from './mockups/NotesMockup';
import BoardMockup from './mockups/BoardMockup';

const MOCKUPS: Record<ProductKey, ComponentType> = {
  link: LinkMockup,
  track: TrackMockup,
  crm: CrmMockup,
  cal: CalMockup,
  docs: DocsMockup,
  chat: ChatMockup,
  agents: AgentsMockup,
  flow: FlowMockup,
  robots: RobotsMockup,
  notes: NotesMockup,
  board: BoardMockup,
};

const STEP_IDS = ['s1', 's2', 's3'] as const;

const ids = (prefix: string, n: number) => Array.from({ length: n }, (_, i) => `${prefix}${i + 1}`);

/**
 * Página de producto. Una sola plantilla para las once apps: el orden de los
 * bloques, la cantidad de features y la forma de la lista salen de
 * components/site/catalog.ts (PRODUCT_PAGES). La línea del producto es el
 * hilo de la página: se enciende en el plano del primer viewport, hace de
 * índice (ProductLineNav) y su estación abre cada sección. El copy vive en
 * messages/<locale>/pages.json (products.<key> y product.*).
 */
export default async function ProductPage({ locale, product }: { locale: string; product: ProductKey }) {
  const t = await getTranslations({ locale, namespace: 'pages' });
  const tc = await getTranslations({ locale, namespace: 'common.products' });
  const tcm = await getTranslations({ locale, namespace: 'common' });
  const tv = await getTranslations({ locale, namespace: 'videos' });

  const cfg = PRODUCT_CONFIG[product];
  const spec = PRODUCT_PAGES[product];
  const Mockup = MOCKUPS[product];
  const p = `products.${product}`;
  const rival = t(`${p}.compare.rival`);

  const sign = (key: PageSection, title: ReactNode, sub?: ReactNode) => (
    <SectionSign id={`h-${SECTION_IDS[key]}`} title={title} sub={sub} product={product} />
  );

  const blocks: Record<PageSection, () => ReactNode> = {
    shot: () => (
      <section className="lp-section" id={SECTION_IDS.shot} key="shot" aria-labelledby={`h-${SECTION_IDS.shot}`}>
        {sign('shot', t('product.shotTitle', { name: cfg.name }), t('product.previewNote'))}
        <div className="container">
          <BrowserFrame url={`zerosoft.ai/app/${cfg.path}`}>
            <Mockup />
          </BrowserFrame>
          <p className="pd-shot-note">
            <Link href={cfg.launch} className="lp-textlink">
              {t('product.launch', { name: cfg.name })} <Icon name="arrow" size={14} />
            </Link>
          </p>
        </div>
      </section>
    ),

    features: () => (
      <section
        className={`lp-section pd-features pd-features--${spec.featureLayout}`}
        id={SECTION_IDS.features}
        key="features"
        aria-labelledby={`h-${SECTION_IDS.features}`}
      >
        {sign('features', t(`${p}.featuresTitle`), t(`${p}.featuresTitleDim`))}
        <div className="container">
          <ul className="pd-feat-list">
            {ids('f', spec.features).map((id) => (
              <li className="pd-feat" key={id}>
                <h3>{t(`${p}.${id}.t`)}</h3>
                <p>{t(`${p}.${id}.d`)}</p>
              </li>
            ))}
          </ul>
        </div>
      </section>
    ),

    // Los tres pasos son tres estaciones sobre la línea del producto.
    how: () => (
      <section className="lp-section pd-how" id={SECTION_IDS.how} key="how" aria-labelledby={`h-${SECTION_IDS.how}`}>
        {sign('how', t('product.howTitle'), t('product.howTitleDim'))}
        <div className="container">
          <ol className="pd-steps">
            {STEP_IDS.map((id) => (
              <li className="pd-step" key={id}>
                <Station size={24} className="pd-step-station" />
                <h3>{t(`${p}.steps.${id}.t`)}</h3>
                <p>{t(`${p}.steps.${id}.d`)}</p>
              </li>
            ))}
          </ol>
        </div>
      </section>
    ),

    video: () => (
      <section className="lp-section" id={SECTION_IDS.video} key="video" aria-labelledby={`h-${SECTION_IDS.video}`}>
        {sign('video', tv(`items.${product}.title`), tv('embedTitleDim'))}
        <div className="container lp-tour">
          <div className="lp-video">
            <VideoPlayer
              src={`/videos/${product}.mp4`}
              poster={`/videos/${product}.jpg`}
              title={tv(`items.${product}.title`)}
              autoPlayOnVisible
            />
          </div>
          <div className="lp-tour-side">
            <p className="lp-lede">{tv(`items.${product}.desc`)}</p>
            <p className="lp-video-note">
              {tv('note')} <Link href="/videos">{tv('allVideos')}</Link>
            </p>
          </div>
        </div>
      </section>
    ),

    // La cuenta: el rival a precio de lista contra la placa de $0.
    compare: () => (
      <section
        className="lp-section pd-compare"
        id={SECTION_IDS.compare}
        key="compare"
        aria-labelledby={`h-${SECTION_IDS.compare}`}
      >
        {sign('compare', t('product.compareTitle', { rival }), t('product.compareTitleDim'))}
        <div className="container pd-compare-inner">
          <div className="pd-compare-today">
            <p className="pd-compare-label">{t('product.compareToday')}</p>
            <dl className="pd-compare-rows">
              <div className="pd-compare-row">
                <dt>{rival}</dt>
                <dd className="data">
                  {t(`${p}.compare.price`)} {t(`${p}.compare.per`)}
                </dd>
              </div>
              <div className="pd-compare-row">
                <dt>{t.has(`${p}.compare.teamLabel`) ? t(`${p}.compare.teamLabel`) : t('product.compareTeam')}</dt>
                <dd className="data pd-compare-big">
                  {t(`${p}.compare.team`)} {t('product.compareYear')}
                </dd>
              </div>
            </dl>
            <p className="pd-compare-note">{t(`${p}.compare.note`)}</p>
          </div>
          <div className="pd-compare-zero">
            <p className="pd-compare-label">{t('product.compareZero')}</p>
            <span className="pd-compare-num">{t(`${p}.compare.zero`)}</span>
            <span className="pd-compare-line" aria-hidden="true">
              <Station size={28} />
            </span>
            <p className="pd-compare-zero-note">{tcm('model.a.desc')}</p>
            <a className="btn btn-invert" href={GITHUB_URL} target="_blank" rel="noreferrer">
              <Icon name="github" size={15} /> {t('product.selfHost')}
            </a>
          </div>
        </div>
      </section>
    ),

    model: () => (
      <section className="lp-section" id={SECTION_IDS.model} key="model" aria-labelledby={`h-${SECTION_IDS.model}`}>
        {sign('model', tcm('pricing.title'), tcm('pricing.titleDim'))}
        <div className="container">
          <p className="lp-lede lp-lede-block">{tcm('pricing.lead')}</p>
          <CloudPricing headingId={`h-${SECTION_IDS.model}`} />
        </div>
      </section>
    ),

    faq: () => (
      <section className="lp-section" id={SECTION_IDS.faq} key="faq" aria-labelledby={`h-${SECTION_IDS.faq}`}>
        {sign('faq', t('product.faqTitle', { name: cfg.name }), t('product.faqTitleDim'))}
        <div className="container">
          <div className="faq">
            {ids('f', spec.faqs).map((id) => (
              <details className="faq-item" key={id}>
                <summary>
                  {t(`${p}.faq.${id}.q`)}
                  <span className="faq-plus" aria-hidden="true" />
                </summary>
                <p className="faq-a">{t(`${p}.faq.${id}.a`)}</p>
              </details>
            ))}
          </div>
        </div>
      </section>
    ),
  };

  const stops = spec.sections.map((s) => ({ id: SECTION_IDS[s], label: t(`product.nav.${s}`) }));

  return (
    <main className={`pd-page card-${product}`}>
      {/* Primer viewport: el producto y su línea encendida en el plano. */}
      <section className="pd-hero" aria-labelledby="pd-title">
        <div className="pd-hero-text">
          <nav className="pd-crumbs" aria-label={t('product.crumbs')}>
            <Link href="/products">{tcm('header.products')}</Link>
            <span aria-hidden="true">/</span>
            <span aria-current="page">{cfg.name}</span>
          </nav>
          <h1 id="pd-title" className="pd-title">
            <span className="pd-title-name">{cfg.name}</span>
            <span className="pd-tagline">{tc(`${product}.desc`)}</span>
          </h1>
          <p className="pd-sub">{t(`${p}.hero.sub`)}</p>
          <div className="pd-actions">
            <Link className="btn btn-primary btn-lg" href={cfg.launch}>
              {t('product.launch', { name: cfg.name })}
            </Link>
            <a className="btn btn-secondary btn-lg" href={GITHUB_URL} target="_blank" rel="noreferrer">
              <Icon name="github" size={16} /> {t('product.selfHost')}
            </a>
            {HAS_API.includes(product) && (
              <Link className="btn btn-ghost btn-lg" href="/docs">
                <Icon name="code" size={16} /> {t('product.apiDocs')}
              </Link>
            )}
          </div>
          <p className="pd-alt">{t('product.alternative', { rival })}</p>
        </div>
        <SiteNetworkMap focus={product} className="pd-hero-map" />
      </section>

      <ProductLineNav product={product} stops={stops} label={t('product.navLabel', { name: cfg.name })} />

      {spec.sections.map((s) => blocks[s]())}

      {/* Cierre: la banda negra con las once líneas. */}
      <section className="lp-end" aria-labelledby="h-end">
        <div className="container lp-end-inner">
          <h2 id="h-end">
            {t(`${p}.cta.title1`)}
            <br />
            <span>{t(`${p}.cta.title2`)}</span>
          </h2>
          <p className="lp-end-sub">{t(`${p}.cta.sub`)}</p>
          <div className="lp-ctas">
            <Link className="btn btn-invert-solid btn-lg" href={cfg.launch}>
              {t(`${p}.cta.button`)}
            </Link>
            <a className="btn btn-invert btn-lg" href={GITHUB_URL} target="_blank" rel="noreferrer">
              <Icon name="github" size={16} /> {t('product.selfHost')}
            </a>
          </div>
          <EndLines label={tcm('header.products')} current={product} />
        </div>
      </section>
    </main>
  );
}
