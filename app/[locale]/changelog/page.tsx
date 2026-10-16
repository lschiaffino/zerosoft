import { getTranslations, setRequestLocale } from 'next-intl/server';
import { Link } from '@/i18n/navigation';
import ChangelogList from '@/components/ChangelogList';
import { getUnifiedChangelog } from '@/lib/changelog';
import { boardItemPath } from '@/lib/board-paths';
import { isProductKey } from '@/lib/product-taxonomy';
import '@/styles/changelog.css';

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

/**
 * Changelog público. ?product=cal filtra. Fuente: content/changelog.ts +
 * entradas publicadas desde el admin (changelog_entries), ordenadas por fecha.
 */
export default async function ChangelogPage(props: {
  params: Promise<{ locale: string }>;
  searchParams: Promise<{ product?: string }>;
}) {
  const { locale } = await props.params;
  const { product } = await props.searchParams;
  setRequestLocale(locale);
  const t = await getTranslations({ locale, namespace: 'changelog' });
  const tb = await getTranslations({ locale, namespace: 'feedbackBoard.nav' });
  const filter = isProductKey(product) ? product : null;
  const entries = await getUnifiedChangelog();

  return (
    <main className="container cl-main">
      <header className="read-hero">
        <h1 className="read-title">
          {t('title')} <span className="dim">{t('titleDim')}</span>
        </h1>
        <p className="read-intro">{t('intro')}</p>
        <div className="read-actions">
          <a className="btn btn-secondary btn-sm" href={`/${locale}/changelog/feed.xml`}>
            {t('rss')}
          </a>
          <Link className="btn btn-secondary btn-sm" href="/feedback-board/roadmap">
            {tb('roadmap')}
          </Link>
          <Link className="btn btn-secondary btn-sm" href="/feedback-board">
            {t('feedback')}
          </Link>
        </div>
      </header>

      <ChangelogList
        locale={locale}
        entries={entries}
        filter={filter}
        filterHref={(p) => (p ? `/${locale}/changelog?product=${p}` : `/${locale}/changelog`)}
        itemHref={(id, title) => boardItemPath(locale, false, id, title)}
      />

      {!filter && <p className="cl-end">{t('endNote')}</p>}

      <div className="cl-cta">
        <div>
          <h2 className="cl-cta-title">{t('ctaTitle')}</h2>
          <p className="cl-cta-body">{t('ctaBody')}</p>
        </div>
        <Link className="btn btn-invert-solid" href="/feedback-board/new">
          {t('ctaButton')}
        </Link>
      </div>
    </main>
  );
}
