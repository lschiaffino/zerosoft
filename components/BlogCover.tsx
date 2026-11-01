/* eslint-disable @next/next/no-img-element -- SVG generado por post: no pasa por el optimizador de imágenes. */
import { BLOG_COVER_HEIGHT, BLOG_COVER_WIDTH } from '@/lib/blog-cover';

/**
 * Portada de un post (ver lib/blog-cover). Va como archivo aparte, cacheado:
 * inline, cada tarjeta le sumaría decenas de KB al HTML del índice.
 */
export default function BlogCover({ slug, variant = 'card' }: { slug: string; title?: string; variant?: 'card' | 'hero' }) {
  return (
    <img
      src={`/api/blog-cover/${encodeURIComponent(slug)}`}
      alt=""
      width={BLOG_COVER_WIDTH}
      height={BLOG_COVER_HEIGHT}
      loading={variant === 'hero' ? 'eager' : 'lazy'}
      decoding="async"
    />
  );
}
