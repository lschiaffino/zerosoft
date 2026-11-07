import { NextRequest } from 'next/server';
import { cancelPurchaseOrder, receivePurchaseOrder } from '@/lib/shop-ops';
import { readJson, shopActor, shopFail, shopJson } from '@/lib/shop-http';
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

type Ctx = { params: Promise<{ id: string }> };


/** POST { lines: [{ itemId, quantity }] }: recibe mercadería. DELETE: cancela lo que falta. */
export async function POST(req: NextRequest, { params }: Ctx) {
  const a = await shopActor();
  if ('res' in a) return a.res;
  const body = ((await readJson(req)) ?? {}) as { lines?: Array<{ itemId: string; quantity: number }> };
  try {
    return shopJson({ purchaseOrder: await receivePurchaseOrder(a.actor, (await params).id, Array.isArray(body.lines) ? body.lines : []) });
  } catch (err) {
    return shopFail(err);
  }
}

export async function DELETE(_req: NextRequest, { params }: Ctx) {
  const a = await shopActor();
  if ('res' in a) return a.res;
  try {
    await cancelPurchaseOrder(a.actor, (await params).id);
    return shopJson({ ok: true });
  } catch (err) {
    return shopFail(err);
  }
}
