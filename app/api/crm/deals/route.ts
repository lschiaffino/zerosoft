import { NextRequest, NextResponse } from 'next/server';
import { getCurrentUser } from '@/lib/session';
import { createDeal, listDeals, listDealsForBoard } from '@/lib/crm';
import { dealCreateSchema } from '@/lib/crm-schema';
import {
  crmError,
  defaultPipelineId,
  invalidBody,
  pageParams,
  sortParam,
  unauthorized,
} from '@/lib/crm-http';

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
    return NextResponse.json({ rows: await listDealsForBoard(user.id, pipelineId) });
  }

  const pipelineId = sp.get('pipelineId') ?? (await defaultPipelineId(user.id));
  if (!pipelineId) return NextResponse.json({ rows: [], total: 0, page, pageSize });

  const { rows, total } = await listDeals(user.id, {
    pipelineId,
    q: sp.get('q') ?? undefined,
    stageId: sp.get('stageId') ?? undefined,
    priority: sp.get('priority') ?? undefined,
    sort: sortParam(sp, SORTS),
    page,
    pageSize,
  });

  return NextResponse.json({ rows, total, page, pageSize });
}

export async function POST(req: NextRequest) {
  const user = await getCurrentUser();
  if (!user) return unauthorized();

  const body: unknown = await req.json().catch(() => null);
  const parsed = dealCreateSchema.safeParse(body);
  if (!parsed.success) return invalidBody(parsed.error);

  const result = await createDeal(user.id, parsed.data);
  if (!result.ok) {
    return crmError(400, result.reason === 'invalid_stage' ? 'invalid_stage' : 'invalid_input');
  }
  return NextResponse.json(result.deal, { status: 201 });
}
