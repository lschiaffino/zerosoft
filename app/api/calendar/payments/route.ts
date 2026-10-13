import { NextRequest, NextResponse } from 'next/server';
import { getCurrentUser, isWorkspaceAdmin } from '@/lib/session';
import { getPaymentSettings, savePaymentSettings } from '@/lib/calendar-payments';
import { paymentSettingsSchema } from '@/lib/calendar-schema';
import { forbidden, invalidBody, unauthorized } from '@/lib/crm-http';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** Estado de la conexión con Stripe (nunca devuelve las claves). */
export async function GET() {
  const user = await getCurrentUser();
  if (!user) return unauthorized();
  return NextResponse.json(await getPaymentSettings(user.id));
}

/** Guarda la clave secreta y el signing secret del webhook (cifrados). Solo owner/admin. */
export async function PUT(req: NextRequest) {
  const user = await getCurrentUser();
  if (!user) return unauthorized();
  if (!isWorkspaceAdmin(user)) return forbidden();
  const parsed = paymentSettingsSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return invalidBody(parsed.error);
  return NextResponse.json(await savePaymentSettings(user.id, parsed.data));
}
