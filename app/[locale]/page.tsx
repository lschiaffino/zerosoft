import { use } from "react";
import { useTranslations } from 'next-intl';
import { setRequestLocale } from 'next-intl/server';
import { Link } from '@/i18n/navigation';
import ZeroField from '@/components/ZeroField';
import Reveal from '@/components/Reveal';

export default function HomePage(props: { params: Promise<{ locale: string }> }) {
  const params = use(props.params);

  const {
    locale
  } = params;

  setRequestLocale(locale);
  const t = useTranslations('common');

  return (
    <main id="top">
      {/* HERO */}
      <section className="hero" id="hero">
        <ZeroField align="right" sizeFactor={0.92} />
        <div className="hero-content">
          <h1>
            {t('hero.title1')}
            <br />
            {t('hero.title2')}
          </h1>
          <p className="hero-sub">{t('hero.sub')}</p>
          <div className="hero-actions">
            <Link className="btn btn-solid" href="/products">
              {t('hero.ctaPrimary')}
            </Link>
            <a className="btn btn-ghost" href="#manifiesto">
              {t('hero.ctaSecondary')}
            </a>
          </div>
        </div>
        <span className="scroll-hint" aria-hidden="true">
          {t('hero.scroll')}
        </span>
      </section>

      {/* MARQUEE DE CEROS */}
      <div className="zero-marquee" aria-hidden="true">
        <div className="zero-track">
          <span>0000000000000000000000000000000000000000000000000000000000000000</span>
          <span>0000000000000000000000000000000000000000000000000000000000000000</span>
        </div>
      </div>

      {/* MANIFIESTO */}
      <section className="manifesto container" id="manifiesto">
        <p className="section-label">{t('manifesto.label')}</p>
        <div className="manifesto-body">
          <Reveal as="p">
            {t.rich('manifesto.p1', { strong: (chunks) => <strong>{chunks}</strong> })}
          </Reveal>
          <Reveal as="p">
            {t.rich('manifesto.p2', { strong: (chunks) => <strong>{chunks}</strong> })}
          </Reveal>
          <Reveal as="p">{t('manifesto.p3')}</Reveal>
          <Reveal as="p" className="manifesto-final">
            {t('manifesto.final')}
          </Reveal>
        </div>
      </section>

      {/* NÚMEROS */}
      <section className="stats container">
        <Reveal className="stat">
          <span className="stat-num">{t('stats.s1num')}</span>
          <span className="stat-label">{t('stats.s1label')}</span>
        </Reveal>
        <Reveal className="stat">
          <span className="stat-num">{t('stats.s2num')}</span>
          <span className="stat-label">{t('stats.s2label')}</span>
        </Reveal>
        <Reveal className="stat">
          <span className="stat-num">{t('stats.s3num')}</span>
          <span className="stat-label">{t('stats.s3label')}</span>
        </Reveal>
      </section>

      {/* PRODUCTOS */}
      <section className="products container" id="productos">
        <p className="section-label">{t('products.label')}</p>
        <Reveal as="h2" className="section-title">
          {t('products.title')}
          <br />
          <span className="dim">{t('products.titleDim')}</span>
        </Reveal>

        <div className="product-grid">
          {(['track', 'crm', 'cal', 'link', 'docs', 'chat'] as const).map((key, i) => (
            <Reveal as="article" className="card" key={key}>
              <Link href={`/products/${key}`} style={{ display: 'contents' }}>
                <div className="card-top">
                  <span className="card-num">0{i + 1}</span>
                  <span className="card-status">{t(`products.${key}.status`)}</span>
                </div>
                <h3>{key === 'crm' ? 'CRM' : key === 'cal' ? 'Cal' : key === 'link' ? 'Link' : key === 'docs' ? 'Docs' : key === 'chat' ? 'Chat' : 'Track'}</h3>
                <p className="card-tag">{t(`products.${key}.tag`)}</p>
                <p className="card-desc">{t(`products.${key}.desc`)}</p>
                <span className="card-arrow" aria-hidden="true">→</span>
              </Link>
            </Reveal>
          ))}

          <Reveal as="article" className="card card-wide">
            <div className="card-top">
              <span className="card-num">07</span>
              <span className="card-status">{t('products.more.status')}</span>
            </div>
            <h3>{t('products.more.title')}</h3>
            <p className="card-tag">{t('products.more.tag')}</p>
            <p className="card-desc">{t('products.more.desc')}</p>
            <span className="card-arrow" aria-hidden="true">→</span>
          </Reveal>
        </div>
      </section>

      {/* MODELO */}
      <section className="model container" id="modelo">
        <p className="section-label">{t('model.label')}</p>
        <Reveal as="h2" className="section-title">
          {t('model.title')}
          <br />
          <span className="dim">{t('model.titleDim')}</span>
        </Reveal>

        <div className="model-grid">
          <Reveal className="model-card">
            <p className="model-key">A</p>
            <h3>{t('model.a.title')}</h3>
            <p className="model-desc">{t('model.a.desc')}</p>
            <p className="model-price">
              {t('model.a.price')} <span>{t('model.a.priceNote')}</span>
            </p>
          </Reveal>
          <Reveal className="model-card model-card-dark">
            <p className="model-key">B</p>
            <h3>{t('model.b.title')}</h3>
            <p className="model-desc">{t('model.b.desc')}</p>
            <p className="model-price">
              {t('model.b.price')} <span>{t('model.b.priceNote')}</span>
            </p>
          </Reveal>
        </div>
      </section>

      {/* MARQUEE DE CEROS */}
      <div className="zero-marquee" aria-hidden="true">
        <div className="zero-track">
          <span>0000000000000000000000000000000000000000000000000000000000000000</span>
          <span>0000000000000000000000000000000000000000000000000000000000000000</span>
        </div>
      </div>

      {/* CIERRE */}
      <section className="end" id="sumate">
        <span className="end-zero" aria-hidden="true">0</span>
        <div className="end-content">
          <p className="section-label light">{t('end.label')}</p>
          <h2>
            {t('end.title1')}
            <br />
            {t('end.title2')}
          </h2>
          <p className="end-sub">{t('end.sub')}</p>
          <a className="btn btn-invert" href="mailto:hola@zerosoft.ai">
            {t('end.cta')}
          </a>
        </div>
      </section>
    </main>
  );
}
