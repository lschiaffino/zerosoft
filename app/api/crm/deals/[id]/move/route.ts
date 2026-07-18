import { NextRequest, NextResponse } from 'next/server';
import { getCurrentUser } from '@/lib/session';
import { getDb, type CrmStageRow } from '@/lib/db';
import { getDeal, moveDeal } from '@/lib/crm';
import { dealMoveSchema } from '@/lib/crm-schema';
import { crmError, invalidBody, notFound, unauthorized } from '@/lib/crm-http';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  const user = await getCurrentUser();
  if (!user) return unauthorized();

  const body: unknown = await req.json().catch(() => null);
  const parsed = dealMoveSchema.safeParse(body);
  if (!parsed.success) return invalidBody(parsed.error);

  const { stageId, beforeId, lostReason } = parsed.data;

  const detail = await getDeal(user.id, params.id);
  if (!detail) return notFound();

  // El stage destino tiene que pertenecer al pipeline del deal.
  const stage = (await getDb()
    .prepare('SELECT * FROM crm_stages WHERE id = ? AND pipeline_id = ?')
    .get(stageId, detail.deal.pipeline_id)) as CrmStageRow | undefined;
  if (!stage) return crmError(400, 'invalid_stage');

  // Cerrar como perdido exige motivo (en el payload o ya cargado en el deal).
  if (stage.is_lost && lostReason === undefined && !detail.deal.lost_reason) {
    return crmError(400, 'missing_lost_reason');
  }

  const result = await moveDeal(user.id, params.id, stageId, beforeId ?? null, lostReason);
  if (!result.ok) {
    return result.reason === 'not_found' ? notFound() : crmError(400, 'invalid_stage');
  }
  return NextResponse.json(result.deal);
}
