import { NextRequest, NextResponse } from 'next/server';
import { requireApiUser, apiError } from '@/lib/api-auth';
import { getDeal, updateDeal, deleteDeal } from '@/lib/crm';
import { dealUpdateSchema } from '@/lib/crm-schema';
import { catchRef, cleanRow, CrmRefError, zodErrorCode, apiGuardRecord } from '@/lib/crm-http';
import { apiScope } from '@/lib/crm-visibility';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest, props: { params: Promise<{ id: string }> }) {
  const params = await props.params;
  const auth = await requireApiUser(req, 'crm:read');
  if ('res' in auth) return auth.res;
  const hidden = await apiGuardRecord(auth.user.id, 'deal', params.id, await apiScope(auth));
  if (hidden) return hidden;

  const detail = await getDeal(auth.user.id, params.id);
  if (!detail) return apiError(404, 'not_found', 'Deal not found.');
  return NextResponse.json(cleanRow(detail.deal));
}

export async function PATCH(req: NextRequest, props: { params: Promise<{ id: string }> }) {
  const params = await props.params;
  const auth = await requireApiUser(req, 'crm:write');
  if ('res' in auth) return auth.res;
  const hidden = await apiGuardRecord(auth.user.id, 'deal', params.id, await apiScope(auth));
  if (hidden) return hidden;

  const body: unknown = await req.json().catch(() => null);
  const parsed = dealUpdateSchema.safeParse(body);
  if (!parsed.success) {
    return apiError(400, zodErrorCode(parsed.error), 'The request body is not valid.');
  }

  const deal = await catchRef(updateDeal(auth.user.id, params.id, parsed.data, auth.user.email));
  if (deal instanceof CrmRefError) return apiError(400, deal.code, 'A referenced record does not exist.');
  if (!deal) return apiError(404, 'not_found', 'Deal not found.');
  return NextResponse.json(cleanRow(deal));
}

export async function DELETE(req: NextRequest, props: { params: Promise<{ id: string }> }) {
  const params = await props.params;
  const auth = await requireApiUser(req, 'crm:write');
  if ('res' in auth) return auth.res;
  const hidden = await apiGuardRecord(auth.user.id, 'deal', params.id, await apiScope(auth));
  if (hidden) return hidden;
  if (!(await deleteDeal(auth.user.id, params.id, auth.user.email))) return apiError(404, 'not_found', 'Deal not found.');
  return new NextResponse(null, { status: 204 });
}
