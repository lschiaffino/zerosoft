import { NextRequest, NextResponse } from 'next/server';
import { limitByIp } from '@/lib/rate-limit';
import { crmError } from '@/lib/crm-http';
import { AppError } from '@/lib/crm-apps';
import { createQuoteCheckout } from '@/lib/crm-quote-pay';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** Pago de una cotización firmada (/q/<token>): crea la sesión de Stripe Checkout. Sin login. */
export async function POST(req: NextRequest, props: { params: Promise<{ token: string }> }) {
  const { token } = await props.params;
  const limited = await limitByIp(req, 'crm:quote-pay', 20, 600);
  if (limited) return limited;
  const body = (await req.json().catch(() => null)) as { locale?: string } | null;
  const origin = (process.env.NEXTAUTH_URL ?? req.nextUrl.origin).replace(/\/$/, '');
  try {
    const url = await createQuoteCheckout(token, { origin, locale: body?.locale ?? 'en' });
    return NextResponse.json({ url });
  } catch (err) {
    if (err instanceof AppError) return crmError(err.status, err.code);
    throw err;
  }
}
