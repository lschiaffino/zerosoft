import { NextRequest, NextResponse } from 'next/server';
import { publishedStore, storefrontSitemap } from '@/lib/shop-storefront';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

type Ctx = { params: Promise<{ handle: string }> };

/** GET /store/<handle>/sitemap.xml (next.config lo reescribe acá). */
export async function GET(_req: NextRequest, { params }: Ctx) {
  const { handle } = await params;
  const store = await publishedStore(handle);
  if (!store) return new NextResponse('Not found', { status: 404 });
  const base = (process.env.NEXTAUTH_URL ?? 'https://zerosoft.ai').replace(/\/$/, '');
  return new NextResponse(await storefrontSitemap(store.row, base), {
    headers: { 'content-type': 'application/xml; charset=utf-8', 'cache-control': 'public, max-age=600' },
  });
}
