import type { Metadata } from 'next';
import { getTranslations, setRequestLocale } from 'next-intl/server';
import DefaultLogo from '@/components/brand/default/DefaultLogo';
import ZeroMark from '@/components/zero/ZeroMark';
import CopyValue from '@/components/brand/CopyValue';
import { PRODUCT_CONFIG, PRODUCT_KEYS } from '@/lib/products';
import { headers } from 'next/headers';
import { surfaceForHost } from '@/lib/host-rewrite';
import { siteUrl } from '@/lib/board-urls';
import '@/styles/brand-default.css';

/** Los neutros de la marca default (styles/themes/default.css). */
const NEUTRALS = [
  { key: 'white', hex: '#ffffff' },
  { key: 'ink', hex: '#0d0d0d' },
  { key: 'gray1', hex: '#4a4a4a' },
  { key: 'gray2', hex: '#5e5e5e' },
  { key: 'gray3', hex: '#6e6e6e' },
  { key: 'rule', hex: '#e8e8e8' },
] as const;

export async function generateMetadata(props: { params: Promise<{ locale: string }> }): Promise<Metadata> {
  const { locale } = await props.params;
  const t = await getTranslations({ locale, namespace: 'brand.default.meta' });
  return { title: t('title'), description: t('description') };
}

/**
 * La marca default, en una página: el logo (el cero y "zerosoft.ai"), los
 * colores (neutros y uno por app) y la tipografía. También la sirve
 * branding.zerosoft.ai. La guía del tema opcional vive en
 * /nuevo-branding/subte.
 */
export default async function BrandPage(props: { params: Promise<{ locale: string }> }) {
  const { locale } = await props.params;
  setRequestLocale(locale);
  const t = await getTranslations({ locale, namespace: 'brand.default' });
  // En branding.zerosoft.ai todo path se reescribe a /brand: los links al
  // sitio van absolutos.
  const onSurface = surfaceForHost((await headers()).get('host')) === 'brand';
  const site = onSurface ? `${siteUrl()}/${locale}` : `/${locale}`;

  return (
    <div className="bd-root">
      <header className="bd-head">
        <div className="bd-wrap bd-head-inner">
          <a className="bd-home" href={site} aria-label={t('home')}>
            <DefaultLogo height={22} title="" />
          </a>
          <a className="bd-head-link" href={site}>
            {t('backToSite')}
          </a>
        </div>
      </header>

      <main className="bd-wrap bd-main">
        <section className="bd-hero" aria-labelledby="bd-title">
          <h1 id="bd-title" className="bd-title">
            {t('title')}
          </h1>
          <p className="bd-lead">{t('lead')}</p>
        </section>

        <section className="bd-section" aria-labelledby="bd-logo">
          <h2 id="bd-logo" className="bd-h2">
            {t('logoTitle')}
          </h2>
          <p className="bd-body">{t('logoBody')}</p>
          <div className="bd-logo-grid">
            <figure className="bd-tile">
              <div className="bd-tile-art">
                <DefaultLogo height={40} title="zerosoft.ai" />
              </div>
              <figcaption>{t('onLight')}</figcaption>
            </figure>
            <figure className="bd-tile bd-tile-dark">
              <div className="bd-tile-art">
                <DefaultLogo height={40} tone="white" title="zerosoft.ai" />
              </div>
              <figcaption>{t('onDark')}</figcaption>
            </figure>
            <figure className="bd-tile">
              <div className="bd-tile-art">
                <span className="bd-icon">
                  <ZeroMark size={56} title="zerosoft.ai" />
                </span>
              </div>
              <figcaption>{t('symbol')}</figcaption>
            </figure>
          </div>
        </section>

        <section className="bd-section" aria-labelledby="bd-colors">
          <h2 id="bd-colors" className="bd-h2">
            {t('colorsTitle')}
          </h2>
          <h3 className="bd-h3">{t('neutralsTitle')}</h3>
          <ul className="bd-swatches">
            {NEUTRALS.map((n) => (
              <li key={n.key} className="bd-swatch">
                <span className="bd-chip" style={{ background: n.hex }} />
                <span className="bd-swatch-name">{t(`neutrals.${n.key}`)}</span>
                <CopyValue value={n.hex} label={t('copy', { value: n.hex })} copied={t('copied')} />
              </li>
            ))}
          </ul>

          <h3 className="bd-h3">{t('productsTitle')}</h3>
          <p className="bd-body">{t('productsBody')}</p>
          <ul className="bd-swatches bd-products">
            {PRODUCT_KEYS.map((k) => (
              <li key={k} className={`bd-swatch card-${k}`}>
                <span className="bd-chip" style={{ background: PRODUCT_CONFIG[k].color }} />
                <span className="bd-swatch-name">
                  <ZeroMark size={14} className="product-zero" />
                  {PRODUCT_CONFIG[k].name}
                </span>
                <CopyValue
                  value={PRODUCT_CONFIG[k].color}
                  label={t('copy', { value: PRODUCT_CONFIG[k].color })}
                  copied={t('copied')}
                />
              </li>
            ))}
          </ul>
        </section>

        <section className="bd-section" aria-labelledby="bd-type">
          <h2 id="bd-type" className="bd-h2">
            {t('typeTitle')}
          </h2>
          <div className="bd-type-grid">
            <div className="bd-type">
              <p className="bd-type-specimen bd-type-sans">Aa 0123</p>
              <p className="bd-type-name">Space Grotesk</p>
              <p className="bd-body">{t('sans')}</p>
            </div>
            <div className="bd-type">
              <p className="bd-type-specimen bd-type-mono">Aa 0123</p>
              <p className="bd-type-name">IBM Plex Mono</p>
              <p className="bd-body">{t('mono')}</p>
            </div>
          </div>
        </section>

        <section className="bd-section" aria-labelledby="bd-themes">
          <h2 id="bd-themes" className="bd-h2">
            {t('themesTitle')}
          </h2>
          <p className="bd-body">{t('themesBody')}</p>
          <p>
            <a className="bd-link" href={`${site}/nuevo-branding/subte`}>
              {t('themesLink')}
            </a>
          </p>
        </section>
      </main>
    </div>
  );
}
