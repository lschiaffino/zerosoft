import { NextRequest, NextResponse } from 'next/server';
import { publishedStore, storefrontSitemap } from '@/lib/shop-storefront';
import { isAppHost } from '@/lib/hosts';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

type Ctx = { params: Promise<{ handle: string }> };

/** GET /store/<handle>/sitemap.xml (next.config lo reescribe acá). */
export async function GET(req: NextRequest, { params }: Ctx) {
  // Un dominio propio (Link, Docs) no sirve nada de una tienda.
  if (!isAppHost(req.headers.get('x-forwarded-host') ?? req.headers.get('host'))) return new NextResponse('Not found', { status: 404 });
  const { handle } = await params;
  const store = await publishedStore(handle);
  if (!store) return new NextResponse('Not found', { status: 404 });
  const base = (process.env.NEXTAUTH_URL ?? 'https://zerosoft.ai').replace(/\/$/, '');
  return new NextResponse(await storefrontSitemap(store.row, base), {
    headers: { 'content-type': 'application/xml; charset=utf-8', 'cache-control': 'public, max-age=600' },
  });
}
