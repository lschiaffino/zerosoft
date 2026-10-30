import { NextRequest } from 'next/server';
import { markPaidManually } from '@/lib/shop-orders';
import { shopActor, shopFail, shopJson } from '@/lib/shop-http';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

type Ctx = { params: Promise<{ id: string }> };

/** POST: marca pagado un pedido pendiente (transferencia recibida). Descuenta el stock. */
export async function POST(_req: NextRequest, { params }: Ctx) {
  const a = await shopActor();
  if ('res' in a) return a.res;
  try {
    return shopJson({ order: await markPaidManually(a.actor, (await params).id) });
  } catch (err) {
    return shopFail(err);
  }
}
