import { NextRequest } from 'next/server';
import { stopCall } from '@/lib/calls/schedule';
import { callsActor, cFail, cJson } from '@/lib/calls/http';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** POST: el bot sale de la reunión (y sube lo grabado), o no va si todavía no entró. */
export async function POST(_req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const a = await callsActor();
  if ('res' in a) return a.res;
  try {
    const { id } = await ctx.params;
    await stopCall(a.actor, id);
    return cJson({ ok: true });
  } catch (err) {
    return cFail(err);
  }
}
