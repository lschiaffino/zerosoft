import { NextRequest, NextResponse } from 'next/server';
import { requireApiUser, apiError } from '@/lib/api-auth';
import { getDb, type CrmStageRow } from '@/lib/db';
import { getDeal } from '@/lib/crm';
import { moveDealWithFields } from '@/lib/crm-stage-move';
import { CrmRefError } from '@/lib/crm-refs';
import { dealMoveSchema } from '@/lib/crm-schema';
import { cleanRow, zodErrorCode, apiGuardRecord } from '@/lib/crm-http';
import { apiScope } from '@/lib/crm-visibility';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** Mover un deal a otra etapa de su pipeline (ganado/perdido incluidos). */
export async function POST(req: NextRequest, props: { params: Promise<{ id: string }> }) {
  const params = await props.params;
  const auth = await requireApiUser(req, 'crm:write');
  if ('res' in auth) return auth.res;
  const hidden = await apiGuardRecord(auth.user.id, 'deal', params.id, await apiScope(auth));
  if (hidden) return hidden;

  const body: unknown = await req.json().catch(() => null);
  const parsed = dealMoveSchema.safeParse(body);
  if (!parsed.success) return apiError(400, zodErrorCode(parsed.error), 'The request body is not valid.');
  const { stageId, lostReason, fields } = parsed.data;

  const detail = await getDeal(auth.user.id, params.id);
  if (!detail) return apiError(404, 'not_found', 'Deal not found.');
  const stage = (await getDb()
    .prepare('SELECT * FROM crm_stages WHERE id = ? AND pipeline_id = ?')
    .get(stageId, detail.deal.pipeline_id)) as CrmStageRow | undefined;
  if (!stage) return apiError(400, 'invalid_stage', "That stage doesn't belong to the deal's pipeline.");
  if (stage.is_lost && lostReason === undefined && !detail.deal.lost_reason) {
    return apiError(400, 'missing_lost_reason', 'Moving a deal to a lost stage needs lostReason.');
  }
  let result;
  try {
    result = await moveDealWithFields(auth.user.id, params.id, { stageId, lostReason, fields }, auth.user.email);
  } catch (err) {
    if (err instanceof CrmRefError) return apiError(400, err.code, 'A referenced record is not valid.');
    throw err;
  }
  if (!result.ok) {
    if (result.reason === 'missing_required') {
      return NextResponse.json(
        {
          error: {
            code: 'missing_required',
            message: `The stage "${stage.name}" requires these properties: ${result.missing.join(', ')}. Send them in "fields" or set them first.`,
            missing: result.missing,
          },
        },
        { status: 422 },
      );
    }
    return result.reason === 'not_found'
      ? apiError(404, 'not_found', 'Deal not found.')
      : apiError(400, 'invalid_stage', "That stage doesn't belong to the deal's pipeline.");
  }
  return NextResponse.json(cleanRow(result.deal));
}
