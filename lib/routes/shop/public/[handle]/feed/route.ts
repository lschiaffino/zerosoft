import { NextRequest } from 'next/server';
import { NextResponse } from 'next/server';
import { productFeed } from '@/lib/shop-pages';
import { publishedStore } from '@/lib/shop-storefront';
import { publicOrigin, shopJson, shopLimit } from '@/lib/shop-http';
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

type Ctx = { params: Promise<{ handle: string }> };


/** GET: feed de productos para Google Merchant Center y el catálogo de Meta (por URL programada). */
export async function GET(req: NextRequest, { params }: Ctx) {
  const { handle } = await params;
  const limited = await shopLimit(req, 'feed', 30, 600, handle);
  if (limited) return limited;
  const store = await publishedStore(handle);
  if (!store) return shopJson({ error: 'not_found' }, 404);
  return new NextResponse(await productFeed(store.row, publicOrigin(req)), { headers: { 'content-type': 'application/xml; charset=utf-8', 'cache-control': 'public, max-age=900' } });
}
