import { getTranslations, setRequestLocale } from 'next-intl/server';
import { Link } from '@/i18n/navigation';
import { getAllPosts } from '@/lib/blog';
import { formatDate } from '@/lib/utils';
import Reveal from '@/components/Reveal';
import BlogCover from '@/components/BlogCover';

export async function generateMetadata({ params: { locale } }: { params: { locale: string } }) {
  const t = await getTranslations({ locale, namespace: 'common.blog' });
  return { title: t('title') };
}

export default async function BlogIndexPage({ params: { locale } }: { params: { locale: string } }) {
  setRequestLocale(locale);
  const t = await getTranslations({ locale, namespace: 'common.blog' });
  const posts = getAllPosts(locale);

  return (
    <main className="container" style={{ paddingTop: 100, paddingBottom: 140 }}>
      <p className="section-label">{t('label')}</p>
      <h1 className="section-title">
        {t('title')}
        <br />
        <span className="dim">{t('titleDim')}</span>
      </h1>

      {posts.length === 0 ? (
        <p className="mono muted">{t('empty')}</p>
      ) : (
        <div className="blog-index-grid">
          {posts.map((post) => (
            <Reveal key={post.slug}>
              <Link href={`/blog/${post.slug}`} className="blog-card">
                <div className="blog-card-cover" aria-hidden="true">
                  <BlogCover slug={post.slug} title={post.title} variant="card" />
                </div>
                <div className="blog-card-body">
                  <p className="blog-card-meta">
                    {formatDate(post.date, locale)} · {post.readingTime} {t('readingTime')}
                  </p>
                  <h2 className="blog-card-title">{post.title}</h2>
                  <p className="blog-card-desc">{post.description}</p>
                </div>
              </Link>
            </Reveal>
          ))}
        </div>
      )}
    </main>
  );
}
