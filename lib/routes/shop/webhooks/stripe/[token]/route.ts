import { NextRequest } from 'next/server';
import { handleStripeWebhook } from '@/lib/shop-payments';
import { shopFail, shopJson } from '@/lib/shop-http';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

type Ctx = { params: Promise<{ token: string }> };

/** POST /api/shop/webhooks/stripe/<token>: eventos de Stripe de la tienda (firma verificada). */
export async function POST(req: NextRequest, { params }: Ctx) {
  const raw = await req.text();
  if (raw.length > 512 * 1024) return shopJson({ error: 'too_large' }, 413);
  try {
    const out = await handleStripeWebhook((await params).token, raw, req.headers.get('stripe-signature'));
    return shopJson({ received: true, result: out.kind });
  } catch (err) {
    return shopFail(err);
  }
}
