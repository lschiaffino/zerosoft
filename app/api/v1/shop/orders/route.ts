import { NextRequest, NextResponse } from 'next/server';
import { requireApiUser } from '@/lib/api-auth';
import { listOrders } from '@/lib/shop-orders';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** GET /api/v1/shop/orders (shop:read): pedidos, los más nuevos primero (status, q). */
export async function GET(req: NextRequest) {
  const auth = await requireApiUser(req, 'shop:read');
  if ('res' in auth) return auth.res;
  const sp = req.nextUrl.searchParams;
  const res = await listOrders(auth.user.id, { q: sp.get('q') ?? undefined, status: sp.get('status') ?? undefined, limit: Math.min(200, Number(sp.get('limit') ?? 50) || 50) });
  return NextResponse.json({ data: res.items, total: res.total });
}
