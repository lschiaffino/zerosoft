import { NextRequest } from 'next/server';
import { getOrder } from '@/lib/shop-orders';
import { shopActor, shopJson } from '@/lib/shop-http';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

type Ctx = { params: Promise<{ id: string }> };

/** GET /api/shop/orders/<id>: el pedido con ítems, dirección y línea de tiempo. */
export async function GET(_req: NextRequest, { params }: Ctx) {
  const a = await shopActor();
  if ('res' in a) return a.res;
  const order = await getOrder(a.actor.ws, (await params).id);
  return order ? shopJson({ order }) : shopJson({ error: 'not_found' }, 404);
}
