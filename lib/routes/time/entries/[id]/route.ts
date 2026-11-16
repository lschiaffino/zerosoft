import { NextRequest } from 'next/server';
import { z } from 'zod';
import { deleteEntry, updateEntry } from '@/lib/time/core';
import { parseBody, tFail, timeActor, tJson, type Ctx } from '@/lib/time/http';
import { MAX_ENTRY_MINUTES, MAX_NOTES } from '@/lib/time/types';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const schema = z.object({
  date: z.string().max(10).optional(),
  projectId: z.string().min(1).max(80).optional(),
  taskId: z.string().min(1).max(200).optional(),
  notes: z.string().max(MAX_NOTES).optional(),
  minutes: z.number().int().min(0).max(MAX_ENTRY_MINUTES).optional(),
  running: z.boolean().optional(),
});

/** PATCH: editar una entrada propia, o arrancar (`running: true`) y parar (`running: false`) su cronómetro. */
export async function PATCH(req: NextRequest, { params }: Ctx) {
  const a = await timeActor();
  if ('res' in a) return a.res;
  try {
    return tJson({ entry: await updateEntry(a.actor, (await params).id, await parseBody(req, schema)) });
  } catch (err) {
    return tFail(err);
  }
}

export async function DELETE(_req: NextRequest, { params }: Ctx) {
  const a = await timeActor();
  if ('res' in a) return a.res;
  try {
    await deleteEntry(a.actor, (await params).id);
    return tJson({ ok: true });
  } catch (err) {
    return tFail(err);
  }
}
