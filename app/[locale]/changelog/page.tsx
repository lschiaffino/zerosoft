import type { CSSProperties } from 'react';
import { getTranslations, setRequestLocale } from 'next-intl/server';
import { Link } from '@/i18n/navigation';
import Reveal from '@/components/Reveal';
import { CHANGELOG, pick, type ChangelogProduct } from '@/content/changelog';
import '@/styles/pages.css';
import '@/styles/changelog.css';

const PRODUCTS: ChangelogProduct[] = ['link', 'crm', 'cal', 'track', 'chat', 'docs', 'platform'];

/** Color de cada producto (tokens --c-* de globals.css); plataforma en tinta. */
const COLOR: Record<ChangelogProduct, string> = {
  link: 'var(--c-link)',
  crm: 'var(--c-crm)',
  cal: 'var(--c-cal)',
  track: 'var(--c-track)',
  chat: 'var(--c-chat)',
  docs: 'var(--c-docs)',
  platform: 'var(--ink)',
};

export async function generateMetadata(props: { params: Promise<{ locale: string }> }) {
  const { locale } = await props.params;
  const t = await getTranslations({ locale, namespace: 'changelog' });
  const title = t('metaTitle');
  const description = t('metaDescription');
  return {
    title,
    description,
    alternates: {
      canonical: `/${locale}/changelog`,
      types: { 'application/atom+xml': [{ url: `/${locale}/changelog/feed.xml`, title: t('feedTitle') }] },
    },
    openGraph: { title, description, type: 'website', url: `/${locale}/changelog`, images: ['/api/og/changelog'] },
    twitter: { card: 'summary_large_image', title, description, images: ['/api/og/changelog'] },
  };
}

function dateParts(iso: string, locale: string) {
  const d = new Date(`${iso}T12:00:00Z`);
  return {
    day: new Intl.DateTimeFormat(locale, { day: '2-digit', timeZone: 'UTC' }).format(d),
    month: new Intl.DateTimeFormat(locale, { month: 'short', timeZone: 'UTC' }).format(d).replace('.', ''),
    year: String(d.getUTCFullYear()),
    full: new Intl.DateTimeFormat(locale, { dateStyle: 'long', timeZone: 'UTC' }).format(d),
  };
}

/** Changelog público. ?product=cal filtra; content/changelog.ts es la fuente. */
export default async function ChangelogPage(props: {
  params: Promise<{ locale: string }>;
  searchParams: Promise<{ product?: string }>;
}) {
  const { locale } = await props.params;
  const { product } = await props.searchParams;
  setRequestLocale(locale);
  const t = await getTranslations({ locale, namespace: 'changelog' });
  const filter = PRODUCTS.includes(product as ChangelogProduct) ? (product as ChangelogProduct) : null;

  const entries = CHANGELOG.map((e) => ({
    ...e,
    items: filter ? e.items.filter((i) => i.product === filter) : e.items,
  })).filter((e) => e.items.length > 0);

  return (
    <main className="cl-main">
      <div className="doc-hero container">
        <p className="section-label">{t('label')}</p>
        <h1 className="doc-title">
          {t('title')}
          <br />
          <span className="dim">{t('titleDim')}</span>
        </h1>
        <p className="doc-intro">{t('intro')}</p>
        <div className="cl-hero-actions">
          <a className="btn btn-ghost btn-small" href={`/${locale}/changelog/feed.xml`}>
            <span className="cl-feed-glyph" aria-hidden="true" />
            {t('rss')}
          </a>
          <Link className="btn btn-ghost btn-small" href="/feedback">
            {t('feedback')}
          </Link>
        </div>
      </div>

      <div className="container">
        <nav className="cl-filters" aria-label={t('label')}>
          <Link href="/changelog" className={`cl-chip${filter ? '' : ' active'}`} scroll={false}>
            {t('filterAll')}
          </Link>
          {PRODUCTS.map((p) => (
            <Link
              key={p}
              href={`/changelog?product=${p}`}
              scroll={false}
              className={`cl-chip${filter === p ? ' active' : ''}`}
              style={{ '--dot': COLOR[p] } as CSSProperties}
            >
              <i aria-hidden="true" />
              {t(`product.${p}`)}
            </Link>
          ))}
          <span className="cl-count mono">{t('releases', { count: entries.length })}</span>
        </nav>

        <ol className="cl-list">
          {entries.map((e) => {
            const d = dateParts(e.date, locale);
            const products = PRODUCTS.filter((p) => e.items.some((i) => i.product === p));
            return (
              <li key={e.id} id={e.id} className="cl-entry">
                <div className="cl-date">
                  <time dateTime={e.date} title={d.full}>
                    <span className="cl-day">{d.day}</span>
                    <span className="cl-month">
                      {d.month} {d.year}
                    </span>
                  </time>
                </div>
                <span className="cl-node" aria-hidden="true" />
                <Reveal as="article" className="cl-card">
                  <div className="cl-card-top">
                    <span className="cl-dots" aria-hidden="true">
                      {products.map((p) => (
                        <i key={p} style={{ background: COLOR[p] }} />
                      ))}
                    </span>
                    <a className="cl-anchor mono" href={`#${e.id}`}>
                      #{e.id}
                    </a>
                  </div>
                  <h2 className="cl-title">{pick(e.title, locale)}</h2>
                  <ul className="cl-items">
                    {e.items.map((item, i) => (
                      <li key={i} style={{ '--dot': COLOR[item.product] } as CSSProperties}>
                        <span className="cl-tag">
                          <i aria-hidden="true" />
                          {t(`product.${item.product}`)}
                        </span>
                        <span className="cl-text">{pick(item, locale)}</span>
                      </li>
                    ))}
                  </ul>
                </Reveal>
              </li>
            );
          })}
        </ol>

        {!filter && <p className="cl-end mono">{t('endNote')}</p>}

        <div className="cl-cta">
          <div>
            <p className="cl-cta-title">{t('ctaTitle')}</p>
            <p className="cl-cta-body">{t('ctaBody')}</p>
          </div>
          <Link className="btn btn-solid" href="/feedback">
            {t('ctaButton')}
          </Link>
        </div>
      </div>
    </main>
  );
}
