import { getTranslations, setRequestLocale } from 'next-intl/server';
import { notFound } from 'next/navigation';
import type { Metadata } from 'next';
import { Link } from '@/i18n/navigation';
import PostGrid from '@/components/blog/PostGrid';
import { AUTHORS, getPostsByAuthor } from '@/lib/blog';
import { GITHUB_URL } from '@/components/site/catalog';
import { absoluteUrl, breadcrumbLd, graphLd, jsonLdString, localePath, pageMetadata, siteOrigin } from '@/lib/seo';

type Params = { locale: string; author: string };

export function generateStaticParams() {
  return Object.values(AUTHORS).map((a) => ({ author: a.slug }));
}

export const dynamicParams = false;

export async function generateMetadata(props: { params: Promise<Params> }): Promise<Metadata> {
  const { locale, author } = await props.params;
  const a = AUTHORS[author];
  if (!a) return {};
  const t = await getTranslations({ locale, namespace: 'common.blog' });
  const count = getPostsByAuthor(locale, a.slug).length;
  return pageMetadata({
    locale,
    path: `/blog/author/${a.slug}`,
    title: t('authorTitle', { name: a.name }),
    description: t('authorMetaDescription', { name: a.name, count }),
    image: `/api/og/page/${locale}/blog`,
  });
}

export default async function BlogAuthorPage(props: { params: Promise<Params> }) {
  const { locale, author } = await props.params;
  setRequestLocale(locale);
  const a = AUTHORS[author];
  if (!a) notFound();
  const t = await getTranslations({ locale, namespace: 'common.blog' });
  const posts = getPostsByAuthor(locale, a.slug);
  const title = t('authorTitle', { name: a.name });

  const ld = graphLd([
    {
      '@type': 'ProfilePage',
      url: absoluteUrl(localePath(locale, `/blog/author/${a.slug}`)),
      mainEntity: { '@type': 'Organization', '@id': `${siteOrigin()}/#organization`, name: a.name, url: siteOrigin(), sameAs: [GITHUB_URL] },
    },
    breadcrumbLd(locale, [
      { name: 'zerosoft', path: '' },
      { name: t('label'), path: '/blog' },
      { name: title, path: `/blog/author/${a.slug}` },
    ]),
  ]);

  return (
    <main className="container">
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: jsonLdString(ld) }} />
      <header className="read-hero">
        <nav className="blog-crumbs" aria-label={t('crumbs')}>
          <Link href="/blog">{t('label')}</Link>
        </nav>
        <h1 className="read-title">{title}</h1>
        <p className="read-intro">{t('authorLead', { count: posts.length })}</p>
      </header>
      <div className="read-body">
        <PostGrid posts={posts} locale={locale} />
      </div>
    </main>
  );
}
