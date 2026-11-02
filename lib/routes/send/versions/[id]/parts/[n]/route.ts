import { NextRequest } from 'next/server';
import { storePart } from '@/lib/send/core';
import { sendActor, sendLimit, sFail, sJson } from '@/lib/send/http';
import { PART_BYTES } from '@/lib/send/types';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** PUT: una parte del archivo (cuerpo crudo, hasta 4 MB). */
export async function PUT(req: NextRequest, ctx: { params: Promise<{ id: string; n: string }> }) {
  const a = await sendActor();
  if ('res' in a) return a.res;
  const limited = await sendLimit(req, 'part', 1200, 3600, a.actor.person);
  if (limited) return limited;
  try {
    const { id, n } = await ctx.params;
    if (Number(req.headers.get('content-length') ?? 0) > PART_BYTES) return sJson({ error: 'invalid_part' }, 413);
    await storePart(a.actor, id, Number(n), Buffer.from(await req.arrayBuffer()));
    return sJson({ ok: true });
  } catch (err) {
    return sFail(err);
  }
}
