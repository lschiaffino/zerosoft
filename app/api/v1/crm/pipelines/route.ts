import { NextRequest, NextResponse } from 'next/server';
import { requireApiUser } from '@/lib/api-auth';
import { listPipelinesWithStages } from '@/lib/crm';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** Pipelines del workspace con sus etapas (para elegir pipelineId/stageId al crear deals). */
export async function GET(req: NextRequest) {
  const auth = await requireApiUser(req, 'crm:read');
  if ('res' in auth) return auth.res;

  const pipelines = await listPipelinesWithStages(auth.user.id);
  return NextResponse.json({
    pipelines: pipelines.map((p) => ({
      id: p.id,
      name: p.name,
      position: p.position,
      stages: p.stages.map((s) => ({
        id: s.id,
        name: s.name,
        position: s.position,
        probability: s.probability,
        isWon: s.is_won === 1,
        isLost: s.is_lost === 1,
      })),
    })),
  });
}
