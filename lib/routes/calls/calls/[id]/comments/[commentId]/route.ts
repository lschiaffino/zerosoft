import { NextRequest } from 'next/server';
import { deleteComment } from '@/lib/calls/core';
import { callsActor, cFail, cJson } from '@/lib/calls/http';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** DELETE: borra un comentario (quien lo escribió, quien grabó o un admin). */
export async function DELETE(_req: NextRequest, ctx: { params: Promise<{ id: string; commentId: string }> }) {
  const a = await callsActor();
  if ('res' in a) return a.res;
  try {
    const { id, commentId } = await ctx.params;
    await deleteComment(a.actor, id, commentId);
    return cJson({ ok: true });
  } catch (err) {
    return cFail(err);
  }
}
