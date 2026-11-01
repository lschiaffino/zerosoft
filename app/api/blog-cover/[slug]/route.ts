import { NextResponse } from 'next/server';
import { getAllPosts, getPost } from '@/lib/blog';
import { blogCoverSVG } from '@/lib/blog-cover';
import { PRODUCT_CONFIG, PRODUCT_KEYS, type ProductKey } from '@/lib/products';

export const dynamic = 'force-static';
export const dynamicParams = false;

export function generateStaticParams() {
  return getAllPosts('en').map((post) => ({ slug: post.slug }));
}

export async function GET(_request: Request, props: { params: Promise<{ slug: string }> }) {
  const { slug } = await props.params;
  const post = getPost('en', slug);
  if (!post) return new NextResponse('Not found', { status: 404 });
  const product = post.tags.find((tag) => (PRODUCT_KEYS as string[]).includes(tag.toLowerCase()));
  const color = product ? PRODUCT_CONFIG[product.toLowerCase() as ProductKey].color : null;
  return new NextResponse(blogCoverSVG(slug, color), {
    headers: {
      'Content-Type': 'image/svg+xml; charset=utf-8',
      'Cache-Control': 'public, max-age=86400, s-maxage=604800',
    },
  });
}
