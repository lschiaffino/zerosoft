import { NextRequest, NextResponse } from 'next/server';
import { getCurrentUser } from '@/lib/session';
import { deleteList, getList, updateList } from '@/lib/crm';
import { listUpdateSchema } from '@/lib/crm-schema';
import { invalidBody, notFound, unauthorized } from '@/lib/crm-http';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(_req: NextRequest, props: { params: Promise<{ id: string }> }) {
  const params = await props.params;
  const user = await getCurrentUser();
  if (!user) return unauthorized();
  const detail = await getList(user.id, params.id);
  if (!detail) return notFound();
  return NextResponse.json(detail);
}

export async function PATCH(req: NextRequest, props: { params: Promise<{ id: string }> }) {
  const params = await props.params;
  const user = await getCurrentUser();
  if (!user) return unauthorized();

  const body: unknown = await req.json().catch(() => null);
  const parsed = listUpdateSchema.safeParse(body);
  if (!parsed.success) return invalidBody(parsed.error);

  const list = await updateList(user.id, params.id, parsed.data);
  if (!list) return notFound();
  return NextResponse.json(list);
}

export async function DELETE(_req: NextRequest, props: { params: Promise<{ id: string }> }) {
  const params = await props.params;
  const user = await getCurrentUser();
  if (!user) return unauthorized();
  if (!(await deleteList(user.id, params.id))) return notFound();
  return new NextResponse(null, { status: 204 });
}
