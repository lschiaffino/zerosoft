import { getTranslations, setRequestLocale } from 'next-intl/server';
import { notFound, redirect } from 'next/navigation';
import type { Metadata } from 'next';
import { Link } from '@/i18n/navigation';
import PostGrid from '@/components/blog/PostGrid';
import TagList from '@/components/blog/TagList';
import { BLOG_LOCALES, TAG_MIN_POSTS, getPostsByTag, getTags, tagLocales } from '@/lib/blog';
import { breadcrumbLd, graphLd, jsonLdString, pageMetadata } from '@/lib/seo';

type Params = { locale: string; tag: string };

// Solo los de generateStaticParams: otro valor es un 404 sin caché (con dynamicParams el CDN
// guardaba cada 404 inventado por un año).
export const dynamicParams = false;

export function generateStaticParams() {
  const slugs = new Set<string>();
  for (const l of BLOG_LOCALES) for (const tag of getTags(l)) slugs.add(tag.slug);
  return [...slugs].map((tag) => ({ tag }));
}

function tagInfo(locale: string, slug: string) {
  return getTags(locale).find((t) => t.slug === slug) ?? null;
}

export async function generateMetadata(props: { params: Promise<Params> }): Promise<Metadata> {
  const { locale, tag } = await props.params;
  const info = tagInfo(locale, tag);
  if (!info) return {};
  const t = await getTranslations({ locale, namespace: 'common.blog' });
  const indexable = info.count >= TAG_MIN_POSTS;
  return pageMetadata({
    locale,
    path: `/blog/tag/${tag}`,
    title: t('tagTitle', { tag: info.label }),
    description: t('tagMetaDescription', { tag: info.label, count: info.count }),
    image: `/api/og/page/${locale}/blog`,
    // Un tag con un solo post es una página fina: se sigue el link, no se indexa.
    noindex: !indexable,
    locales: indexable ? tagLocales(tag) : [locale],
  });
}

export default async function BlogTagPage(props: { params: Promise<Params> }) {
  const { locale, tag } = await props.params;
  setRequestLocale(locale);
  const info = tagInfo(locale, tag);
  if (!info) {
    // Los tags se escriben en cada idioma: el selector de idioma puede pedir uno que acá no existe.
    if (tagLocales(tag, 1).length > 0) redirect(`/${locale}/blog`);
    notFound();
  }
  const t = await getTranslations({ locale, namespace: 'common.blog' });
  const posts = getPostsByTag(locale, tag);
  const others = getTags(locale).filter((x) => x.count >= TAG_MIN_POSTS && x.slug !== tag);
  const title = t('tagTitle', { tag: info.label });

  const ld = graphLd([
    breadcrumbLd(locale, [
      { name: 'zerosoft', path: '' },
      { name: t('label'), path: '/blog' },
      { name: title, path: `/blog/tag/${tag}` },
    ]),
  ]);

  return (
    <main className="container">
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: jsonLdString(ld) }} />
      <header className="read-hero">
        <nav className="blog-crumbs" aria-label={t('crumbs')}>
          <Link href="/blog">{t('label')}</Link>
          <span aria-hidden="true">/</span>
          <span aria-current="page">{info.label}</span>
        </nav>
        <h1 className="read-title">{title}</h1>
        <p className="read-meta">{t('tagLead', { count: posts.length })}</p>
      </header>
      <div className="read-body">
        <PostGrid posts={posts} locale={locale} />
        {others.length > 0 && (
          <section className="blog-topics blog-topics-end" aria-labelledby="blog-topics">
            <h2 id="blog-topics" className="blog-topics-title">
              {t('tagsTitle')}
            </h2>
            <TagList tags={others} label={t('tagsTitle')} />
          </section>
        )}
      </div>
    </main>
  );
}
