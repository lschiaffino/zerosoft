import type { ComponentType, ReactNode } from 'react';
import { getTranslations } from 'next-intl/server';
import { Link } from '@/i18n/navigation';
import { PRODUCT_CONFIG, isBuildingProduct, type SiteProductKey as ProductKey } from '@/lib/products';
import Icon from '@/components/site/Icon';
import { GITHUB_URL, HAS_API, PRODUCT_PAGES, SECTION_IDS, type PageSection } from '@/components/site/catalog';
import SectionSign from '@/components/site/SectionSign';
import HeroVisual from '@/components/site/HeroVisual';
import CloudPricing from '@/components/site/CloudPricing';
import ProductLinks from '@/components/site/ProductLinks';
import { ZeroEdge } from '@/components/zero/ZeroTexture';
import BrowserFrame from './BrowserFrame';
import ProductSectionNav from './ProductSectionNav';
import FeatureParity from './FeatureParity';
import { PARITY } from '@/content/feature-parity';
import { loc } from '@/lib/feature-parity';
import { jsonLd, siteUrl } from '@/lib/tools/registry';
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
import GroupsMockup from './mockups/GroupsMockup';
import NotesMockup from './mockups/NotesMockup';
import BoardMockup from './mockups/BoardMockup';
import VoiceMockup from './mockups/VoiceMockup';
import RecMockup from './mockups/RecMockup';
import TalkMockup from './mockups/TalkMockup';
import DesignMockup from './mockups/DesignMockup';
import ShopMockup from './mockups/ShopMockup';
import AnalyticsMockup from './mockups/AnalyticsMockup';
import SocialMockup from './mockups/SocialMockup';
import HiringMockup from './mockups/HiringMockup';
import PeopleMockup from './mockups/PeopleMockup';
import BooksMockup from './mockups/BooksMockup';
import FormsMockup from './mockups/FormsMockup';

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
  groups: GroupsMockup,
  notes: NotesMockup,
  board: BoardMockup,
  voice: VoiceMockup,
  rec: RecMockup,
  talk: TalkMockup,
  design: DesignMockup,
  shop: ShopMockup,
  analytics: AnalyticsMockup,
  social: SocialMockup,
  hiring: HiringMockup,
  people: PeopleMockup,
  books: BooksMockup,
  forms: FormsMockup,
};

const STEP_IDS = ['s1', 's2', 's3'] as const;

const ids = (prefix: string, n: number) => Array.from({ length: n }, (_, i) => `${prefix}${i + 1}`);

/**
 * Página de producto. Una sola plantilla para todas las apps: el orden de los
 * bloques, la cantidad de features y la forma de la lista salen de
 * components/site/catalog.ts (PRODUCT_PAGES). El color del producto tiñe el
 * cero del primer viewport y el índice de secciones (ProductSectionNav). El
 * copy vive en messages/<locale>/pages.json (products.<key> y product.*).
 *
 * Las apps en construcción (BUILDING_PRODUCTS) lo dicen arriba del título,
 * muestran la vista como boceto y llevan a proponer ideas en vez de a la app.
 */
export default async function ProductPage({ locale, product }: { locale: string; product: ProductKey }) {
  const t = await getTranslations({ locale, namespace: 'pages' });
  const tcm = await getTranslations({ locale, namespace: 'common' });
  const tv = await getTranslations({ locale, namespace: 'videos' });

  const cfg = PRODUCT_CONFIG[product];
  const spec = PRODUCT_PAGES[product];
  const Mockup = MOCKUPS[product];
  const p = `products.${product}`;
  const rival = t(`${p}.compare.rival`);
  const building = isBuildingProduct(product);
  // En construcción no hay app para probar: las acciones llevan al board público.
  const primaryHref = building ? `/feedback-board/new?product=${product}` : cfg.launch;

  const sign = (key: PageSection, title: ReactNode, sub?: ReactNode) => (
    <SectionSign id={`h-${SECTION_IDS[key]}`} title={title} sub={sub} product={product} />
  );

  const blocks: Record<PageSection, () => ReactNode> = {
    shot: () => (
      <section className="lp-section" id={SECTION_IDS.shot} key="shot" aria-labelledby={`h-${SECTION_IDS.shot}`}>
        {sign('shot', t('product.shotTitle', { name: cfg.name }))}
        <div className="container">
          <BrowserFrame url={`zerosoft.ai/app/${cfg.path}`}>
            <Mockup />
          </BrowserFrame>
          <p className="pd-shot-note lp-proof-foot">
            {building ? (
              <span className="fig-cap">{t('product.building.shotFig', { name: cfg.name.toLowerCase() })}</span>
            ) : (
              <>
                <span className="fig-cap">{t('product.shotFig', { name: cfg.name.toLowerCase() })}</span>
                <Link href={cfg.launch} className="lp-textlink">
                  {t('product.launch', { name: cfg.name })} <Icon name="arrow" size={14} />
                </Link>
              </>
            )}
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

    // Paridad contra el competidor y la tabla de todo lo incluido (content/feature-parity).
    parity: () => (
      <section className="lp-section pd-parity" id={SECTION_IDS.parity} key="parity" aria-labelledby={`h-${SECTION_IDS.parity}`}>
        {sign(
          'parity',
          t('product.parity.sectionTitle', { name: cfg.name, competitor: PARITY[product].competitor }),
          t('product.parity.sectionTitleDim'),
        )}
        <FeatureParity locale={locale} product={product} headingId={`h-${SECTION_IDS.parity}`} />
      </section>
    ),

    // Los tres pasos, numerados como un contador de terminal (1 / 3).
    how: () => (
      <section className="lp-section pd-how" id={SECTION_IDS.how} key="how" aria-labelledby={`h-${SECTION_IDS.how}`}>
        {sign('how', t('product.howTitle'))}
        <div className="container">
          <ol className="pd-steps">
            {STEP_IDS.map((id, i) => (
              <li className="pd-step" key={id}>
                <span className="pd-step-mark" aria-hidden="true">
                  {i + 1} / {STEP_IDS.length}
                </span>
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
        {sign('video', tv('embedTitleDim'))}
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
            <p className="pd-compare-label">{building ? t('product.building.compareZero') : t('product.compareZero')}</p>
            <span className="pd-compare-num">{t(`${p}.compare.zero`)}</span>
            <dl className="zero-receipt">
              <div>
                <dt>{building ? t('product.building.zeroApp', { name: cfg.name }) : t('product.zeroApp', { name: cfg.name })}</dt>
                <dd>{t(`${p}.compare.zero`)}</dd>
              </div>
              <div>
                <dt>
                  {t.has(`${p}.compare.teamLabel`) ? t(`${p}.compare.teamLabel`) : t('product.compareTeam')}{' '}
                  {t('product.compareYear')}
                </dt>
                <dd>{t(`${p}.compare.zero`)}</dd>
              </div>
              <div>
                <dt>{t('product.zeroLicense')}</dt>
                <dd>AGPLv3</dd>
              </div>
            </dl>
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
        {sign('faq', t('product.faqTitle', { name: cfg.name }), building ? t('product.building.faqTitleDim') : t('product.faqTitleDim'))}
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

  const sections = spec.sections.map((s) => ({ id: SECTION_IDS[s], label: t(`product.nav.${s}`) }));

  // JSON-LD como en /tools: la app y la lista de lo que incluye (de la tabla de paridad).
  const ld = {
    '@context': 'https://schema.org',
    '@type': 'SoftwareApplication',
    name: `zerosoft ${cfg.name}`,
    description: t(`${p}.meta.description`),
    url: `${siteUrl()}/${locale}/products/${product}`,
    inLanguage: locale,
    applicationCategory: 'BusinessApplication',
    operatingSystem: 'Web',
    featureList: PARITY[product].rows.filter((r) => r.status !== 'missing').map((r) => loc(r.label, locale)),
    publisher: { '@type': 'Organization', name: 'zerosoft', url: siteUrl() },
  };

  return (
    <main className={`pd-page card-${product}`}>
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: jsonLd(ld) }} />
      {/* Primer viewport: el producto y su línea encendida en el plano. */}
      <section className="pd-hero" aria-labelledby="pd-title">
        <div className="pd-hero-text">
          <nav className="pd-crumbs" aria-label={t('product.crumbs')}>
            <Link href="/products">{tcm('header.products')}</Link>
            <span aria-hidden="true">/</span>
            <span aria-current="page">{cfg.name}</span>
          </nav>
          {building && <p className="pd-building">{t('product.building.badge')}</p>}
          <h1 id="pd-title" className="pd-title">
            <span className="pd-title-name">{cfg.name}</span>
            <span className="pd-tagline">
              {building ? t('product.building.tagline', { rival }) : t('product.alternative', { rival })}
            </span>
          </h1>
          <p className="pd-sub">{t(`${p}.hero.sub`)}</p>
          <div className="pd-actions">
            <Link className="btn btn-primary btn-lg" href={primaryHref}>
              {building ? t('product.building.propose') : t('product.launch', { name: cfg.name })}
            </Link>
            {building ? (
              <Link className="btn btn-secondary btn-lg" href="/feedback-board/roadmap">
                {t('product.building.roadmap')}
              </Link>
            ) : (
              <a className="btn btn-secondary btn-lg" href={GITHUB_URL} target="_blank" rel="noreferrer">
                <Icon name="github" size={16} /> {t('product.selfHost')}
              </a>
            )}
            {HAS_API.includes(product) && (
              <Link className="btn btn-ghost btn-lg" href="/docs">
                <Icon name="code" size={16} /> {t('product.apiDocs')}
              </Link>
            )}
          </div>
        </div>
        <HeroVisual focus={product} className="pd-hero-map" />
      </section>

      <ProductSectionNav product={product} sections={sections} label={t('product.navLabel', { name: cfg.name })} />

      {spec.sections.map((s) => blocks[s]())}

      {/* Cierre: la página se vuelve tinta, de a ceros, y la banda con las once apps. */}
      <ZeroEdge />
      <section className="lp-end" aria-labelledby="h-end">
        <div className="container lp-end-inner">
          <h2 id="h-end">
            {t(`${p}.cta.title1`)}
            <br />
            <span>{t(`${p}.cta.title2`)}</span>
          </h2>
          <p className="lp-end-sub">{t(`${p}.cta.sub`)}</p>
          <div className="lp-ctas">
            <Link className="btn btn-invert-solid btn-lg" href={primaryHref}>
              {t(`${p}.cta.button`)}
            </Link>
            <a className="btn btn-invert btn-lg" href={GITHUB_URL} target="_blank" rel="noreferrer">
              <Icon name="github" size={16} /> {t('product.selfHost')}
            </a>
          </div>
          <ProductLinks label={tcm('header.products')} current={product} />
        </div>
      </section>
    </main>
  );
}
