import type { Metadata } from 'next';
import { cache, type CSSProperties } from 'react';
import { notFound } from 'next/navigation';
import { getFormatter, getTranslations, setRequestLocale } from 'next-intl/server';
import { getHelpArticle as loadHelpArticle, getHelpWorkspace as loadHelpWorkspace } from '@/lib/docs-help';
import { sanitizeBlocks } from '@/lib/docs-sanitize';
import { buildToc } from '@/lib/docs-toc';
import { helpAccentStyle } from '@/lib/docs-accent';
import DocsBlocksView from '@/components/docs/DocsBlocksView';
import HelpHeader from '@/components/docs/HelpHeader';
import HelpFeedback from '@/components/docs/HelpFeedback';
import '@/styles/help.css';

export const dynamic = 'force-dynamic';

// generateMetadata y la página piden lo mismo: una sola lectura por request.
const getHelpWorkspace = cache(loadHelpWorkspace);
const getHelpArticle = cache(loadHelpArticle);

type Props = { params: Promise<{ locale: string; handle: string; slug: string }> };

export async function generateMetadata(props: Props): Promise<Metadata> {
  const { locale, handle, slug } = await props.params;
  const ws = await getHelpWorkspace(handle);
  const article = ws ? await getHelpArticle(ws.id, slug) : null;
  const t = await getTranslations({ locale, namespace: 'docs.help' });
  if (!ws || !article) return { title: t('notFound') };
  return {
    title: { absolute: `${article.title || t('untitled')} · ${ws.name}` },
    description: article.excerpt || undefined,
    alternates: { canonical: `/${locale}/h/${ws.handle}/${article.slug}` },
    openGraph: { title: article.title, description: article.excerpt || undefined, type: 'article' },
  };
}

/** Artículo del centro de ayuda: solo lectura, índice, anterior/siguiente y "¿Te sirvió?". */
export default async function HelpArticlePage(props: Props) {
  const { locale, handle, slug } = await props.params;
  setRequestLocale(locale);
  const ws = await getHelpWorkspace(handle);
  if (!ws) notFound();
  const article = await getHelpArticle(ws.id, slug);
  if (!article) notFound();
  const t = await getTranslations({ locale, namespace: 'docs.help' });
  const format = await getFormatter({ locale });
  // Defensa en profundidad: se re-sanitiza al servir una página pública.
  const blocks = sanitizeBlocks(article.content);
  const toc = buildToc(blocks);
  const base = `/${locale}/h/${ws.handle}`;
  const style = helpAccentStyle(ws.accent) as CSSProperties;

  return (
    <main className="help help-article-page" style={style}>
      <HelpHeader locale={locale} name={ws.name} base={base} search />

      <div className="help-wrap">
        <nav className="help-crumbs" aria-label={t('breadcrumb')}>
          <ol>
            <li>
              <a href={base}>{t('title')}</a>
            </li>
            {article.collection && (
              <li>
                <a href={`${base}/${article.collection.slug}`}>{article.collection.title || t('untitled')}</a>
              </li>
            )}
          </ol>
        </nav>

        <div className={`help-article-grid${toc.length > 1 ? ' has-toc' : ''}`}>
          <article className="help-article">
            <header className="help-article-head">
              {article.icon && (
                <span className="help-article-icon" aria-hidden="true">
                  {article.icon}
                </span>
              )}
              <h1 className="help-article-title">{article.title || t('untitled')}</h1>
              <p className="help-article-meta">
                {t('updated', { date: format.dateTime(new Date(article.updated_at), { dateStyle: 'medium' }) })}
              </p>
            </header>
            <DocsBlocksView blocks={blocks} className="docs-prose help-body" />

            {/* Portada de colección: sus artículos son las estaciones de la línea del workspace. */}
            {article.children.length > 0 ? (
              <ol className="help-line help-line-children" aria-label={t('articlesIn', { title: article.title || t('untitled') })}>
                {article.children.map((c) => (
                  <li key={c.id} className="help-stop">
                    <span className="help-station" aria-hidden="true" />
                    <div className="help-stop-body">
                      <h2 className="help-collection-title">
                        <a href={`${base}/${c.slug}`}>
                          {c.icon && <span aria-hidden="true">{c.icon} </span>}
                          {c.title || t('untitled')}
                        </a>
                      </h2>
                      {c.excerpt && (
                        <p className="help-collection-meta">
                          <span className="help-collection-excerpt">{c.excerpt}</span>
                        </p>
                      )}
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
            ) : (
              <HelpFeedback pageId={article.id} />
            )}

            {(article.prev || article.next) && (
              <nav className="help-pager" aria-label={t('pager')}>
                {article.prev ? (
                  <a href={`${base}/${article.prev.slug}`} className="help-pager-link" rel="prev">
                    <span className="help-pager-dir">{t('prev')}</span>
                    <span className="help-pager-title">{article.prev.title || t('untitled')}</span>
                  </a>
                ) : (
                  <span />
                )}
                {article.next && (
                  <a href={`${base}/${article.next.slug}`} className="help-pager-link help-pager-next" rel="next">
                    <span className="help-pager-dir">{t('next')}</span>
                    <span className="help-pager-title">{article.next.title || t('untitled')}</span>
                  </a>
                )}
              </nav>
            )}
          </article>

          {toc.length > 1 && (
            <aside className="help-toc" aria-labelledby="help-toc-label">
              <p className="help-toc-label" id="help-toc-label">
                {t('toc')}
              </p>
              <ul>
                {toc.map((e) => (
                  <li key={e.anchor} className={`help-toc-l${e.level}`}>
                    <a href={`#${e.anchor}`}>{e.text}</a>
                  </li>
                ))}
              </ul>
            </aside>
          )}
        </div>
      </div>
    </main>
  );
}
