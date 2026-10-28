import { NextRequest, NextResponse } from 'next/server';
import { handleShopifyWebhook, IntegrationError } from '@/lib/link-integrations';
import { limitByIp } from '@/lib/rate-limit';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * Webhook de Shopify (Settings › Notifications › Webhooks › Order payment).
 * Verifica X-Shopify-Hmac-Sha256 con el secreto guardado y registra la venta
 * atribuida al click (?zs_id=). Un pedido repetido no se cuenta dos veces.
 */
export async function POST(req: NextRequest) {
  const limited = await limitByIp(req, 'links-shopify', 600, 60);
  if (limited) return limited;
  const raw = await req.text();
  if (raw.length > 1_000_000) return NextResponse.json({ error: 'too_large' }, { status: 413 });
  try {
    const outcome = await handleShopifyWebhook(req.nextUrl.searchParams.get('token') ?? '', raw, {
      hmac: req.headers.get('x-shopify-hmac-sha256'),
      topic: req.headers.get('x-shopify-topic'),
    });
    return NextResponse.json({ ok: true, outcome });
  } catch (err) {
    if (err instanceof IntegrationError) return NextResponse.json({ error: err.code }, { status: err.status });
    throw err;
  }
}
