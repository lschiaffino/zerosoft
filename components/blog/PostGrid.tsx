import { getTranslations } from 'next-intl/server';
import { Link } from '@/i18n/navigation';
import BlogCover from '@/components/BlogCover';
import EmptyState from '@/components/ui/EmptyState';
import type { PostMeta } from '@/lib/blog';

function formatDay(day: string, locale: string): string {
  return new Intl.DateTimeFormat(locale, { dateStyle: 'medium', timeZone: 'UTC' }).format(new Date(`${day}T00:00:00Z`));
}

/** La grilla de tarjetas del blog (índice, tags, autor). La fecha va en UTC: es un día, sin hora. */
export default async function PostGrid({ posts, locale, headingLevel = 'h2' }: { posts: PostMeta[]; locale: string; headingLevel?: 'h2' | 'h3' }) {
  const t = await getTranslations({ locale, namespace: 'common.blog' });
  if (posts.length === 0) return <EmptyState title={t('empty')} quiet />;
  const Heading = headingLevel;
  return (
    <ul className="blog-index-grid">
      {posts.map((post) => (
        <li key={post.slug}>
          <Link href={`/blog/${post.slug}`} className="blog-card">
            <div className="blog-card-cover" aria-hidden="true">
              <BlogCover slug={post.slug} title={post.title} variant="card" />
            </div>
            <div className="blog-card-body">
              <p className="blog-card-meta">
                <time dateTime={post.date}>{formatDay(post.date, locale)}</time> · {post.readingTime} {t('readingTime')}
              </p>
              <Heading className="blog-card-title">{post.title}</Heading>
              <p className="blog-card-desc">{post.description}</p>
            </div>
          </Link>
        </li>
      ))}
    </ul>
  );
}
