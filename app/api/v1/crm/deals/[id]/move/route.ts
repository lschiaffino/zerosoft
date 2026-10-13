import { NextRequest, NextResponse } from 'next/server';
import { requireApiUser, apiError } from '@/lib/api-auth';
import { getDb, type CrmStageRow } from '@/lib/db';
import { getDeal, moveDeal } from '@/lib/crm';
import { dealMoveSchema } from '@/lib/crm-schema';
import { cleanRow, zodErrorCode } from '@/lib/crm-http';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** Mover un deal a otra etapa de su pipeline (ganado/perdido incluidos). */
export async function POST(req: NextRequest, props: { params: Promise<{ id: string }> }) {
  const params = await props.params;
  const auth = await requireApiUser(req);
  if ('res' in auth) return auth.res;

  const body: unknown = await req.json().catch(() => null);
  const parsed = dealMoveSchema.safeParse(body);
  if (!parsed.success) return apiError(400, zodErrorCode(parsed.error), 'The request body is not valid.');
  const { stageId, lostReason } = parsed.data;

  const detail = await getDeal(auth.user.id, params.id);
  if (!detail) return apiError(404, 'not_found', 'Deal not found.');
  const stage = (await getDb()
    .prepare('SELECT * FROM crm_stages WHERE id = ? AND pipeline_id = ?')
    .get(stageId, detail.deal.pipeline_id)) as CrmStageRow | undefined;
  if (!stage) return apiError(400, 'invalid_stage', "That stage doesn't belong to the deal's pipeline.");
  if (stage.is_lost && lostReason === undefined && !detail.deal.lost_reason) {
    return apiError(400, 'missing_lost_reason', 'Moving a deal to a lost stage needs lostReason.');
  }
  const result = await moveDeal(auth.user.id, params.id, stageId, null, lostReason, auth.user.email);
  if (!result.ok) {
    return result.reason === 'not_found'
      ? apiError(404, 'not_found', 'Deal not found.')
      : apiError(400, 'invalid_stage', "That stage doesn't belong to the deal's pipeline.");
  }
  return NextResponse.json(cleanRow(result.deal));
}
