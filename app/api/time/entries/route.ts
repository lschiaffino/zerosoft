import { NextRequest } from 'next/server';
import { z } from 'zod';
import { createEntry, listMyEntries } from '@/lib/time/core';
import { parseBody, tFail, timeActor, timeLimit, tJson } from '@/lib/time/http';
import { MAX_ENTRY_MINUTES, MAX_NOTES } from '@/lib/time/types';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** GET ?from=YYYY-MM-DD&to=YYYY-MM-DD: las entradas de la persona en ese rango. */
export async function GET(req: NextRequest) {
  const a = await timeActor();
  if ('res' in a) return a.res;
  try {
    const sp = req.nextUrl.searchParams;
    return tJson({ entries: await listMyEntries(a.actor, sp.get('from') ?? '', sp.get('to') ?? '') });
  } catch (err) {
    return tFail(err);
  }
}

const schema = z.object({
  date: z.string().max(10),
  projectId: z.string().min(1).max(80),
  taskId: z.string().min(1).max(200),
  notes: z.string().max(MAX_NOTES).optional(),
  minutes: z.number().int().min(0).max(MAX_ENTRY_MINUTES).nullable().optional(),
  start: z.boolean().optional(),
});

/** POST: entrada nueva. Sin `minutes` (o con `start`), arranca el cronómetro. */
export async function POST(req: NextRequest) {
  const a = await timeActor();
  if ('res' in a) return a.res;
  const limited = await timeLimit(req, 'entry', 600, 3600, a.actor.person);
  if (limited) return limited;
  try {
    return tJson({ entry: await createEntry(a.actor, await parseBody(req, schema)) }, 201);
  } catch (err) {
    return tFail(err);
  }
}
