import { NextRequest } from 'next/server';
import { handleMercadoPagoWebhook } from '@/lib/shop-payments';
import { shopFail, shopJson } from '@/lib/shop-http';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

type Ctx = { params: Promise<{ token: string }> };

/**
 * POST /api/shop/webhooks/mercadopago/<token>: avisos de Mercado Pago
 * (Webhooks, con x-signature). El id del pago viene en ?data.id= y en el cuerpo.
 */
export async function POST(req: NextRequest, { params }: Ctx) {
  const raw = await req.text();
  if (raw.length > 64 * 1024) return shopJson({ error: 'too_large' }, 413);
  let body: { type?: string; action?: string; data?: { id?: string | number } } = {};
  try {
    body = raw ? JSON.parse(raw) : {};
  } catch {
    body = {};
  }
  const sp = req.nextUrl.searchParams;
  const dataId = String(sp.get('data.id') ?? body.data?.id ?? '');
  const type = String(sp.get('type') ?? body.type ?? (body.action?.startsWith('payment') ? 'payment' : ''));
  try {
    const out = await handleMercadoPagoWebhook((await params).token, {
      dataId,
      type,
      signature: req.headers.get('x-signature'),
      requestId: req.headers.get('x-request-id'),
    });
    return shopJson({ received: true, result: out.kind });
  } catch (err) {
    return shopFail(err);
  }
}
