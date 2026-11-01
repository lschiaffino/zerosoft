import { getTranslations, setRequestLocale } from 'next-intl/server';
import { notFound } from 'next/navigation';
import type { Metadata } from 'next';
import { Link } from '@/i18n/navigation';
import BlogCover from '@/components/BlogCover';
import Icon from '@/components/site/Icon';
import PostGrid from '@/components/blog/PostGrid';
import TagList from '@/components/blog/TagList';
import { AUTHORS, getAllSlugs, getPost, hasPostIn, postLocales, productOfPost, relatedPosts, tagSlug } from '@/lib/blog';
import { comparisonFor } from '@/lib/compare';
import { PRODUCT_CONFIG } from '@/lib/products';
import { articleLd, breadcrumbLd, graphLd, jsonLdString, pageMetadata } from '@/lib/seo';

type Params = { locale: string; slug: string };

/** El idioma en que está escrito lo que se muestra (si no existe en el pedido, cae al inglés). */
function writtenLocale(locale: string, slug: string): string {
  if (hasPostIn(locale, slug)) return locale;
  return postLocales(slug)[0] ?? locale;
}

function ogImage(locale: string, slug: string): string {
  return `/api/og/blog/${locale}/${slug}`;
}

export async function generateMetadata(props: { params: Promise<Params> }): Promise<Metadata> {
  const { locale, slug } = await props.params;
  const post = getPost(locale, slug);
  if (!post) return {};
  const written = writtenLocale(locale, slug);
  return pageMetadata({
    // Una caída al inglés apunta su canonical al post original: no compite con él.
    locale: written,
    path: `/blog/${slug}`,
    title: post.title,
    description: post.description,
    image: ogImage(written, slug),
    type: 'article',
    publishedTime: post.date,
    modifiedTime: post.updated,
    tags: post.tags,
    locales: postLocales(slug),
  });
}

export function generateStaticParams() {
  return getAllSlugs().map((slug) => ({ slug }));
}

function formatDay(day: string, locale: string): string {
  return new Intl.DateTimeFormat(locale, { dateStyle: 'long', timeZone: 'UTC' }).format(new Date(`${day}T00:00:00Z`));
}

export default async function BlogPostPage(props: { params: Promise<Params> }) {
  const { locale, slug } = await props.params;
  setRequestLocale(locale);
  const post = getPost(locale, slug);
  if (!post) notFound();

  const t = await getTranslations({ locale, namespace: 'common.blog' });
  const written = writtenLocale(locale, slug);
  const author = AUTHORS[post.author] ?? { slug: post.author, name: post.author };
  const product = productOfPost(post);
  const comparison = product ? comparisonFor(product) : null;
  const related = relatedPosts(written, slug, 3);
  const tags = post.tags.map((label) => ({ slug: tagSlug(label), label, count: 0 })).filter((x) => x.slug);

  const ld = graphLd([
    articleLd({
      locale: written,
      path: `/blog/${slug}`,
      title: post.title,
      description: post.description,
      published: post.date,
      modified: post.updated,
      image: ogImage(written, slug),
      tags: post.tags,
      wordCount: post.wordCount,
      author: { name: author.name, path: `/blog/author/${author.slug}` },
    }),
    breadcrumbLd(written, [
      { name: 'zerosoft', path: '' },
      { name: t('label'), path: '/blog' },
      { name: post.title, path: `/blog/${slug}` },
    ]),
  ]);

  return (
    <main className="container read-body">
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: jsonLdString(ld) }} />
      <article className="blog-post" lang={written}>
        <header className="read-hero">
          <nav className="blog-crumbs" aria-label={t('crumbs')}>
            <Link href="/blog">{t('label')}</Link>
            {tags[0] && (
              <>
                <span aria-hidden="true">/</span>
                <Link href={`/blog/tag/${tags[0].slug}`}>{tags[0].label}</Link>
              </>
            )}
          </nav>
          <h1 className="blog-post-title">{post.title}</h1>
          <p className="blog-post-meta">
            <time dateTime={post.date}>{formatDay(post.date, locale)}</time>
            {' · '}
            <Link href={`/blog/author/${author.slug}`} rel="author">
              {author.name}
            </Link>
            {' · '}
            {post.readingTime} {t('readingTime')}
            {post.updated !== post.date && (
              <>
                {' · '}
                <time dateTime={post.updated}>{t('updated', { date: formatDay(post.updated, locale) })}</time>
              </>
            )}
          </p>
        </header>
        <div className="blog-post-cover" aria-hidden="true">
          <BlogCover slug={post.slug} title={post.title} variant="hero" />
        </div>
        <div className="prose" dangerouslySetInnerHTML={{ __html: post.html }} />

        <footer className="blog-post-foot">
          {tags.length > 0 && <TagList tags={tags} label={t('tagsLabel')} counts={false} />}
          {product && (
            <aside className="blog-product" aria-label={PRODUCT_CONFIG[product].name}>
              <p>{t('productLead', { name: PRODUCT_CONFIG[product].name })}</p>
              <div className="blog-product-links">
                <Link href={`/products/${product}`} className="blog-link">
                  {t('productCta', { name: PRODUCT_CONFIG[product].name })} <Icon name="arrow" size={14} />
                </Link>
                {comparison && (
                  <Link href={`/compare/${comparison.vsSlug}`} className="blog-link">
                    {t('compareCta', { name: comparison.name, competitor: comparison.competitor })} <Icon name="arrow" size={14} />
                  </Link>
                )}
              </div>
            </aside>
          )}
        </footer>
      </article>

      {related.length > 0 && (
        <section className="blog-related" aria-labelledby="blog-related">
          <h2 id="blog-related" className="blog-related-title">
            {t('relatedTitle')}
          </h2>
          <PostGrid posts={related} locale={locale} headingLevel="h3" />
        </section>
      )}

      <p className="blog-back-row">
        <Link href="/blog" className="blog-back">
          {t('back')}
        </Link>
      </p>
    </main>
  );
}
