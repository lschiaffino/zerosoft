import { NextRequest } from 'next/server';
import { listShippingRates, replaceShippingRates } from '@/lib/shop';
import { readJson, shopActor, shopFail, shopJson } from '@/lib/shop-http';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET() {
  const a = await shopActor();
  if ('res' in a) return a.res;
  return shopJson({ rates: await listShippingRates(a.actor.ws) });
}

/** PUT /api/shop/shipping { rates }: reemplaza las tarifas (fija o por peso, por países, gratis desde un monto). */
export async function PUT(req: NextRequest) {
  const a = await shopActor();
  if ('res' in a) return a.res;
  const body = (await readJson(req)) as { rates?: unknown } | null;
  try {
    return shopJson({ rates: await replaceShippingRates(a.actor, body?.rates ?? []) });
  } catch (err) {
    return shopFail(err);
  }
}
