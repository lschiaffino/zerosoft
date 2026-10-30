import { NextRequest } from 'next/server';
import { listTaxRates, replaceTaxRates } from '@/lib/shop';
import { readJson, shopActor, shopFail, shopJson } from '@/lib/shop-http';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET() {
  const a = await shopActor();
  if ('res' in a) return a.res;
  return shopJson({ rates: await listTaxRates(a.actor.ws) });
}

/** PUT /api/shop/taxes { rates }: tasas por país y región (la de la región gana). */
export async function PUT(req: NextRequest) {
  const a = await shopActor();
  if ('res' in a) return a.res;
  const body = (await readJson(req)) as { rates?: unknown } | null;
  try {
    return shopJson({ rates: await replaceTaxRates(a.actor, body?.rates ?? []) });
  } catch (err) {
    return shopFail(err);
  }
}
