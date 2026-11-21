import { NextRequest, NextResponse } from 'next/server';
import { guardRecordCustomWrite, hiddenFieldsFor, redactRow, sessionFieldViewer } from '@/lib/crm-field-perms';
import { getCurrentUser, realUserId } from '@/lib/session';
import { sessionScope } from '@/lib/crm-visibility';
import { requestFilter } from '@/lib/crm-filter-http';
import { getUserTimeZone } from '@/lib/user-tz';
import { createDeal, listDeals, listDealsForBoard } from '@/lib/crm';
import { dealSessionCreateSchema } from '@/lib/crm-schema';
import { createFormMissing } from '@/lib/crm-create-form';
import { isCreateFormRequest } from '@/lib/crm-create-form-shared';
import { catchRef, crmError, CrmRefError, defaultPipelineId, invalidBody, pageParams, sortParam, unauthorized } from '@/lib/crm-http';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const SORTS = ['newest', 'oldest', 'amount', 'close_date'] as const;

export async function GET(req: NextRequest) {
  const user = await getCurrentUser();
  if (!user) return unauthorized();

  const sp = req.nextUrl.searchParams;
  const { page, pageSize } = pageParams(sp);

  if (sp.get('board') === '1') {
    const pipelineId = sp.get('pipelineId');
    if (!pipelineId) return crmError(400, 'invalid_input');
    return NextResponse.json({ rows: await listDealsForBoard(user.id, pipelineId, await sessionScope(user)) });
  }

  const pipelineId = sp.get('pipelineId') ?? (await defaultPipelineId(user.id));
  if (!pipelineId) return NextResponse.json({ rows: [], total: 0, page, pageSize });

  const filter = await requestFilter(sp, 'deals', { viewer: sessionFieldViewer(user), viewerId: realUserId(user), timeZone: await getUserTimeZone() });
  if ('error' in filter) return crmError(400, 'invalid_filter');
  const { rows, total } = await listDeals(user.id, {
    ownerScope: await sessionScope(user),
    ...filter,
    pipelineId,
    q: sp.get('q') ?? undefined,
    stageId: sp.get('stageId') ?? undefined,
    priority: sp.get('priority') ?? undefined,
    sort: sortParam(sp, SORTS),
    page,
    pageSize,
  });

  const hiddenFields = await hiddenFieldsFor(sessionFieldViewer(user), 'deals');
  return NextResponse.json({ rows: rows.map((r) => redactRow(r, hiddenFields)), total, page, pageSize });
}

export async function POST(req: NextRequest) {
  const user = await getCurrentUser();
  if (!user) return unauthorized();

  const body: unknown = await req.json().catch(() => null);
  const parsed = dealSessionCreateSchema.safeParse(body);
  if (!parsed.success) return invalidBody(parsed.error);

  const fp = await guardRecordCustomWrite(sessionFieldViewer(user), 'deal', null, parsed.data.custom);
  if (!fp.ok) return crmError(403, 'field_readonly');
  const data = { ...parsed.data, custom: fp.custom, ownerId: parsed.data.ownerId ?? realUserId(user) };
  // Las obligatorias del formulario de alta (Ajustes › Datos), solo para las altas desde ese formulario.
  if (isCreateFormRequest(body)) {
    const missing = await createFormMissing(sessionFieldViewer(user), 'deals', data);
    if (missing.fields.length) return NextResponse.json({ error: 'missing_required', ...missing }, { status: 400 });
  }
  const result = await catchRef(createDeal(user.id, data));
  if (result instanceof CrmRefError) return crmError(400, result.code);
  if (!result.ok) {
    return crmError(400, result.reason === 'invalid_stage' ? 'invalid_stage' : 'invalid_input');
  }
  return NextResponse.json(result.deal, { status: 201 });
}
