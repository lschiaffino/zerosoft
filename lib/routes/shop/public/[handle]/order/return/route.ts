import { NextRequest } from 'next/server';
import { orderByStatusToken } from '@/lib/shop-orders';
import { requestReturnAsCustomer } from '@/lib/shop-ops';
import { publishedStore } from '@/lib/shop-storefront';
import { readJson, shopFail, shopJson, shopLimit } from '@/lib/shop-http';
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

type Ctx = { params: Promise<{ handle: string }> };


/** POST { token, items, reason, note }: el cliente pide una devolución, si la tienda las aceptó y dentro del plazo. */
export async function POST(req: NextRequest, { params }: Ctx) {
  const { handle } = await params;
  const limited = await shopLimit(req, 'return', 5, 600, handle);
  if (limited) return limited;
  const store = await publishedStore(handle);
  if (!store) return shopJson({ error: 'not_found' }, 404);
  const body = ((await readJson(req)) ?? {}) as { token?: string };
  const o = await orderByStatusToken(store.row, String(body.token ?? ''));
  if (!o) return shopJson({ error: 'not_found' }, 404);
  try {
    await requestReturnAsCustomer(store.row, o, body);
    return shopJson({ ok: true }, 201);
  } catch (err) {
    return shopFail(err);
  }
}
