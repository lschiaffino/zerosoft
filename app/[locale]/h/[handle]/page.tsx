import type { Metadata } from 'next';
import type { CSSProperties } from 'react';
import { notFound } from 'next/navigation';
import { getTranslations, setRequestLocale } from 'next-intl/server';
import { getHelpWorkspace, listHelpCollections, searchHelpArticles } from '@/lib/docs-help';
import { helpAccentStyle } from '@/lib/docs-accent';
import Icon from '@/components/app/icons';
import EmptyState from '@/components/ui/EmptyState';
import HelpHeader from '@/components/docs/HelpHeader';
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

/**
 * Centro de ayuda público del workspace: búsqueda y las colecciones dibujadas
 * como una línea en el color del workspace, una estación por colección.
 */
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
  const style = helpAccentStyle(ws.accent) as CSSProperties;

  return (
    <main className="help" style={style}>
      <HelpHeader locale={locale} name={ws.name} base={base} />

      <section className="help-hero">
        <div className="help-wrap">
          {/* El nombre del workspace ya está en el header: el título es la tarea. */}
          <h1 className="help-title">{t('heroTitle')}</h1>
          <form action={base} method="get" className="help-search" role="search">
            <span className="help-search-icon" aria-hidden="true">
              <Icon name="search" size={18} />
            </span>
            <input
              type="search"
              name="q"
              defaultValue={q}
              placeholder={t('searchPlaceholder')}
              aria-label={t('searchPlaceholder')}
              className="input help-search-input"
            />
            <button type="submit" className="btn btn-primary btn-lg help-search-btn">
              {t('search')}
            </button>
          </form>
        </div>
      </section>

      <div className="help-wrap help-body-wrap">
        {results ? (
          <section className="help-section" aria-labelledby="help-results">
            <h2 className="help-section-title" id="help-results">
              {t('resultsFor', { q })}
            </h2>
            {results.length === 0 ? (
              <EmptyState
                title={t('noResultsTitle', { q })}
                body={t('noResultsBody')}
                action={
                  <a href={base} className="btn btn-primary">
                    {t('allArticles')}
                  </a>
                }
              />
            ) : (
              <ul className="help-list">
                {results.map((a) => (
                  <li key={a.id}>
                    <a href={`${base}/${a.slug}`} className="help-row">
                      <span className="help-row-title">{a.title || t('untitled')}</span>
                      {a.collection ? (
                        <span className="help-row-crumb">{a.collection.title || t('untitled')}</span>
                      ) : a.articleCount > 0 ? (
                        <span className="help-row-crumb">
                          {t('collectionOf', { count: a.articleCount })}
                        </span>
                      ) : null}
                      {a.excerpt && <span className="help-row-excerpt">{a.excerpt}</span>}
                    </a>
                  </li>
                ))}
              </ul>
            )}
          </section>
        ) : collections.length === 0 ? (
          <EmptyState title={t('empty')} body={t('emptyBody')} />
        ) : (
          <ol className="help-line">
            {collections.map((c) => (
              <li key={c.id} className="help-stop">
                <span className="help-station" aria-hidden="true" />
                <div className="help-stop-body">
                  <h2 className="help-collection-title">
                    <a href={`${base}/${c.slug}`}>
                      {c.icon && <span aria-hidden="true">{c.icon} </span>}
                      {c.title || t('untitled')}
                    </a>
                  </h2>
                  <p className="help-collection-meta">
                    {c.excerpt && <span className="help-collection-excerpt">{c.excerpt}</span>}
                    {c.articles.length > 0 && (
                      <span className="help-collection-count">{t('articleCount', { count: c.articles.length })}</span>
                    )}
                  </p>
                  {c.articles.length > 0 && (
                    <ul className="help-collection-list">
                      {c.articles.map((a) => (
                        <li key={a.id}>
                          <a href={`${base}/${a.slug}`}>{a.title || t('untitled')}</a>
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
              </li>
            ))}
          </ol>
        )}
      </div>
    </main>
  );
}
