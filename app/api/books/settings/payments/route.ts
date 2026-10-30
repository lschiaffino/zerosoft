import { NextRequest } from 'next/server';
import { handle, readJson } from '@/lib/books-http';
import { savePayments } from '@/lib/books-payments';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** PATCH /api/books/settings/payments: credenciales de Stripe y Mercado Pago (admins; se guardan cifradas). */
export async function PATCH(req: NextRequest) {
  return handle(async ({ actor }) => ({ payments: await savePayments(actor, (await readJson(req)) as Parameters<typeof savePayments>[1]) }));
}
