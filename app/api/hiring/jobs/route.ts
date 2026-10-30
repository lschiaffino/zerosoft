import { NextRequest } from 'next/server';
import { createJob, jobInputSchema, listJobs } from '@/lib/hiring/core';
import { hFail, hiringActor, hJson, parseBody } from '@/lib/hiring/http';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** GET ?status=&q=: puestos del workspace (el conteo de candidatos, solo para quien gestiona el puesto). */
export async function GET(req: NextRequest) {
  const a = await hiringActor();
  if ('res' in a) return a.res;
  const sp = req.nextUrl.searchParams;
  return hJson({ jobs: await listJobs(a.actor, { status: sp.get('status') ?? undefined, q: sp.get('q') ?? undefined }) });
}

/** POST: puesto nuevo en borrador (con `template`, desde una plantilla). Quien lo crea queda como recruiter. */
export async function POST(req: NextRequest) {
  const a = await hiringActor();
  if ('res' in a) return a.res;
  try {
    const input = await parseBody(req, jobInputSchema);
    const locale = req.headers.get('x-locale') ?? 'en';
    return hJson(await createJob(a.actor, input, locale), 201);
  } catch (err) {
    return hFail(err);
  }
}
