import { NextRequest } from 'next/server';
import { requireVisibleApp, scorecardsFor, visibleScorecards } from '@/lib/hiring/candidates';
import { scorecardSchema, submitScorecard } from '@/lib/hiring/evaluation';
import { hFail, hiringActor, hJson, parseBody } from '@/lib/hiring/http';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

type Ctx = { params: Promise<{ id: string }> };

/** GET: los scorecards que la persona puede ver (un interviewer ve los ajenos recién después de enviar el suyo). */
export async function GET(_req: NextRequest, { params }: Ctx) {
  const a = await hiringActor();
  if ('res' in a) return a.res;
  try {
    const { app, access } = await requireVisibleApp(a.actor, (await params).id);
    const { visible, hidden } = visibleScorecards(await scorecardsFor(app.id), { admin: a.actor.admin, jobRole: access.jobRole, person: a.actor.person });
    return hJson({ scorecards: visible, hidden });
  } catch (err) {
    return hFail(err);
  }
}

/** POST { stageId, ratings, overall, notes }: envía (o actualiza) mi scorecard de la etapa. */
export async function POST(req: NextRequest, { params }: Ctx) {
  const a = await hiringActor();
  if ('res' in a) return a.res;
  try {
    return hJson(await submitScorecard(a.actor, (await params).id, await parseBody(req, scorecardSchema)), 201);
  } catch (err) {
    return hFail(err);
  }
}
