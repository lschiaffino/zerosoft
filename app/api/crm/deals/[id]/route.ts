import { NextRequest, NextResponse } from 'next/server';
import { getCurrentUser } from '@/lib/session';
import { deleteDeal, getDeal, updateDeal } from '@/lib/crm';
import { dealUpdateSchema } from '@/lib/crm-schema';
import { invalidBody, notFound, unauthorized } from '@/lib/crm-http';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(_req: NextRequest, { params }: { params: { id: string } }) {
  const user = await getCurrentUser();
  if (!user) return unauthorized();
  const detail = await getDeal(user.id, params.id);
  if (!detail) return notFound();
  return NextResponse.json(detail);
}

export async function PATCH(req: NextRequest, { params }: { params: { id: string } }) {
  const user = await getCurrentUser();
  if (!user) return unauthorized();

  const body: unknown = await req.json().catch(() => null);
  const parsed = dealUpdateSchema.safeParse(body);
  if (!parsed.success) return invalidBody(parsed.error);

  const deal = await updateDeal(user.id, params.id, parsed.data, user.actingUser?.email ?? user.email);
  if (!deal) return notFound();
  return NextResponse.json(deal);
}

export async function DELETE(_req: NextRequest, { params }: { params: { id: string } }) {
  const user = await getCurrentUser();
  if (!user) return unauthorized();
  if (!(await deleteDeal(user.id, params.id))) return notFound();
  return new NextResponse(null, { status: 204 });
}
