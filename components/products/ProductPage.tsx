import type { ComponentType, ReactNode } from 'react';
import { getTranslations } from 'next-intl/server';
import { Link } from '@/i18n/navigation';
import { PRODUCT_CONFIG, productRgb, type SiteProductKey as ProductKey } from '@/lib/products';
import Reveal from '@/components/Reveal';
import ZeroField from '@/components/ZeroField';
import Icon from '@/components/site/Icon';
import {
  GITHUB_URL,
  HAS_API,
  PRODUCT_NAMES,
  PRODUCT_PAGES,
  RIVALS,
  SITE_PRODUCTS,
  type PageSection,
} from '@/components/site/catalog';
import ZeroDots from '@/components/zero/ZeroDots';
import ZeroCounter from '@/components/zero/ZeroCounter';
import ProductZero from '@/components/zero/ProductZero';
import BrowserFrame from './BrowserFrame';
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
const PLAN_KEYS = ['a', 'b', 'c'] as const;

const ids = (prefix: string, n: number) => Array.from({ length: n }, (_, i) => `${prefix}${i + 1}`);

/**
 * Página de producto. Una sola plantilla para las once apps: el orden de los
 * bloques, la cantidad de features y la forma de la lista salen de
 * components/site/catalog.ts (PRODUCT_PAGES), así las páginas no comparten el
 * mismo esqueleto. El copy vive en messages/<locale>/pages.json
 * (products.<key> y product.*).
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

  const blocks: Record<PageSection, () => ReactNode> = {
    shot: () => (
      <section className="pd-shot container" key="shot">
        <BrowserFrame url={`zerosoft.ai/app/${cfg.path}`}>
          <Mockup />
        </BrowserFrame>
        <p className="pd-shot-note">{t('product.previewNote')}</p>
      </section>
    ),

    features: () => (
      <section className={`lp-section container pd-features pd-features--${spec.featureLayout}`} id="features" key="features">
        <ZeroDots />
        <div className="pd-features-grid">
          <h2 className="lp-title">
            {t(`${p}.featuresTitle`)} <span className="dim">{t(`${p}.featuresTitleDim`)}</span>
          </h2>
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

    how: () => (
      <section className="lp-section container pd-how" id="how" key="how">
        <ZeroDots />
        <h2 className="lp-title">
          {t('product.howTitle')} <span className="dim">{t('product.howTitleDim')}</span>
        </h2>
        <ol className="num-rows">
          {STEP_IDS.map((id, i) => (
            <li className="num-row" key={id}>
              <ZeroCounter n={i + 1} className="num-row-n" />
              <h3>{t(`${p}.steps.${id}.t`)}</h3>
              <p>{t(`${p}.steps.${id}.d`)}</p>
            </li>
          ))}
        </ol>
      </section>
    ),

    video: () => (
      <section className="lp-section container" id="video" key="video">
        <ZeroDots />
        <div className="lp-head">
          <h2 className="lp-title">
            {tv(`items.${product}.title`)} <span className="dim">{tv('embedTitleDim')}</span>
          </h2>
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
    ),

    // El único momento a todo color de la página: fondo del producto y "$0".
    compare: () => (
      <section className="pd-compare" id="pricing" key="compare">
        <div className="container pd-compare-inner">
          <div className="pd-compare-zero">
            <p className="pd-compare-label">{t('product.compareZero')}</p>
            <span className="pd-compare-num">{t(`${p}.compare.zero`)}</span>
            <p className="pd-compare-zero-note">{tcm('model.a.desc')}</p>
          </div>
          <div className="pd-compare-today">
            <p className="pd-compare-label">{t('product.compareToday')}</p>
            <dl className="pd-compare-rows">
              <div className="pd-compare-row">
                <dt>{rival}</dt>
                <dd>
                  {t(`${p}.compare.price`)} {t(`${p}.compare.per`)}
                </dd>
              </div>
              <div className="pd-compare-row">
                <dt>{t.has(`${p}.compare.teamLabel`) ? t(`${p}.compare.teamLabel`) : t('product.compareTeam')}</dt>
                <dd className="pd-compare-big">
                  {t(`${p}.compare.team`)} {t('product.compareYear')}
                </dd>
              </div>
            </dl>
            <p className="pd-compare-note">{t(`${p}.compare.note`)}</p>
            <a className="btn pd-compare-btn" href={GITHUB_URL} target="_blank" rel="noreferrer">
              <Icon name="github" size={15} /> {t('product.selfHost')}
            </a>
          </div>
        </div>
      </section>
    ),

    model: () => (
      <section className="lp-section container" id="model" key="model">
        <ZeroDots />
        <div className="lp-head">
          <h2 className="lp-title">
            {tcm('model.title')} <span className="dim">{tcm('model.titleDim')}</span>
          </h2>
        </div>
        <ol className="plan-rows">
          {PLAN_KEYS.map((key) => (
            <li className="plan-row" key={key}>
              <p className="plan-row-price">{t(`product.model.${key}.price`)}</p>
              <div className="plan-row-body">
                <h3>{t(`product.model.${key}.title`)}</h3>
                <p>{t(`product.model.${key}.desc`)}</p>
              </div>
              <p className="plan-row-note">{t(`product.model.${key}.priceNote`)}</p>
            </li>
          ))}
        </ol>
      </section>
    ),

    faq: () => (
      <section className="lp-section container pd-faq" id="faq" key="faq">
        <div>
          <h2 className="lp-title">
            {t('product.faqTitle', { name: cfg.name })} <span className="dim">{t('product.faqTitleDim')}</span>
          </h2>
        </div>
        <div className="faq">
          {ids('f', spec.faqs).map((id) => (
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
    ),
  };

  return (
    <main className={`pd-page card-${product}`}>
      {/* HERO */}
      <section className="pd-hero">
        <div className="container pd-hero-grid">
          <Reveal className="pd-hero-text">
            <nav className="pd-crumbs" aria-label="Breadcrumb">
              <Link href="/products">{tcm('header.products')}</Link>
              <span aria-hidden="true">/</span>
              <span aria-current="page">{cfg.name}</span>
            </nav>
            <h1 className="pd-title">
              <span className="pd-title-name">{cfg.name}</span>
              <span className="pd-tagline">{tc(`${product}.desc`)}</span>
            </h1>
            <p className="pd-sub">{t(`${p}.hero.sub`)}</p>
            <div className="pd-actions">
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
            <p className="pd-alt">{t('product.alternative', { rival })}</p>
          </Reveal>
          <div className="pd-hero-field" aria-hidden="true">
            <ZeroField align="center" sizeFactor={0.92} color={productRgb(product)} alpha={0.95} />
          </div>
        </div>
      </section>

      {spec.sections.map((s) => blocks[s]())}

      {/* EL RESTO DE LA SUITE */}
      <section className="lp-section container pd-suite-wrap">
        <ZeroDots />
        <h2 className="lp-title">
          {t('product.suiteTitle')} <span className="dim">{t('product.suiteTitleDim')}</span>
        </h2>
        <ul className="pd-suite">
          {SITE_PRODUCTS.filter((k) => k !== product).map((k) => (
            <li key={k}>
              <Link href={`/products/${k}`}>
                <span className="pd-suite-name">
                  <ProductZero product={k} />
                  {PRODUCT_NAMES[k]}
                </span>
                <span className="pd-suite-desc">{tcm(`header.desc.${k}`)}</span>
                <span className="pd-suite-vs">{RIVALS[k]}</span>
              </Link>
            </li>
          ))}
        </ul>
      </section>

      {/* CIERRE */}
      <section className="lp-end">
        <span className="lp-end-zero" aria-hidden="true">
          0
        </span>
        <div className="container lp-end-inner">
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
