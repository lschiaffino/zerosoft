import { NextRequest } from 'next/server';
import { z } from 'zod';
import { moveApplication, reactivateApplication, rejectApplication, requireVisibleApp } from '@/lib/hiring/candidates';
import { hFail, hiringActor, hJson, readJson } from '@/lib/hiring/http';
import { HiringError } from '@/lib/hiring/types';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

type Ctx = { params: Promise<{ id: string }> };

export async function GET(_req: NextRequest, { params }: Ctx) {
  const a = await hiringActor();
  if ('res' in a) return a.res;
  try {
    const { app } = await requireVisibleApp(a.actor, (await params).id);
    return hJson({ application: { id: app.id, jobId: app.job_id, candidateId: app.candidate_id, stageId: app.stage_id, status: app.status, source: app.source } });
  } catch (err) {
    return hFail(err);
  }
}

const schema = z.discriminatedUnion('action', [
  z.object({ action: z.literal('move'), stageId: z.string().min(1).max(80) }),
  z.object({ action: z.literal('reject'), reason: z.string().trim().max(300).default(''), sendEmail: z.boolean().default(false), templateId: z.string().max(80).nullable().default(null) }),
  z.object({ action: z.literal('reactivate') }),
]);

/** PATCH { action: move | reject | reactivate }: lo decide una persona del equipo (nunca la IA). */
export async function PATCH(req: NextRequest, { params }: Ctx) {
  const a = await hiringActor();
  if ('res' in a) return a.res;
  try {
    const parsed = schema.safeParse(await readJson(req));
    if (!parsed.success) throw new HiringError('invalid_input');
    const id = (await params).id;
    const body = parsed.data;
    const app =
      body.action === 'move'
        ? await moveApplication(a.actor, id, body.stageId)
        : body.action === 'reject'
          ? await rejectApplication(a.actor, id, body)
          : await reactivateApplication(a.actor, id);
    return hJson({ application: { id: app.id, stageId: app.stage_id, status: app.status } });
  } catch (err) {
    return hFail(err);
  }
}
