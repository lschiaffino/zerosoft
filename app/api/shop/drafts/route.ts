import { NextRequest } from 'next/server';
import { createDraftOrder } from '@/lib/shop-ops';
import { readJson, shopActor, shopFail, shopJson } from '@/lib/shop-http';
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** POST: crea un pedido en borrador desde la app. */
export async function POST(req: NextRequest) {
  const a = await shopActor();
  if ('res' in a) return a.res;
  try {
    return shopJson({ order: await createDraftOrder(a.actor, await readJson(req)) }, 201);
  } catch (err) {
    return shopFail(err);
  }
}
