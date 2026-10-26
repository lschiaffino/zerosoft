import { NextRequest } from 'next/server';
import { deleteComment } from '@/lib/rec';
import { actorOf, publicVideoFor, recFail, resolveViewer } from '@/lib/rec-http';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** Borrar un comentario: quien lo escribió o quien administra el video. */
export async function DELETE(req: NextRequest, ctx: { params: Promise<{ share: string; cid: string }> }) {
  const { share, cid } = await ctx.params;
  const r = await publicVideoFor(req, share);
  if ('res' in r) return r.res;
  const { viewer, user } = await resolveViewer(req, r.v);
  try {
    await deleteComment(r.v, cid, viewer, user ? actorOf(user) : null);
    return new Response(null, { status: 204 });
  } catch (err) {
    return recFail(err);
  }
}
