import type { NextRequest } from 'next/server';
import { hFail, hiringActor, hiringLimit, hJson, parseBody } from '@/lib/hiring/http';
import { copySchema, copyToJob } from '@/lib/hiring/transfer';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

type Ctx = { params: Promise<{ id: string }> };

/** POST { jobId, move }: copia (o mueve) la postulación a otro puesto. Hay que gestionar los dos. */
export async function POST(req: NextRequest, { params }: Ctx) {
  const a = await hiringActor();
  if ('res' in a) return a.res;
  try {
    return hJson(await copyToJob(a.actor, (await params).id, await parseBody(req, copySchema)), 201);
  } catch (err) {
    return hFail(err);
  }
}
