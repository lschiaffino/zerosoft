import { NextRequest } from 'next/server';
import { publishedStore, storefrontProducts } from '@/lib/shop-storefront';
import { shopJson, shopLimit } from '@/lib/shop-http';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

type Ctx = { params: Promise<{ handle: string }> };

/** GET /api/shop/public/<handle>/search?q=: productos activos por nombre, etiqueta, tipo o marca. */
export async function GET(req: NextRequest, { params }: Ctx) {
  const { handle } = await params;
  const limited = await shopLimit(req, 'search', 60, 60, handle);
  if (limited) return limited;
  const store = await publishedStore(handle);
  if (!store) return shopJson({ error: 'not_found' }, 404);
  const q = (req.nextUrl.searchParams.get('q') ?? '').trim().slice(0, 100);
  if (!q) return shopJson({ products: [] });
  return shopJson({ products: await storefrontProducts(store.row.workspace_id, { q, limit: 48 }) });
}
