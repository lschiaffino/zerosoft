import { NextRequest } from 'next/server';
import { deleteJob, getJob, jobInputSchema, updateJob } from '@/lib/hiring/core';
import { hFail, hiringActor, hJson, readJson } from '@/lib/hiring/http';
import { HiringError } from '@/lib/hiring/types';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

type Ctx = { params: Promise<{ id: string }> };

export async function GET(_req: NextRequest, { params }: Ctx) {
  const a = await hiringActor();
  if ('res' in a) return a.res;
  const job = await getJob(a.actor, (await params).id);
  return job ? hJson(job) : hJson({ error: 'not_found' }, 404);
}

/** PATCH: datos del puesto, preguntas y estado (draft, published, closed, archived). */
export async function PATCH(req: NextRequest, { params }: Ctx) {
  const a = await hiringActor();
  if ('res' in a) return a.res;
  try {
    const parsed = jobInputSchema.partial().safeParse(await readJson(req));
    if (!parsed.success) throw new HiringError('invalid_input');
    return hJson(await updateJob(a.actor, (await params).id, parsed.data));
  } catch (err) {
    return hFail(err);
  }
}

export async function DELETE(_req: NextRequest, { params }: Ctx) {
  const a = await hiringActor();
  if ('res' in a) return a.res;
  try {
    await deleteJob(a.actor, (await params).id);
    return hJson({ ok: true });
  } catch (err) {
    return hFail(err);
  }
}
