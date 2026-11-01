import { NextRequest } from 'next/server';
import { createReturn, orderReturns } from '@/lib/shop-ops';
import { readJson, shopActor, shopFail, shopJson } from '@/lib/shop-http';
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

type Ctx = { params: Promise<{ id: string }> };


export async function GET(_req: NextRequest, { params }: Ctx) {
  const a = await shopActor();
  if ('res' in a) return a.res;
  return shopJson({ returns: await orderReturns(a.actor.ws, (await params).id) });
}

/** POST { items: [{ itemId, quantity }], reason, note }: abre una devolución de lo ya enviado. */
export async function POST(req: NextRequest, { params }: Ctx) {
  const a = await shopActor();
  if ('res' in a) return a.res;
  try {
    return shopJson({ returns: await createReturn(a.actor, (await params).id, await readJson(req)) }, 201);
  } catch (err) {
    return shopFail(err);
  }
}
