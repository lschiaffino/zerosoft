import { NextResponse } from 'next/server';
import { getPost } from '@/lib/blog';
import { generateBlogCoverSVG } from '@/lib/blog-cover';

export const dynamic = 'force-static';

export async function GET(_request: Request, props: { params: Promise<{ slug: string }> }) {
  const params = await props.params;
  const { slug } = params;
  const post = getPost('en', slug);
  const title = post?.title ?? slug;

  const svg = generateBlogCoverSVG(slug, title, 'hero');

  return new NextResponse(svg, {
    headers: {
      'Content-Type': 'image/svg+xml; charset=utf-8',
      'Cache-Control': 'public, max-age=86400, immutable',
    },
  });
}

export function generateStaticParams() {
  // Next.js needs at least one param for static generation at build time.
  // Real slugs are generated from the blog pages; this placeholder is pruned
  // by `dynamicParams = true` (the default) and replaced by actual requests.
  return [{ slug: 'placeholder' }];
}
