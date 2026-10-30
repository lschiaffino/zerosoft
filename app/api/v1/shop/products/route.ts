import { NextRequest, NextResponse } from 'next/server';
import { requireApiUser } from '@/lib/api-auth';
import { createProduct, getProduct, listProducts } from '@/lib/shop';
import { ShopError } from '@/lib/shop-schema';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** GET /api/v1/shop/products (shop:read): productos con precio, variantes y stock. */
export async function GET(req: NextRequest) {
  const auth = await requireApiUser(req, 'shop:read');
  if ('res' in auth) return auth.res;
  const sp = req.nextUrl.searchParams;
  const res = await listProducts(auth.user.id, { q: sp.get('q') ?? undefined, status: sp.get('status') ?? undefined, limit: Math.min(200, Number(sp.get('limit') ?? 50) || 50) });
  return NextResponse.json({ data: res.items, total: res.total });
}

/** POST /api/v1/shop/products (shop:write): mismo cuerpo que la app (title, variants[…], options…). */
export async function POST(req: NextRequest) {
  const auth = await requireApiUser(req, 'shop:write');
  if ('res' in auth) return auth.res;
  const body = await req.json().catch(() => null);
  try {
    const p = await createProduct({ ws: auth.user.id, person: auth.personId, admin: auth.role === 'owner' || auth.role === 'admin' }, body);
    return NextResponse.json({ data: await getProduct(auth.user.id, p.id) }, { status: 201 });
  } catch (err) {
    if (err instanceof ShopError) return NextResponse.json({ error: { code: err.code, message: 'Invalid product.' } }, { status: err.status });
    throw err;
  }
}
