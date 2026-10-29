import { NextRequest } from 'next/server';
import { inventoryHistory } from '@/lib/shop';
import { shopActor, shopJson } from '@/lib/shop-http';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** GET /api/shop/inventory/history?variant=: movimientos de stock (ajustes, ventas, reposiciones, import). */
export async function GET(req: NextRequest) {
  const a = await shopActor();
  if ('res' in a) return a.res;
  return shopJson({ entries: await inventoryHistory(a.actor.ws, { variantId: req.nextUrl.searchParams.get('variant') ?? undefined, limit: 200 }) });
}
