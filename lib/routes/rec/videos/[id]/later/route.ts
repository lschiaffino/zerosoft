import { NextRequest } from 'next/server';
import { setWatchLater } from '@/lib/rec';
import { recActor, recFail, recJson } from '@/lib/rec-http';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

type Ctx = { params: Promise<{ id: string }> };

/** "Ver más tarde" de quien pide (cualquiera que pueda ver el video). */
export async function POST(_req: NextRequest, ctx: Ctx) {
  const s = await recActor();
  if ('res' in s) return s.res;
  const { id } = await ctx.params;
  try {
    await setWatchLater(s.actor, id, true);
    return recJson({ ok: true });
  } catch (err) {
    return recFail(err);
  }
}

export async function DELETE(_req: NextRequest, ctx: Ctx) {
  const s = await recActor();
  if ('res' in s) return s.res;
  const { id } = await ctx.params;
  try {
    await setWatchLater(s.actor, id, false);
    return recJson({ ok: true });
  } catch (err) {
    return recFail(err);
  }
}
