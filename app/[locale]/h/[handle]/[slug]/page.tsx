import type { Metadata } from 'next';
import type { CSSProperties } from 'react';
import { notFound } from 'next/navigation';
import { getFormatter, getTranslations, setRequestLocale } from 'next-intl/server';
import { getHelpArticle, getHelpWorkspace } from '@/lib/docs-help';
import { sanitizeBlocks } from '@/lib/docs-sanitize';
import { buildToc } from '@/lib/docs-toc';
import DocsBlocksView from '@/components/docs/DocsBlocksView';
import HelpFeedback from '@/components/docs/HelpFeedback';
import '@/styles/help.css';

export const dynamic = 'force-dynamic';

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
  const style = (ws.accent ? { '--help-accent': ws.accent } : {}) as CSSProperties;

  return (
    <main className="help help-article-page" style={style}>
      <header className="help-head">
        <a href={base} className="help-brand">
          {ws.name}
        </a>
        <form action={base} method="get" className="help-search help-search-small" role="search">
          <input type="search" name="q" placeholder={t('searchPlaceholder')} aria-label={t('searchPlaceholder')} className="help-search-input" />
        </form>
      </header>

      <nav className="help-crumbs" aria-label={t('breadcrumb')}>
        <a href={base}>{t('title')}</a>
        {article.collection && (
          <>
            <span aria-hidden>/</span>
            <a href={`${base}/${article.collection.slug}`}>{article.collection.title || t('untitled')}</a>
          </>
        )}
      </nav>

      <div className={`help-article-grid${toc.length > 1 ? ' has-toc' : ''}`}>
        <article className="help-article">
          <h1 className="help-article-title">
            {article.icon && <span className="help-icon" aria-hidden>{article.icon}</span>}
            {article.title || t('untitled')}
          </h1>
          <p className="help-article-meta">
            {t('updated', { date: format.dateTime(new Date(article.updated_at), { dateStyle: 'medium' }) })}
          </p>
          <DocsBlocksView blocks={blocks} className="help-body" />

          <HelpFeedback pageId={article.id} />

          {(article.prev || article.next) && (
            <nav className="help-pager" aria-label={t('pager')}>
              {article.prev ? (
                <a href={`${base}/${article.prev.slug}`} className="help-pager-link">
                  <span className="help-pager-dir">{t('prev')}</span>
                  <span className="help-pager-title">{article.prev.title || t('untitled')}</span>
                </a>
              ) : (
                <span />
              )}
              {article.next && (
                <a href={`${base}/${article.next.slug}`} className="help-pager-link help-pager-next">
                  <span className="help-pager-dir">{t('next')}</span>
                  <span className="help-pager-title">{article.next.title || t('untitled')}</span>
                </a>
              )}
            </nav>
          )}
        </article>

        {toc.length > 1 && (
          <aside className="help-toc" aria-label={t('toc')}>
            <p className="help-toc-label">{t('toc')}</p>
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
    </main>
  );
}
