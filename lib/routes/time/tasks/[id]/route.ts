import { NextRequest } from 'next/server';
import { deleteTask, updateTask } from '@/lib/time/core';
import { parseBody, tFail, timeActor, tJson, type Ctx } from '@/lib/time/http';
import { namedSchema } from '@/lib/time/schemas';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** PATCH: renombrar, archivar o restaurar (solo quien administra). */
export async function PATCH(req: NextRequest, { params }: Ctx) {
  const a = await timeActor();
  if ('res' in a) return a.res;
  try {
    await updateTask(a.actor, (await params).id, await parseBody(req, namedSchema));
    return tJson({ ok: true });
  } catch (err) {
    return tFail(err);
  }
}

export async function DELETE(_req: NextRequest, { params }: Ctx) {
  const a = await timeActor();
  if ('res' in a) return a.res;
  try {
    await deleteTask(a.actor, (await params).id);
    return tJson({ ok: true });
  } catch (err) {
    return tFail(err);
  }
}
