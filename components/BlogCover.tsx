interface BlogCoverProps {
  slug: string;
  variant?: 'card' | 'hero';
}

/**
 * La tapa de un post (el SVG determinístico de lib/blog-cover.ts), como imagen
 * aparte y no dentro del HTML: cada una pesa unos 150 KB y el índice del blog
 * llegó a 15 MB. Las tarjetas cargan al acercarse; la del post, enseguida. Va
 * decorativa: el título del post está al lado.
 */
export default function BlogCover({ slug, variant = 'card' }: BlogCoverProps) {
  const hero = variant === 'hero';
  return (
    // eslint-disable-next-line @next/next/no-img-element -- SVG generado, sin nada que optimizar.
    <img
      src={`/api/og/cover/${variant}/${slug}`}
      alt=""
      width={hero ? 1200 : 600}
      height={hero ? 400 : 300}
      loading={hero ? 'eager' : 'lazy'}
      decoding="async"
    />
  );
}
