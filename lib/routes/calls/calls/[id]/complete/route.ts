import { after, NextRequest } from 'next/server';
import { z } from 'zod';
import { completeUpload } from '@/lib/calls/core';
import { processCall } from '@/lib/calls/process';
import { callsActor, cFail, cJson, parseBody } from '@/lib/calls/http';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** POST: terminó la subida; la grabación se transcribe y analiza (ahora o en el cron). */
export async function POST(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const a = await callsActor();
  if ('res' in a) return a.res;
  try {
    const { id } = await ctx.params;
    const input = await parseBody(req, z.object({ durationMs: z.number().int().min(0).max(86_400_000).optional() }));
    await completeUpload(a.actor, id, input.durationMs ?? 0);
    after(() => processCall(id).catch(() => null));
    return cJson({ ok: true });
  } catch (err) {
    return cFail(err);
  }
}
