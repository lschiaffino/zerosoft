import { NextRequest } from 'next/server';
import { z } from 'zod';
import { publishedStore } from '@/lib/shop-storefront';
import { lookupOrder, orderByStatusToken, publicOrder } from '@/lib/shop-orders';
import { reconcileStripeReturn } from '@/lib/shop-payments';
import { readJson, shopJson, shopLimit } from '@/lib/shop-http';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

type Ctx = { params: Promise<{ handle: string }> };

/**
 * GET /api/shop/public/<handle>/order?token=…[&session_id=…]: estado del
 * pedido para su página (el token es largo y aleatorio). Al volver de Stripe
 * con session_id consulta la sesión por si el webhook no llegó.
 */
export async function GET(req: NextRequest, { params }: Ctx) {
  const { handle } = await params;
  const limited = await shopLimit(req, 'status', 120, 60, handle);
  if (limited) return limited;
  const store = await publishedStore(handle);
  if (!store) return shopJson({ error: 'not_found' }, 404);
  const token = req.nextUrl.searchParams.get('token') ?? '';
  let o = await orderByStatusToken(store.row, token);
  if (!o) return shopJson({ error: 'not_found' }, 404);
  const session = req.nextUrl.searchParams.get('session_id');
  if (session && o.status === 'pending' && (await reconcileStripeReturn(store.row, o, session).catch(() => false))) {
    o = (await orderByStatusToken(store.row, token))!;
  }
  return shopJson({ order: await publicOrder(store.row, o) }, 200, { 'cache-control': 'no-store' });
}

const lookupSchema = z.object({ number: z.string().trim().max(20), email: z.string().trim().max(200) });

/**
 * POST { number, email }: busca el pedido (los dos tienen que coincidir).
 * Con límite por IP: número y email no se adivinan probando.
 */
export async function POST(req: NextRequest, { params }: Ctx) {
  const { handle } = await params;
  const limited = await shopLimit(req, 'lookup', 10, 600, handle);
  if (limited) return limited;
  const store = await publishedStore(handle);
  if (!store) return shopJson({ error: 'not_found' }, 404);
  const parsed = lookupSchema.safeParse(await readJson(req));
  if (!parsed.success) return shopJson({ error: 'invalid_input' }, 400);
  const o = await lookupOrder(store.row, parsed.data.number, parsed.data.email);
  // Sin coincidencia exacta no se dice si el número existe.
  if (!o) return shopJson({ error: 'not_found' }, 404);
  return shopJson({ statusToken: o.status_token });
}
