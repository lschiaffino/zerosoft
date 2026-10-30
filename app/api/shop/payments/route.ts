import { NextRequest } from 'next/server';
import { ensureStore } from '@/lib/shop';
import { paymentsView, savePayments, type PaymentsPatch } from '@/lib/shop-payments';
import { readJson, shopActor, shopFail, shopJson } from '@/lib/shop-http';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** GET /api/shop/payments (admins): estado de Stripe, Mercado Pago y transferencia, sin secretos. */
export async function GET() {
  const a = await shopActor();
  if ('res' in a) return a.res;
  if (!a.actor.admin) return shopJson({ error: 'forbidden' }, 403);
  return shopJson({ payments: paymentsView(await ensureStore(a.actor.ws)) });
}

/** PUT /api/shop/payments (admins): guarda credenciales cifradas; vacío = sin cambio, null = desconectar. */
export async function PUT(req: NextRequest) {
  const a = await shopActor();
  if ('res' in a) return a.res;
  const body = (await readJson(req)) as PaymentsPatch | null;
  if (!body || typeof body !== 'object') return shopJson({ error: 'invalid_input' }, 400);
  try {
    return shopJson({ payments: await savePayments(a.actor, body) });
  } catch (err) {
    return shopFail(err);
  }
}
