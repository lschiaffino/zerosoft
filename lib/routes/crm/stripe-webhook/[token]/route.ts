import { NextRequest, NextResponse } from 'next/server';
import { AppError, handleStripeAppWebhook } from '@/lib/crm-apps';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * Webhook de la app Stripe del CRM (la URL lleva un token por workspace; la
 * firma Stripe-Signature se verifica con el signing secret guardado).
 * customer.created, charge.succeeded, invoice.paid y checkout.session.completed.
 */
export async function POST(req: NextRequest, props: { params: Promise<{ token: string }> }) {
  const { token } = await props.params;
  const raw = await req.text();
  try {
    const outcome = await handleStripeAppWebhook(token, raw, req.headers.get('stripe-signature'));
    return NextResponse.json({ received: true, outcome });
  } catch (err) {
    if (err instanceof AppError) return NextResponse.json({ error: err.code }, { status: err.status });
    return NextResponse.json({ error: 'generic' }, { status: 500 });
  }
}
