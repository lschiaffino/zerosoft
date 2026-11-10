import { NextRequest } from 'next/server';
import { storeUploadPart } from '@/lib/calls/core';
import { callsActor, callsLimit, cFail, cJson } from '@/lib/calls/http';
import { PART_BYTES } from '@/lib/calls/types';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** PUT: una parte de la grabación subida (cuerpo crudo, hasta 4 MB). */
export async function PUT(req: NextRequest, ctx: { params: Promise<{ id: string; n: string }> }) {
  const a = await callsActor();
  if ('res' in a) return a.res;
  const limited = await callsLimit(req, 'part', 1200, 3600, a.actor.person);
  if (limited) return limited;
  try {
    const { id, n } = await ctx.params;
    if (Number(req.headers.get('content-length') ?? 0) > PART_BYTES) return cJson({ error: 'invalid_part' }, 413);
    await storeUploadPart(a.actor, id, Number(n), Buffer.from(await req.arrayBuffer()));
    return cJson({ ok: true });
  } catch (err) {
    return cFail(err);
  }
}
