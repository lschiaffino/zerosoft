import { NextRequest, NextResponse } from 'next/server';
import { apiFieldViewer, guardRecordCustomWrite, hiddenFieldsFor, redactRow } from '@/lib/crm-field-perms';
import { requireApiUser, apiError } from '@/lib/api-auth';
import { createDeal, listDeals } from '@/lib/crm';
import { dealCreateSchema } from '@/lib/crm-schema';
import { catchRef, cleanRow, CrmRefError, defaultPipelineId, pageParams, zodErrorCode } from '@/lib/crm-http';
import { apiScope } from '@/lib/crm-visibility';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest) {
  const auth = await requireApiUser(req, 'crm:read');
  if ('res' in auth) return auth.res;

  const sp = req.nextUrl.searchParams;
  const { page, pageSize } = pageParams(sp);
  const pipelineId = sp.get('pipelineId') ?? (await defaultPipelineId(auth.user.id));
  if (!pipelineId) return NextResponse.json({ deals: [], total: 0, page, pageSize });

  const { rows, total } = await listDeals(auth.user.id, { pipelineId, page, pageSize, ownerScope: await apiScope(auth) });
  const hiddenFields = await hiddenFieldsFor(apiFieldViewer(auth), 'deals');
  return NextResponse.json({ deals: rows.map((r) => cleanRow(redactRow(r, hiddenFields))), total, page, pageSize });
}

export async function POST(req: NextRequest) {
  const auth = await requireApiUser(req, 'crm:write');
  if ('res' in auth) return auth.res;

  const body: unknown = await req.json().catch(() => null);
  const parsed = dealCreateSchema.safeParse(body);
  if (!parsed.success) {
    return apiError(400, zodErrorCode(parsed.error), 'The request body is not valid.');
  }

  const fp = await guardRecordCustomWrite(apiFieldViewer(auth), 'deal', null, parsed.data.custom);
  if (!fp.ok) return apiError(403, 'field_readonly', 'A property in the body is read-only for this key.');
  const result = await catchRef(createDeal(auth.user.id, { ...parsed.data, custom: fp.custom, ownerId: parsed.data.ownerId ?? auth.personId }));
  if (result instanceof CrmRefError) return apiError(400, result.code, 'A referenced record does not exist.');
  if (!result.ok) {
    return result.reason === 'invalid_stage'
      ? apiError(400, 'invalid_stage', 'The stage does not belong to that pipeline.')
      : apiError(400, 'invalid_pipeline', 'The pipeline does not exist.');
  }
  return NextResponse.json(cleanRow(result.deal), { status: 201 });
}
