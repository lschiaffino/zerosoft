import { NextRequest } from 'next/server';
import { getCustomer } from '@/lib/shop';
import { listOrders } from '@/lib/shop-orders';
import { shopActor, shopJson } from '@/lib/shop-http';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

type Ctx = { params: Promise<{ id: string }> };

export async function GET(_req: NextRequest, { params }: Ctx) {
  const a = await shopActor();
  if ('res' in a) return a.res;
  const customer = await getCustomer(a.actor.ws, (await params).id);
  if (!customer) return shopJson({ error: 'not_found' }, 404);
  const orders = await listOrders(a.actor.ws, { customerId: customer.id, limit: 100 });
  return shopJson({ customer, orders: orders.items });
}
