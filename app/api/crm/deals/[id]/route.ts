import { NextRequest, NextResponse } from 'next/server';
import { getCurrentUser } from '@/lib/session';
import { deleteDeal, getDeal, updateDeal } from '@/lib/crm';
import { dealUpdateSchema } from '@/lib/crm-schema';
import { catchRef, crmError, CrmRefError, invalidBody, notFound, unauthorized, guardRecord } from '@/lib/crm-http';
import { sessionScope, scopeDealDetail } from '@/lib/crm-visibility';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(_req: NextRequest, props: { params: Promise<{ id: string }> }) {
  const params = await props.params;
  const user = await getCurrentUser();
  if (!user) return unauthorized();
  const scope = await sessionScope(user);
  const hidden = await guardRecord(user.id, 'deal', params.id, scope);
  if (hidden) return hidden;
  const detail = await getDeal(user.id, params.id);
  if (!detail) return notFound();
  return NextResponse.json(scopeDealDetail(detail, scope));
}

export async function PATCH(req: NextRequest, props: { params: Promise<{ id: string }> }) {
  const params = await props.params;
  const user = await getCurrentUser();
  if (!user) return unauthorized();
  const scope = await sessionScope(user);
  const hidden = await guardRecord(user.id, 'deal', params.id, scope);
  if (hidden) return hidden;

  const body: unknown = await req.json().catch(() => null);
  const parsed = dealUpdateSchema.safeParse(body);
  if (!parsed.success) return invalidBody(parsed.error);

  const deal = await catchRef(updateDeal(user.id, params.id, parsed.data, user.actingUser?.email ?? user.email));
  if (deal instanceof CrmRefError) return crmError(400, deal.code);
  if (!deal) return notFound();
  return NextResponse.json(deal);
}

export async function DELETE(_req: NextRequest, props: { params: Promise<{ id: string }> }) {
  const params = await props.params;
  const user = await getCurrentUser();
  if (!user) return unauthorized();
  const scope = await sessionScope(user);
  const hidden = await guardRecord(user.id, 'deal', params.id, scope);
  if (hidden) return hidden;
  if (!(await deleteDeal(user.id, params.id))) return notFound();
  return new NextResponse(null, { status: 204 });
}
