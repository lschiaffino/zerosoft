import { NextRequest } from 'next/server';
import { checkoutByToken } from '@/lib/shop-abandoned';
import { publishedStore } from '@/lib/shop-storefront';
import { shopJson, shopLimit } from '@/lib/shop-http';
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

type Ctx = { params: Promise<{ handle: string }> };


/** GET ?token=…: el carrito guardado de un checkout abandonado (el token es largo y aleatorio). */
export async function GET(req: NextRequest, { params }: Ctx) {
  const { handle } = await params;
  const limited = await shopLimit(req, 'recover', 30, 600, handle);
  if (limited) return limited;
  const store = await publishedStore(handle);
  if (!store) return shopJson({ error: 'not_found' }, 404);
  const found = await checkoutByToken(store.row.workspace_id, req.nextUrl.searchParams.get('token') ?? '');
  return found ? shopJson(found, 200, { 'cache-control': 'no-store' }) : shopJson({ error: 'not_found' }, 404);
}
