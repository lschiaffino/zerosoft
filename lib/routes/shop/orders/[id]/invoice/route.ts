import { NextRequest } from 'next/server';
import { getOrder } from '@/lib/shop-orders';
import { resendInvoice } from '@/lib/shop-ops';
import { shopActor, shopFail, shopJson } from '@/lib/shop-http';
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

type Ctx = { params: Promise<{ id: string }> };


/** POST: reenvía la factura de un pedido pendiente (con los topes de email). */
export async function POST(_req: NextRequest, { params }: Ctx) {
  const a = await shopActor();
  if ('res' in a) return a.res;
  const { id } = await params;
  try {
    await resendInvoice(a.actor, id);
    return shopJson({ order: await getOrder(a.actor.ws, id) });
  } catch (err) {
    return shopFail(err);
  }
}
