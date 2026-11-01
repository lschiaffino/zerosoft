import { NextRequest } from 'next/server';
import { transferStock } from '@/lib/shop-ops';
import { readJson, shopActor, shopFail, shopJson } from '@/lib/shop-http';
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** POST { variantId, fromLocationId, toLocationId, quantity }: mueve stock libre entre ubicaciones. */
export async function POST(req: NextRequest) {
  const a = await shopActor();
  if ('res' in a) return a.res;
  const b = ((await readJson(req)) ?? {}) as Record<string, unknown>;
  try {
    await transferStock(a.actor, { variantId: String(b.variantId ?? ''), fromLocationId: String(b.fromLocationId ?? ''), toLocationId: String(b.toLocationId ?? ''), quantity: Number(b.quantity) });
    return shopJson({ ok: true });
  } catch (err) {
    return shopFail(err);
  }
}
