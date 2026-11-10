import { NextRequest } from 'next/server';
import { z } from 'zod';
import { deleteClip, updateClip } from '@/lib/calls/core';
import { callsActor, cFail, cJson, parseBody } from '@/lib/calls/http';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

type Ctx = { params: Promise<{ id: string; clipId: string }> };

/** PATCH: renombrar un clip. */
export async function PATCH(req: NextRequest, ctx: Ctx) {
  const a = await callsActor();
  if ('res' in a) return a.res;
  try {
    const { id, clipId } = await ctx.params;
    await updateClip(a.actor, id, clipId, await parseBody(req, z.object({ title: z.string().trim().min(1).max(200) })));
    return cJson({ ok: true });
  } catch (err) {
    return cFail(err);
  }
}

/** DELETE: borra un clip (quien lo armó, quien grabó o un admin). */
export async function DELETE(_req: NextRequest, ctx: Ctx) {
  const a = await callsActor();
  if ('res' in a) return a.res;
  try {
    const { id, clipId } = await ctx.params;
    await deleteClip(a.actor, id, clipId);
    return cJson({ ok: true });
  } catch (err) {
    return cFail(err);
  }
}
