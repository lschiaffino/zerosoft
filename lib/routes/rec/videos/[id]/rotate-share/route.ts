import { NextRequest } from 'next/server';
import { rotateShareId, getVideoRow, toDto } from '@/lib/rec';
import { recActor, recFail, recJson } from '@/lib/rec-http';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** Link nuevo: el anterior deja de andar, también para quien ya lo había abierto. */
export async function POST(_req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const s = await recActor();
  if ('res' in s) return s.res;
  const { id } = await ctx.params;
  try {
    await rotateShareId(s.actor, id);
    const v = await getVideoRow(s.actor, id);
    return recJson({ video: toDto(v!, s.actor) });
  } catch (err) {
    return recFail(err);
  }
}
