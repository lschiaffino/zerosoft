import { NextRequest } from 'next/server';
import { listCustomers } from '@/lib/shop';
import { shopActor, shopJson } from '@/lib/shop-http';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** GET /api/shop/customers?q=: clientes de la tienda (solo quien tiene Shop ve sus datos). */
export async function GET(req: NextRequest) {
  const a = await shopActor();
  if ('res' in a) return a.res;
  return shopJson({ customers: await listCustomers(a.actor.ws, { q: req.nextUrl.searchParams.get('q') ?? undefined }) });
}
