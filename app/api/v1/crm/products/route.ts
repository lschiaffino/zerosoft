import { NextRequest, NextResponse } from 'next/server';
import { requireApiUser, apiError } from '@/lib/api-auth';
import { createProduct, listProducts } from '@/lib/crm-products';
import { productCreateSchema } from '@/lib/crm-schema';
import { cleanRow, pageParams, zodErrorCode } from '@/lib/crm-http';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest) {
  const auth = await requireApiUser(req);
  if ('res' in auth) return auth.res;

  const sp = req.nextUrl.searchParams;
  const { page, pageSize } = pageParams(sp);
  const activeParam = sp.get('active');
  const active = activeParam === 'true' ? true : activeParam === 'false' ? false : undefined;
  const { rows, total } = await listProducts(auth.user.id, {
    q: sp.get('q') ?? undefined,
    active,
    page,
    pageSize,
  });
  return NextResponse.json({ products: rows.map(cleanRow), total, page, pageSize });
}

export async function POST(req: NextRequest) {
  const auth = await requireApiUser(req);
  if ('res' in auth) return auth.res;

  const body: unknown = await req.json().catch(() => null);
  const parsed = productCreateSchema.safeParse(body);
  if (!parsed.success) return apiError(400, zodErrorCode(parsed.error), 'The request body is not valid.');

  const product = await createProduct(auth.user.id, parsed.data);
  return NextResponse.json(cleanRow(product), { status: 201 });
}
