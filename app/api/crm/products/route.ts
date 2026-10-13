import { NextRequest, NextResponse } from 'next/server';
import { getCurrentUser } from '@/lib/session';
import { createProduct, listProducts } from '@/lib/crm-products';
import { productCreateSchema } from '@/lib/crm-schema';
import { invalidBody, unauthorized } from '@/lib/crm-http';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest) {
  const user = await getCurrentUser();
  if (!user) return unauthorized();
  const sp = req.nextUrl.searchParams;
  const active = sp.get('active');
  const pageSize = Math.min(Math.max(Number(sp.get('pageSize') ?? '50') || 50, 1), 200);
  const page = Math.max(Number(sp.get('page') ?? '1') || 1, 1);
  const { rows, total } = await listProducts(user.id, {
    q: sp.get('q') ?? undefined,
    active: active === '1' || active === 'true' ? true : active === '0' || active === 'false' ? false : undefined,
    page,
    pageSize,
  });
  return NextResponse.json({ rows, total, page, pageSize });
}

export async function POST(req: NextRequest) {
  const user = await getCurrentUser();
  if (!user) return unauthorized();
  const body: unknown = await req.json().catch(() => null);
  const parsed = productCreateSchema.safeParse(body);
  if (!parsed.success) return invalidBody(parsed.error);
  const product = await createProduct(user.id, parsed.data);
  return NextResponse.json(product, { status: 201 });
}
