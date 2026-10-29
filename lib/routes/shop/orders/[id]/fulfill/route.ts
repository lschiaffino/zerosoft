import { NextRequest } from 'next/server';
import { fulfillOrder } from '@/lib/shop-orders';
import { readJson, shopActor, shopFail, shopJson } from '@/lib/shop-http';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

type Ctx = { params: Promise<{ id: string }> };

/** POST { trackingNumber, trackingCompany, trackingUrl, notify }: marca enviado y avisa al cliente. */
export async function POST(req: NextRequest, { params }: Ctx) {
  const a = await shopActor();
  if ('res' in a) return a.res;
  const body = ((await readJson(req)) ?? {}) as Record<string, unknown>;
  const str = (v: unknown) => (typeof v === 'string' ? v : undefined);
  try {
    const order = await fulfillOrder(a.actor, (await params).id, {
      trackingNumber: str(body.trackingNumber),
      trackingCompany: str(body.trackingCompany),
      trackingUrl: str(body.trackingUrl),
      notify: body.notify !== false,
    });
    return shopJson({ order });
  } catch (err) {
    return shopFail(err);
  }
}
