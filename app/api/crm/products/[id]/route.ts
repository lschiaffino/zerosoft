import { NextRequest, NextResponse } from 'next/server';
import { getCurrentUser } from '@/lib/session';
import { deleteProduct, getProduct, updateProduct } from '@/lib/crm-products';
import { productUpdateSchema } from '@/lib/crm-schema';
import { invalidBody, notFound, unauthorized } from '@/lib/crm-http';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

type Ctx = { params: Promise<{ id: string }> };

export async function GET(_req: NextRequest, props: Ctx) {
  const { id } = await props.params;
  const user = await getCurrentUser();
  if (!user) return unauthorized();
  const product = await getProduct(user.id, id);
  if (!product) return notFound();
  return NextResponse.json(product);
}

export async function PATCH(req: NextRequest, props: Ctx) {
  const { id } = await props.params;
  const user = await getCurrentUser();
  if (!user) return unauthorized();
  const body: unknown = await req.json().catch(() => null);
  const parsed = productUpdateSchema.safeParse(body);
  if (!parsed.success) return invalidBody(parsed.error);
  const product = await updateProduct(user.id, id, parsed.data);
  if (!product) return notFound();
  return NextResponse.json(product);
}

export async function DELETE(_req: NextRequest, props: Ctx) {
  const { id } = await props.params;
  const user = await getCurrentUser();
  if (!user) return unauthorized();
  if (!(await deleteProduct(user.id, id))) return notFound();
  return new NextResponse(null, { status: 204 });
}
