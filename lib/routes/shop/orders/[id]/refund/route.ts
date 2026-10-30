import { NextRequest } from 'next/server';
import { refundOrder } from '@/lib/shop-orders';
import { readJson, shopActor, shopFail, shopJson } from '@/lib/shop-http';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

type Ctx = { params: Promise<{ id: string }> };

/** POST { amountCents?, restock?, reason? } (admins): reembolso total o parcial por Stripe o Mercado Pago. */
export async function POST(req: NextRequest, { params }: Ctx) {
  const a = await shopActor();
  if ('res' in a) return a.res;
  const body = ((await readJson(req)) ?? {}) as Record<string, unknown>;
  const amount = body.amountCents == null ? undefined : Number(body.amountCents);
  if (amount !== undefined && !Number.isInteger(amount)) return shopJson({ error: 'invalid_amount' }, 400);
  try {
    const order = await refundOrder(a.actor, (await params).id, {
      amountCents: amount,
      restock: body.restock === true,
      reason: typeof body.reason === 'string' ? body.reason : undefined,
    });
    return shopJson({ order });
  } catch (err) {
    return shopFail(err);
  }
}
