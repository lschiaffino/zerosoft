import { NextRequest, NextResponse } from 'next/server';
import { handleStripeWebhook, PaymentError } from '@/lib/calendar-payments';
import { afterBookingCreated, afterPaymentRefunded } from '@/lib/calendar-lifecycle';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * Webhook de Stripe del workspace (la URL lleva un token propio). Eventos:
 * checkout.session.completed / async_payment_succeeded → confirma la reserva;
 * checkout.session.expired / async_payment_failed → libera el horario.
 * Un pago que llega con la reserva ya cancelada se reembolsa.
 */
export async function POST(req: NextRequest, props: { params: Promise<{ token: string }> }) {
  const { token } = await props.params;
  const raw = await req.text();
  try {
    const outcome = await handleStripeWebhook(token, raw, req.headers.get('stripe-signature'));
    if (outcome.kind === 'confirmed') await afterBookingCreated(outcome.booking, outcome.booking.locale);
    // Pago tardío sobre una reserva cancelada o un horario ya ocupado: se
    // reembolsó y se avisa a las dos partes.
    if (outcome.kind === 'refunded') await afterPaymentRefunded(outcome.booking);
    return NextResponse.json({ received: true, outcome: outcome.kind });
  } catch (err) {
    if (err instanceof PaymentError) return NextResponse.json({ error: err.code }, { status: err.status });
    return NextResponse.json({ error: 'generic' }, { status: 500 });
  }
}
