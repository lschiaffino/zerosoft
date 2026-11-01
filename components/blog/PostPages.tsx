import { getTranslations } from 'next-intl/server';
import PostGrid from '@/components/blog/PostGrid';
import PostMore from '@/components/blog/PostMore';
import type { PostMeta } from '@/lib/blog';

/** Posts de la primera tanda y de cada "Ver más". */
export const POSTS_PER_PAGE = 12;

/**
 * El índice del blog por tandas. Cada tanda siguiente va en un <details>: sin
 * JavaScript funciona igual, y los links a todos los posts siguen en el HTML
 * para los buscadores. La página no pasa de unos pocos miles de píxeles.
 */
export default async function PostPages({ posts, locale }: { posts: PostMeta[]; locale: string }) {
  const t = await getTranslations({ locale, namespace: 'common.blog' });
  const page = posts.slice(0, POSTS_PER_PAGE);
  const rest = posts.slice(POSTS_PER_PAGE);
  return (
    <>
      <PostGrid posts={page} locale={locale} />
      {rest.length > 0 && (
        <PostMore label={t('more', { count: rest.length })}>
          <PostPages posts={rest} locale={locale} />
        </PostMore>
      )}
    </>
  );
}
