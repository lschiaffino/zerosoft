import { NextRequest } from 'next/server';
import { listOrders } from '@/lib/shop-orders';
import { shopActor, shopJson } from '@/lib/shop-http';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** GET /api/shop/orders?q=&status=&customer=: pedidos (número, email, estado, total). */
export async function GET(req: NextRequest) {
  const a = await shopActor();
  if ('res' in a) return a.res;
  const sp = req.nextUrl.searchParams;
  return shopJson(
    await listOrders(a.actor.ws, {
      q: sp.get('q') ?? undefined,
      status: sp.get('status') ?? undefined,
      customerId: sp.get('customer') ?? undefined,
      limit: Number(sp.get('limit') ?? 100) || 100,
      offset: Number(sp.get('offset') ?? 0) || 0,
    }),
  );
}
