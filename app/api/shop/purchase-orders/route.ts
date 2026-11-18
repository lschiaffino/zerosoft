import { NextRequest } from 'next/server';
import { createPurchaseOrder, listPurchaseOrders } from '@/lib/shop-ops';
import { readJson, shopActor, shopFail, shopJson } from '@/lib/shop-http';
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET() {
  const a = await shopActor();
  if ('res' in a) return a.res;
  return shopJson({ purchaseOrders: await listPurchaseOrders(a.actor.ws) });
}

export async function POST(req: NextRequest) {
  const a = await shopActor();
  if ('res' in a) return a.res;
  try {
    return shopJson({ purchaseOrder: await createPurchaseOrder(a.actor, await readJson(req)) }, 201);
  } catch (err) {
    return shopFail(err);
  }
}
