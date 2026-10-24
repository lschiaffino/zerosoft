import { NextRequest, NextResponse } from 'next/server';
import { guardRecordCustomWrite, hiddenFieldsFor, redactRow, sessionFieldViewer } from '@/lib/crm-field-perms';
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
  const scoped = scopeDealDetail(detail, scope);
  const hiddenFields = await hiddenFieldsFor(sessionFieldViewer(user), 'deals');
  return NextResponse.json({ ...scoped, deal: redactRow(scoped.deal, hiddenFields) });
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

  const fieldViewer = sessionFieldViewer(user);
  const fp = await guardRecordCustomWrite(fieldViewer, 'deal', params.id, parsed.data.custom);
  if (!fp.ok) return crmError(403, 'field_readonly');
  const deal = await catchRef(updateDeal(user.id, params.id, { ...parsed.data, custom: fp.custom }, user.actingUser?.email ?? user.email));
  if (deal instanceof CrmRefError) return crmError(400, deal.code);
  if (!deal) return notFound();
  return NextResponse.json(redactRow(deal, await hiddenFieldsFor(fieldViewer, 'deals')));
}

export async function DELETE(_req: NextRequest, props: { params: Promise<{ id: string }> }) {
  const params = await props.params;
  const user = await getCurrentUser();
  if (!user) return unauthorized();
  const scope = await sessionScope(user);
  const hidden = await guardRecord(user.id, 'deal', params.id, scope);
  if (hidden) return hidden;
  if (!(await deleteDeal(user.id, params.id, user.actingUser?.email ?? user.email))) return notFound();
  return new NextResponse(null, { status: 204 });
}
