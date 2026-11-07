/* eslint-disable @next/next/no-img-element -- SVG generado por post: no pasa por el optimizador de imágenes. */
import { BLOG_COVER_HEIGHT, BLOG_COVER_WIDTH } from '@/lib/blog-cover';

/**
 * La portada de un post (lib/blog-cover), como imagen aparte y no dentro del
 * HTML: inline, cada tarjeta le suma decenas de KB al índice. Las tarjetas
 * cargan al acercarse; la del post, enseguida. Va decorativa: el título está al lado.
 */
export default function BlogCover({ slug, variant = 'card' }: { slug: string; variant?: 'card' | 'hero' }) {
  return (
    <img
      src={`/api/og/cover/${encodeURIComponent(slug)}`}
      alt=""
      width={BLOG_COVER_WIDTH}
      height={BLOG_COVER_HEIGHT}
      loading={variant === 'hero' ? 'eager' : 'lazy'}
      decoding="async"
    />
  );
}
