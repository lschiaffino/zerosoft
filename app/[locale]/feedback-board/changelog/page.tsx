import { getTranslations, setRequestLocale } from 'next-intl/server';
import BoardChrome from '@/components/board/BoardChrome';
import ChangelogList from '@/components/ChangelogList';
import { getUnifiedChangelog } from '@/lib/changelog';
import { getBoardContext } from '@/lib/board-context';
import { boardItemPath, boardPath } from '@/lib/board-paths';
import { getBoardPerson } from '@/lib/board-session';
import { absoluteBoardUrl } from '@/lib/board-urls';
import { isProductKey } from '@/lib/product-taxonomy';

export const dynamic = 'force-dynamic';

export async function generateMetadata(props: { params: Promise<{ locale: string }> }) {
  const { locale } = await props.params;
  const t = await getTranslations({ locale, namespace: 'changelog' });
  const title = t('metaTitle');
  const description = t('metaDescription');
  return {
    title,
    description,
    // El canónico es /changelog del sitio: mismo contenido.
    alternates: { canonical: `/${locale}/changelog` },
    openGraph: { title, description, type: 'website', url: absoluteBoardUrl(locale, '/changelog'), images: ['/api/og/changelog'] },
  };
}

/** Changelog dentro del board (feedback.zerosoft.ai/changelog). */
export default async function BoardChangelogPage(props: {
  params: Promise<{ locale: string }>;
  searchParams: Promise<{ product?: string }>;
}) {
  const { locale } = await props.params;
  const { product } = await props.searchParams;
  setRequestLocale(locale);
  const [ctx, person, t, entries] = await Promise.all([
    getBoardContext(locale),
    getBoardPerson(),
    getTranslations({ locale, namespace: 'changelog' }),
    getUnifiedChangelog(),
  ]);
  const filter = isProductKey(product) ? product : null;
  const base = boardPath(locale, ctx.onSurface, '/changelog');

  return (
    <>
      <BoardChrome ctx={ctx} person={person} active="changelog" returnPath="/changelog" />
      <main className="bp-wrap bp-changelog">
        <div className="bp-hero">
          <div>
            <h1 className="bp-title">{t('title')}</h1>
            <p className="bp-intro">{t('intro')}</p>
          </div>
          <a className="btn btn-secondary" href={`/${locale}/changelog/feed.xml`}>
            {t('rss')}
          </a>
        </div>
        <ChangelogList
          locale={locale}
          entries={entries}
          filter={filter}
          filterHref={(p) => (p ? `${base}?product=${p}` : base)}
          itemHref={(id, title) => boardItemPath(locale, ctx.onSurface, id, title)}
        />
      </main>
    </>
  );
}
