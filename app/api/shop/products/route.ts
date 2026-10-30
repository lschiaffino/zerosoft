import { NextRequest } from 'next/server';
import { createProduct, listProducts } from '@/lib/shop';
import { readJson, shopActor, shopFail, shopJson } from '@/lib/shop-http';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** GET /api/shop/products?q=&status=&collection=: lista con precio, variantes y stock. */
export async function GET(req: NextRequest) {
  const a = await shopActor();
  if ('res' in a) return a.res;
  const sp = req.nextUrl.searchParams;
  const res = await listProducts(a.actor.ws, {
    q: sp.get('q') ?? undefined,
    status: sp.get('status') ?? undefined,
    collectionId: sp.get('collection') ?? undefined,
    limit: Number(sp.get('limit') ?? 100) || 100,
    offset: Number(sp.get('offset') ?? 0) || 0,
  });
  return shopJson(res);
}

/** POST /api/shop/products: crea un producto con sus variantes (y stock inicial). */
export async function POST(req: NextRequest) {
  const a = await shopActor();
  if ('res' in a) return a.res;
  try {
    const product = await createProduct(a.actor, await readJson(req));
    return shopJson({ product }, 201);
  } catch (err) {
    return shopFail(err);
  }
}
