import { NextRequest } from 'next/server';
import { disableShare, enableShare } from '@/lib/calls/core';
import { callsActor, callsLimit, cFail, cJson } from '@/lib/calls/http';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

type Ctx = { params: Promise<{ id: string }> };

/** POST: prende (o rota) el link público de solo lectura de la llamada. */
export async function POST(req: NextRequest, ctx: Ctx) {
  const a = await callsActor();
  if ('res' in a) return a.res;
  const limited = await callsLimit(req, 'share', 60, 3600, a.actor.person);
  if (limited) return limited;
  try {
    const { id } = await ctx.params;
    return cJson({ token: await enableShare(a.actor, id) });
  } catch (err) {
    return cFail(err);
  }
}

/** DELETE: apaga el link público (deja de abrir enseguida). */
export async function DELETE(_req: NextRequest, ctx: Ctx) {
  const a = await callsActor();
  if ('res' in a) return a.res;
  try {
    const { id } = await ctx.params;
    await disableShare(a.actor, id);
    return cJson({ ok: true });
  } catch (err) {
    return cFail(err);
  }
}
