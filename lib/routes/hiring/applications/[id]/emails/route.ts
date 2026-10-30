import { NextRequest } from 'next/server';
import { z } from 'zod';
import { personName, requireManageApp } from '@/lib/hiring/candidates';
import { sendCandidateEmail } from '@/lib/hiring/comms';
import { hFail, hiringActor, hiringLimit, hJson, parseBody } from '@/lib/hiring/http';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

type Ctx = { params: Promise<{ id: string }> };

/** POST { subject, body }: email al candidato desde la app (con variables {{…}}). La respuesta vuelve a la línea de tiempo. */
export async function POST(req: NextRequest, { params }: Ctx) {
  const a = await hiringActor();
  if ('res' in a) return a.res;
  const limited = await hiringLimit(req, 'email', 60, 600, a.actor.person);
  if (limited) return limited;
  try {
    const input = await parseBody(req, z.object({ subject: z.string().trim().min(1).max(300), body: z.string().trim().min(1).max(20_000) }));
    const { app, job, candidate } = await requireManageApp(a.actor, (await params).id);
    const res = await sendCandidateEmail(a.actor.ws, { candidate, job, applicationId: app.id, senderName: await personName(a.actor.person) }, input, a.actor.person);
    return hJson({ ok: res.ok }, res.ok ? 201 : 502);
  } catch (err) {
    return hFail(err);
  }
}
