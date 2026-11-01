import { getTranslations, setRequestLocale } from 'next-intl/server';
import { getAllPosts, getTags, TAG_MIN_POSTS } from '@/lib/blog';
import PostGrid from '@/components/blog/PostGrid';
import TagList from '@/components/blog/TagList';
import { staticPageMetadata } from '@/lib/seo-pages';
import { absoluteUrl, breadcrumbLd, graphLd, jsonLdString, localePath } from '@/lib/seo';

export async function generateMetadata(props: { params: Promise<{ locale: string }> }) {
  const { locale } = await props.params;
  const t = await getTranslations({ locale, namespace: 'common.blog' });
  return staticPageMetadata('blog', locale, {
    alternates: {
      types: {
        'application/rss+xml': [{ url: `/${locale}/blog/rss.xml`, title: `zerosoft ${t('label')} (RSS)` }],
        'application/atom+xml': [{ url: `/${locale}/blog/atom.xml`, title: `zerosoft ${t('label')} (Atom)` }],
      },
    },
  });
}

export default async function BlogIndexPage(props: { params: Promise<{ locale: string }> }) {
  const { locale } = await props.params;
  setRequestLocale(locale);
  const t = await getTranslations({ locale, namespace: 'common.blog' });
  const posts = getAllPosts(locale);
  // Solo los temas con más de un post: los demás son páginas finas.
  const tags = getTags(locale).filter((tag) => tag.count >= TAG_MIN_POSTS);

  const ld = graphLd([
    breadcrumbLd(locale, [
      { name: 'zerosoft', path: '' },
      { name: t('label'), path: '/blog' },
    ]),
    {
      '@type': 'Blog',
      name: `zerosoft ${t('label')}`,
      description: t('metaDescription'),
      url: absoluteUrl(localePath(locale, '/blog')),
      inLanguage: locale,
      blogPost: posts.slice(0, 20).map((p) => ({
        '@type': 'BlogPosting',
        headline: p.title,
        url: absoluteUrl(localePath(locale, `/blog/${p.slug}`)),
        datePublished: p.date,
      })),
    },
  ]);

  return (
    <main className="container">
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: jsonLdString(ld) }} />
      <header className="read-hero">
        <h1 className="read-title">
          {t('title')} <span className="dim">{t('titleDim')}</span>
        </h1>
        <p className="blog-feeds">
          <span>{t('feeds')}:</span> <a href={`/${locale}/blog/rss.xml`}>RSS</a> <a href={`/${locale}/blog/atom.xml`}>Atom</a>
        </p>
      </header>

      <div className="read-body">
        {tags.length > 0 && (
          <section className="blog-topics" aria-labelledby="blog-topics">
            <h2 id="blog-topics" className="blog-topics-title">
              {t('tagsTitle')}
            </h2>
            <TagList tags={tags} label={t('tagsTitle')} />
          </section>
        )}
        <PostGrid posts={posts} locale={locale} />
      </div>
    </main>
  );
}
