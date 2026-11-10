import { NextRequest } from 'next/server';
import { z } from 'zod';
import { addComment } from '@/lib/calls/core';
import { callsActor, callsLimit, cFail, cJson, parseBody } from '@/lib/calls/http';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const schema = z.object({ body: z.string().trim().min(1).max(4000), atMs: z.number().int().min(0).max(86_400_000).nullable().optional() });

/** POST: comentario en la llamada, en un momento (atMs) o general. */
export async function POST(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const a = await callsActor();
  if ('res' in a) return a.res;
  const limited = await callsLimit(req, 'comment', 300, 3600, a.actor.person);
  if (limited) return limited;
  try {
    const { id } = await ctx.params;
    return cJson({ comment: await addComment(a.actor, id, await parseBody(req, schema)) }, 201);
  } catch (err) {
    return cFail(err);
  }
}
