import type { Metadata } from 'next';
import { cache, type CSSProperties } from 'react';
import { notFound } from 'next/navigation';
import { getFormatter, getTranslations, setRequestLocale } from 'next-intl/server';
import { getHelpArticle as loadHelpArticle, getHelpWorkspace as loadHelpWorkspace, publishedRelatedDatabases } from '@/lib/docs-help';
import { sanitizeBlocks } from '@/lib/docs-sanitize';
import { stripFileUrls } from '@/lib/docs-files';
import { resolveBlocksPageLinks } from '@/lib/docs-page-links';
import { buildToc } from '@/lib/docs-toc';
import { helpAccentStyle } from '@/lib/docs-accent';
import DocsBlocksView from '@/components/docs/DocsBlocksView';
import { cleanForReaders } from '@/lib/docs-marks';
import DocsPageIcon from '@/components/docs/DocsPageIcon';
import { DocsStaticCover } from '@/components/docs/DocsStaticCover';
import HelpHeader from '@/components/docs/HelpHeader';
import HelpFeedback from '@/components/docs/HelpFeedback';
import HelpView from '@/components/docs/HelpView';
import { getDocsSite, getPagePublishSettings, verifiedSiteHost } from '@/lib/docs-site';
import { appOrigin, helpBase } from '@/lib/docs-site-base';
import '@/styles/help.css';
import { parseDbUtc } from '@/lib/utils';

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
  const [site, domain, seo] = await Promise.all([getDocsSite(ws.id), verifiedSiteHost(ws.id), getPagePublishSettings(article.id)]);
  const canonical = domain ? `https://${domain}/${article.slug}` : `/${locale}/h/${ws.handle}/${article.slug}`;
  const description = seo?.seo_description || article.excerpt || undefined;
  const noindex = !site.indexing || seo?.seo_noindex;
  return {
    title: { absolute: `${article.title || t('untitled')} · ${ws.name}` },
    description,
    alternates: { canonical },
    openGraph: { title: article.title, description, type: 'article', url: canonical, siteName: ws.name, modifiedTime: article.updated_at },
    twitter: { card: 'summary', title: article.title, description },
    ...(noindex ? { robots: { index: false, follow: false } } : {}),
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
  const tEditor = await getTranslations({ locale, namespace: 'docs.editor' });
  const format = await getFormatter({ locale });
  const base = await helpBase(locale, ws.handle);
  const home = base || '/';
  const seo = await getPagePublishSettings(article.id);
  // Sincronizados: getHelpArticle ya trae solo los de origen publicado.
  // Defensa en profundidad: se re-sanitiza al servir una página pública. Los
  // links `[[` van al artículo publicado; a una página sin publicar quedan
  // como texto plano (ni id ni href: no se filtra qué hay en el workspace).
  const blocks = resolveBlocksPageLinks(stripFileUrls(sanitizeBlocks(cleanForReaders(article.content))), (pageId) => {
    const target = article.linkTargets[pageId];
    return target ? { href: `${base}/${target.slug}`, title: target.title || t('untitled'), keepId: false } : null;
  });
  const toc = buildToc(blocks);
  // Relaciones y espejos de dos vías con bases de otras páginas publicadas.
  const dbForeign = await publishedRelatedDatabases(ws.id, article.id, blocks);
  const style = helpAccentStyle(ws.accent) as CSSProperties;

  return (
    <main className="help help-article-page" style={style}>
      <HelpView handle={ws.handle} pageId={article.id} />
      <HelpHeader locale={locale} name={ws.name} base={home} search />
      <script
        type="application/ld+json"
        // Datos estructurados del artículo (JSON escapado: sin </script> posible).
        dangerouslySetInnerHTML={{
          __html: JSON.stringify({
            '@context': 'https://schema.org',
            '@type': 'Article',
            headline: article.title || t('untitled'),
            dateModified: article.updated_at,
            publisher: { '@type': 'Organization', name: ws.name },
            ...(seo?.seo_description || article.excerpt ? { description: seo?.seo_description || article.excerpt } : {}),
          }).replace(/</g, '\\u003c'),
        }}
      />

      <div className="help-wrap">
        <nav className="help-crumbs" aria-label={t('breadcrumb')}>
          <ol>
            <li>
              <a href={home}>{t('title')}</a>
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
              {article.cover_url && <DocsStaticCover pageId={article.id} value={article.cover_url} position={article.cover_position} />}
              {article.icon && (
                <span className="help-article-icon" aria-hidden="true">
                  <DocsPageIcon icon={article.icon} pageId={article.id} size={40} />
                </span>
              )}
              <h1 className="help-article-title">{article.title || t('untitled')}</h1>
              <p className="help-article-meta">
                {t('updated', { date: format.dateTime(parseDbUtc(article.updated_at), { dateStyle: 'medium' }) })}
                {seo?.allow_duplicate && (
                  <a
                    className="btn btn-secondary btn-sm help-duplicate"
                    href={`${appOrigin()}/${locale}/app/docs/duplicate?handle=${encodeURIComponent(ws.handle)}&slug=${encodeURIComponent(article.slug)}`}
                    data-testid="help-duplicate"
                  >
                    {t('duplicate')}
                  </a>
                )}
              </p>
            </header>
            <DocsBlocksView blocks={blocks} pageId={article.id} className="docs-prose help-body" boards={false} syncedNoAccess={tEditor('synced.noAccess')} dbForeign={dbForeign} dbDefaultView />

            {/* Portada de colección: la lista de sus artículos. */}
            {article.children.length > 0 ? (
              <ol className="help-collections help-collections-children" aria-label={t('articlesIn', { title: article.title || t('untitled') })}>
                {article.children.map((c) => (
                  <li key={c.id} className="help-collection">
                    <div className="help-collection-body">
                      <h2 className="help-collection-title">
                        <a href={`${base}/${c.slug}`}>
                          {c.icon && <span aria-hidden="true"><DocsPageIcon icon={c.icon} pageId={c.id} size={16} /> </span>}
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
