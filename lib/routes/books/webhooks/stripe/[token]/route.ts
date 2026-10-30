import { NextRequest } from 'next/server';
import { booksFail, booksJson } from '@/lib/books-http';
import { handleStripeWebhook } from '@/lib/books-payments';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

type Ctx = { params: Promise<{ token: string }> };

/** POST /api/books/webhooks/stripe/<token>: eventos de Stripe de las facturas (firma verificada, idempotente). */
export async function POST(req: NextRequest, { params }: Ctx) {
  const raw = await req.text();
  if (raw.length > 512 * 1024) return booksJson({ error: 'too_large' }, 413);
  try {
    const out = await handleStripeWebhook((await params).token, raw, req.headers.get('stripe-signature'));
    return booksJson({ received: true, result: out.kind });
  } catch (err) {
    return booksFail(err);
  }
}
