import { getTranslations, setRequestLocale } from 'next-intl/server';
import { notFound } from 'next/navigation';
import { Link } from '@/i18n/navigation';
import { getPost, getAllSlugs } from '@/lib/blog';
import { formatDate } from '@/lib/utils';
import ZeroField from '@/components/ZeroField';

export async function generateMetadata({
  params: { locale, slug },
}: {
  params: { locale: string; slug: string };
}) {
  const post = getPost(locale, slug);
  if (!post) return {};
  return { title: post.title, description: post.description };
}

export function generateStaticParams() {
  return getAllSlugs().map((slug) => ({ slug }));
}

export default async function BlogPostPage({
  params: { locale, slug },
}: {
  params: { locale: string; slug: string };
}) {
  setRequestLocale(locale);
  const post = getPost(locale, slug);
  if (!post) notFound();

  const t = await getTranslations({ locale, namespace: 'common.blog' });

  return (
    <main className="container" style={{ paddingTop: 100, paddingBottom: 140 }}>
      <article>
        <div className="blog-post-cover" aria-hidden="true">
          <ZeroField
            align="center"
            sizeFactor={0.85}
            color="255,255,255"
            interactive={false}
            alpha={0.22}
          />
        </div>
        <header className="blog-post-header">
          <p className="blog-post-meta">
            <Link href="/blog" style={{ textDecoration: 'underline', textUnderlineOffset: 3 }}>
              {t('back')}
            </Link>
          </p>
          <h1 className="blog-post-title">{post.title}</h1>
          <p className="blog-post-meta">
            {formatDate(post.date, locale)} · {post.author} · {post.readingTime} {t('readingTime')}
          </p>
        </header>
        <div className="prose" dangerouslySetInnerHTML={{ __html: post.html }} />
      </article>
    </main>
  );
}
