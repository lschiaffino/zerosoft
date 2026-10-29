import { NextRequest } from 'next/server';
import { cancelOrder } from '@/lib/shop-orders';
import { readJson, shopActor, shopFail, shopJson } from '@/lib/shop-http';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

type Ctx = { params: Promise<{ id: string }> };

/** POST { restock? }: cancela un pedido pendiente o pagado (sin envío). Libera la reserva o repone el stock. */
export async function POST(req: NextRequest, { params }: Ctx) {
  const a = await shopActor();
  if ('res' in a) return a.res;
  const body = ((await readJson(req)) ?? {}) as Record<string, unknown>;
  try {
    return shopJson({ order: await cancelOrder(a.actor, (await params).id, { restock: body.restock !== false }) });
  } catch (err) {
    return shopFail(err);
  }
}
