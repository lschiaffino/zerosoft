import { NextRequest } from 'next/server';
import { z } from 'zod';
import { createClip } from '@/lib/calls/core';
import { callsActor, callsLimit, cFail, cJson, parseBody } from '@/lib/calls/http';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const schema = z.object({ title: z.string().trim().min(1).max(200), startMs: z.number().int().min(0), endMs: z.number().int().min(1) });

/** POST: clip (un tramo con nombre) para compartir dentro del workspace. */
export async function POST(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const a = await callsActor();
  if ('res' in a) return a.res;
  const limited = await callsLimit(req, 'clip', 200, 3600, a.actor.person);
  if (limited) return limited;
  try {
    const { id } = await ctx.params;
    return cJson({ clip: await createClip(a.actor, id, await parseBody(req, schema)) }, 201);
  } catch (err) {
    return cFail(err);
  }
}
