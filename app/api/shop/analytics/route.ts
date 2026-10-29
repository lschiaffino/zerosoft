import { NextRequest } from 'next/server';
import { shopAnalytics } from '@/lib/shop-orders';
import { shopActor, shopJson } from '@/lib/shop-http';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** GET /api/shop/analytics?days=30: ventas, pedidos, ticket promedio, conversión y productos más vendidos. */
export async function GET(req: NextRequest) {
  const a = await shopActor();
  if ('res' in a) return a.res;
  const days = Number(req.nextUrl.searchParams.get('days') ?? 30);
  return shopJson({ analytics: await shopAnalytics(a.actor.ws, [7, 30, 90, 365].includes(days) ? days : 30) });
}
