import { NextRequest, NextResponse } from 'next/server';
import { requireApiUser, apiError } from '@/lib/api-auth';
import { deleteProduct, getProduct, updateProduct } from '@/lib/crm-products';
import { productUpdateSchema } from '@/lib/crm-schema';
import { cleanRow, zodErrorCode } from '@/lib/crm-http';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

type Ctx = { params: Promise<{ id: string }> };

export async function GET(req: NextRequest, props: Ctx) {
  const { id } = await props.params;
  const auth = await requireApiUser(req);
  if ('res' in auth) return auth.res;
  const product = await getProduct(auth.user.id, id);
  if (!product) return apiError(404, 'not_found', 'Product not found.');
  return NextResponse.json(cleanRow(product));
}

export async function PATCH(req: NextRequest, props: Ctx) {
  const { id } = await props.params;
  const auth = await requireApiUser(req);
  if ('res' in auth) return auth.res;

  const body: unknown = await req.json().catch(() => null);
  const parsed = productUpdateSchema.safeParse(body);
  if (!parsed.success) return apiError(400, zodErrorCode(parsed.error), 'The request body is not valid.');

  const product = await updateProduct(auth.user.id, id, parsed.data);
  if (!product) return apiError(404, 'not_found', 'Product not found.');
  return NextResponse.json(cleanRow(product));
}

export async function DELETE(req: NextRequest, props: Ctx) {
  const { id } = await props.params;
  const auth = await requireApiUser(req);
  if ('res' in auth) return auth.res;
  if (!(await deleteProduct(auth.user.id, id))) return apiError(404, 'not_found', 'Product not found.');
  return new NextResponse(null, { status: 204 });
}
