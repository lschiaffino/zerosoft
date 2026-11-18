import { NextRequest } from 'next/server';
import { updateCustomer, getCustomer } from '@/lib/shop';
import { listOrders } from '@/lib/shop-orders';
import { readJson, shopFail, shopActor, shopJson } from '@/lib/shop-http';

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

/** PATCH { tags, note }: etiquetas y nota interna del cliente. */
export async function PATCH(req: NextRequest, { params }: Ctx) {
  const a = await shopActor();
  if ('res' in a) return a.res;
  try {
    const customer = await updateCustomer(a.actor, (await params).id, await readJson(req));
    return shopJson({ customer });
  } catch (err) {
    return shopFail(err);
  }
}
