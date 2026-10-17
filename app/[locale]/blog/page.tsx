import { getTranslations, setRequestLocale } from 'next-intl/server';
import { Link } from '@/i18n/navigation';
import { getAllPosts } from '@/lib/blog';
import { formatDate } from '@/lib/utils';
import BlogCover from '@/components/BlogCover';
import EmptyState from '@/components/ui/EmptyState';

export async function generateMetadata(props: { params: Promise<{ locale: string }> }) {
  const params = await props.params;

  const {
    locale
  } = params;

  const t = await getTranslations({ locale, namespace: 'common.blog' });
  return { title: t('title') };
}

export default async function BlogIndexPage(props: { params: Promise<{ locale: string }> }) {
  const params = await props.params;

  const {
    locale
  } = params;

  setRequestLocale(locale);
  const t = await getTranslations({ locale, namespace: 'common.blog' });
  const posts = getAllPosts(locale);

  return (
    <main className="container">
      <header className="read-hero">
        <h1 className="read-title">
          {t('title')} <span className="dim">{t('titleDim')}</span>
        </h1>
      </header>

      <div className="read-body">
      {posts.length === 0 ? (
        <EmptyState title={t('empty')} quiet />
      ) : (
        <div className="blog-index-grid">
          {posts.map((post) => (
            <Link key={post.slug} href={`/blog/${post.slug}`} className="blog-card">
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
          ))}
        </div>
      )}
      </div>
    </main>
  );
}
