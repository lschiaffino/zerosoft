import { NextRequest, NextResponse } from 'next/server';
import { apiFieldViewer, guardRecordCustomWrite, hiddenFieldsFor, redactRow } from '@/lib/crm-field-perms';
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
  return NextResponse.json(cleanRow(redactRow(detail.deal, await hiddenFieldsFor(apiFieldViewer(auth), 'deals'))));
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

  const fieldViewer = apiFieldViewer(auth);
  const fp = await guardRecordCustomWrite(fieldViewer, 'deal', params.id, parsed.data.custom);
  if (!fp.ok) return apiError(403, 'field_readonly', 'A property in the body is read-only for this key.');
  const deal = await catchRef(updateDeal(auth.user.id, params.id, { ...parsed.data, custom: fp.custom }, auth.user.email));
  if (deal instanceof CrmRefError) return apiError(400, deal.code, 'A referenced record does not exist.');
  if (!deal) return apiError(404, 'not_found', 'Deal not found.');
  return NextResponse.json(cleanRow(redactRow(deal, await hiddenFieldsFor(fieldViewer, 'deals'))));
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
