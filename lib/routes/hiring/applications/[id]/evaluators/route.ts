import { NextRequest } from 'next/server';
import { evaluatorsSchema, setEvaluators } from '@/lib/hiring/evaluation';
import { hFail, hiringActor, hJson, parseBody } from '@/lib/hiring/http';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

type Ctx = { params: Promise<{ id: string }> };

/** PUT { stageId, userIds }: quién evalúa esta postulación (personas del equipo del puesto). */
export async function PUT(req: NextRequest, { params }: Ctx) {
  const a = await hiringActor();
  if ('res' in a) return a.res;
  try {
    await setEvaluators(a.actor, (await params).id, await parseBody(req, evaluatorsSchema));
    return hJson({ ok: true });
  } catch (err) {
    return hFail(err);
  }
}
