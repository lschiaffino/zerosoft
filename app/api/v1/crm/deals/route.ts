import { NextRequest, NextResponse } from 'next/server';
import { requireApiUser, apiError } from '@/lib/api-auth';
import { createDeal, listDeals } from '@/lib/crm';
import { dealCreateSchema } from '@/lib/crm-schema';
import { cleanRow, defaultPipelineId, pageParams, zodErrorCode } from '@/lib/crm-http';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest) {
  const auth = await requireApiUser(req);
  if ('res' in auth) return auth.res;

  const sp = req.nextUrl.searchParams;
  const { page, pageSize } = pageParams(sp);
  const pipelineId = sp.get('pipelineId') ?? (await defaultPipelineId(auth.user.id));
  if (!pipelineId) return NextResponse.json({ deals: [], total: 0, page, pageSize });

  const { rows, total } = await listDeals(auth.user.id, { pipelineId, page, pageSize });
  return NextResponse.json({ deals: rows.map(cleanRow), total, page, pageSize });
}

export async function POST(req: NextRequest) {
  const auth = await requireApiUser(req);
  if ('res' in auth) return auth.res;

  const body: unknown = await req.json().catch(() => null);
  const parsed = dealCreateSchema.safeParse(body);
  if (!parsed.success) {
    return apiError(400, zodErrorCode(parsed.error), 'The request body is not valid.');
  }

  const result = await createDeal(auth.user.id, parsed.data);
  if (!result.ok) {
    return result.reason === 'invalid_stage'
      ? apiError(400, 'invalid_stage', 'The stage does not belong to that pipeline.')
      : apiError(400, 'invalid_pipeline', 'The pipeline does not exist.');
  }
  return NextResponse.json(cleanRow(result.deal), { status: 201 });
}
