import { NextRequest } from 'next/server';
import { requireVisibleApp } from '@/lib/hiring/candidates';
import { createSchedulingLink, listInterviews, scheduleSchema } from '@/lib/hiring/interviews';
import { hFail, hiringActor, hJson, parseBody } from '@/lib/hiring/http';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

type Ctx = { params: Promise<{ id: string }> };

/** GET: entrevistas de la postulación (sincronizadas con las reservas de Cal). */
export async function GET(_req: NextRequest, { params }: Ctx) {
  const a = await hiringActor();
  if ('res' in a) return a.res;
  try {
    const { app, access } = await requireVisibleApp(a.actor, (await params).id);
    // El link de agenda es del candidato: solo lo ve quien gestiona el puesto.
    const list = await listInterviews(a.actor.ws, app.id);
    return hJson({ interviews: access.manage ? list : list.map((i) => ({ ...i, link: null })) });
  } catch (err) {
    return hFail(err);
  }
}

/** POST { stageId?, durationMin, sendEmail }: link de auto-agenda de Cal con la disponibilidad de los evaluadores. */
export async function POST(req: NextRequest, { params }: Ctx) {
  const a = await hiringActor();
  if ('res' in a) return a.res;
  try {
    return hJson(await createSchedulingLink(a.actor, (await params).id, await parseBody(req, scheduleSchema)), 201);
  } catch (err) {
    return hFail(err);
  }
}
