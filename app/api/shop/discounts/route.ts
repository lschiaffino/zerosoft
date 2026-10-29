import { NextRequest } from 'next/server';
import { createDiscount, listDiscounts } from '@/lib/shop';
import { readJson, shopActor, shopFail, shopJson } from '@/lib/shop-http';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest) {
  const a = await shopActor();
  if ('res' in a) return a.res;
  return shopJson({ discounts: await listDiscounts(a.actor.ws, { q: req.nextUrl.searchParams.get('q') ?? undefined }) });
}

/** POST /api/shop/discounts: porcentaje, monto fijo o envío gratis, con mínimo, tope de usos y vigencia. */
export async function POST(req: NextRequest) {
  const a = await shopActor();
  if ('res' in a) return a.res;
  try {
    return shopJson({ discount: await createDiscount(a.actor, await readJson(req)) }, 201);
  } catch (err) {
    return shopFail(err);
  }
}
