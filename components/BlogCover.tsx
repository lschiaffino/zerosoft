import { generateBlogCoverSVG } from '@/lib/blog-cover';

interface BlogCoverProps {
  slug: string;
  title: string;
  variant?: 'card' | 'hero';
  className?: string;
}

/**
 * BlogCover — a deterministic, zero-only SVG illustration for each post.
 * Server-safe, no client hooks, no canvas. Monochrome palette only.
 */
export default function BlogCover({ slug, title, variant = 'card', className = '' }: BlogCoverProps) {
  const svg = generateBlogCoverSVG(slug, title, variant);
  return (
    <div
      className={className}
      aria-hidden="true"
      dangerouslySetInnerHTML={{ __html: svg }}
      style={{ width: '100%', height: '100%', display: 'block' }}
    />
  );
}
