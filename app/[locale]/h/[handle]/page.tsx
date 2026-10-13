import type { Metadata } from 'next';
import type { CSSProperties } from 'react';
import { notFound } from 'next/navigation';
import { getTranslations, setRequestLocale } from 'next-intl/server';
import { getHelpWorkspace, listHelpCollections, searchHelpArticles } from '@/lib/docs-help';
import '@/styles/help.css';

export const dynamic = 'force-dynamic';

type Props = {
  params: Promise<{ locale: string; handle: string }>;
  searchParams: Promise<{ q?: string }>;
};

export async function generateMetadata(props: Props): Promise<Metadata> {
  const { locale, handle } = await props.params;
  const ws = await getHelpWorkspace(handle);
  const t = await getTranslations({ locale, namespace: 'docs.help' });
  if (!ws) return { title: t('notFound') };
  return {
    title: { absolute: t('metaTitle', { name: ws.name }) },
    description: t('metaDescription', { name: ws.name }),
    alternates: { canonical: `/${locale}/h/${ws.handle}` },
  };
}

/** Centro de ayuda público del workspace: colecciones + búsqueda. */
export default async function HelpCenterHome(props: Props) {
  const { locale, handle } = await props.params;
  const { q: rawQ } = await props.searchParams;
  setRequestLocale(locale);
  const ws = await getHelpWorkspace(handle);
  if (!ws) notFound();
  const t = await getTranslations({ locale, namespace: 'docs.help' });
  const q = (rawQ ?? '').trim().slice(0, 200);
  const [collections, results] = await Promise.all([
    listHelpCollections(ws.id),
    q ? searchHelpArticles(ws.id, q, 10) : Promise.resolve(null),
  ]);
  const base = `/${locale}/h/${ws.handle}`;
  const style = (ws.accent ? { '--help-accent': ws.accent } : {}) as CSSProperties;

  return (
    <main className="help" style={style}>
      <header className="help-head">
        <a href={base} className="help-brand">
          {ws.name}
        </a>
      </header>

      <section className="help-hero">
        <h1 className="help-title">{t('title')}</h1>
        <form action={base} method="get" className="help-search" role="search">
          <input
            type="search"
            name="q"
            defaultValue={q}
            placeholder={t('searchPlaceholder')}
            aria-label={t('searchPlaceholder')}
            className="help-search-input"
          />
          <button type="submit" className="help-search-btn">
            {t('search')}
          </button>
        </form>
      </section>

      {results ? (
        <section className="help-section">
          <p className="help-section-label">{t('resultsFor', { q })}</p>
          {results.length === 0 ? (
            <p className="help-empty">{t('noResults')}</p>
          ) : (
            <ul className="help-list">
              {results.map((a) => (
                <li key={a.id}>
                  <a href={`${base}/${a.slug}`} className="help-row">
                    <span className="help-row-title">{a.title || t('untitled')}</span>
                    {a.excerpt && <span className="help-row-excerpt">{a.excerpt}</span>}
                  </a>
                </li>
              ))}
            </ul>
          )}
        </section>
      ) : collections.length === 0 ? (
        <p className="help-empty">{t('empty')}</p>
      ) : (
        <div className="help-collections">
          {collections.map((c) => (
            <section key={c.id} className="help-collection">
              <a href={`${base}/${c.slug}`} className="help-collection-head">
                {c.icon && <span className="help-icon" aria-hidden>{c.icon}</span>}
                <span className="help-collection-title">{c.title || t('untitled')}</span>
              </a>
              {c.excerpt && <p className="help-collection-excerpt">{c.excerpt}</p>}
              {c.articles.length > 0 && (
                <ul className="help-collection-list">
                  {c.articles.map((a) => (
                    <li key={a.id}>
                      <a href={`${base}/${a.slug}`}>{a.title || t('untitled')}</a>
                    </li>
                  ))}
                </ul>
              )}
            </section>
          ))}
        </div>
      )}
    </main>
  );
}
