import { NextRequest } from 'next/server';
import { getDb } from '@/lib/db';
import { enabledMethods } from '@/lib/shop';
import { getOrderRow, orderByStatusToken, orderItems } from '@/lib/shop-orders';
import { startPayment } from '@/lib/shop-payments';
import { publishedStore } from '@/lib/shop-storefront';
import { readJson, publicOrigin, shopFail, shopJson, shopLimit } from '@/lib/shop-http';
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

type Ctx = { params: Promise<{ handle: string }> };


/**
 * POST { token, method }: abre el cobro de un pedido pendiente desde su
 * página. Solo una factura de borrador puede cambiar de medio de pago; un
 * pedido online reintenta el suyo (su total pudo llevar el descuento de ese medio).
 */
export async function POST(req: NextRequest, { params }: Ctx) {
  const { handle } = await params;
  const limited = await shopLimit(req, 'pay', 10, 600, handle);
  if (limited) return limited;
  const store = await publishedStore(handle);
  if (!store) return shopJson({ error: 'not_found' }, 404);
  const body = ((await readJson(req)) ?? {}) as { token?: string; method?: string };
  const o = await orderByStatusToken(store.row, String(body.token ?? ''));
  if (!o) return shopJson({ error: 'not_found' }, 404);
  const method = body.method === 'stripe' || body.method === 'mercadopago' ? body.method : null;
  if (!method || !enabledMethods(store.row).includes(method)) return shopJson({ error: 'payment_unavailable' }, 409);
  if (o.source !== 'draft' && o.payment_method !== method) return shopJson({ error: 'payment_unavailable' }, 409);
  if (o.total_cents <= 0) return shopJson({ error: 'invalid_total' }, 409);
  const claim = await getDb().prepare("UPDATE shop_orders SET payment_method = ? WHERE id = ? AND status = 'pending'").run(method, o.id);
  if (!claim.changes) return shopJson({ error: 'invalid_status' }, 409);
  try {
    const row = (await getOrderRow(o.workspace_id, o.id))!;
    return shopJson({ redirectUrl: await startPayment(store.row, row, await orderItems(o.id), publicOrigin(req)) });
  } catch (err) {
    return shopFail(err);
  }
}
