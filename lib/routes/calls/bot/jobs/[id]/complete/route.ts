import { after, NextRequest } from 'next/server';
import { z } from 'zod';
import { authBot, completeBotJob } from '@/lib/calls/bot';
import { processCall } from '@/lib/calls/process';
import { callsLimit, cFail, cJson, parseBody } from '@/lib/calls/http';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const schema = z.object({
  endReason: z.string().max(40).optional(),
  durationMs: z.number().min(0).max(86_400_000),
  video: z.object({ parts: z.number().int().min(0), bytes: z.number().int().min(0), mime: z.string().max(80) }).nullable(),
  audio: z.object({ segments: z.number().int().min(0), mime: z.string().max(80) }).nullable(),
  speakers: z.array(z.object({ name: z.string().max(200), startMs: z.number(), endMs: z.number() })).max(50_000).optional(),
  captions: z.array(z.object({ speaker: z.string().max(200), text: z.string().max(4000), startMs: z.number() })).max(50_000).optional(),
  participants: z.array(z.object({ name: z.string().max(200) })).max(200).optional(),
});

/** POST: el bot terminó de subir; la llamada se transcribe y analiza enseguida (o en el cron). */
export async function POST(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const limited = await callsLimit(req, 'bot-complete', 120, 60);
  if (limited) return limited;
  const { id } = await ctx.params;
  const row = await authBot(req, id);
  if (!row) return cJson({ error: 'unauthorized' }, 401);
  try {
    await completeBotJob(row, await parseBody(req, schema));
    after(() => processCall(id).catch(() => null));
    return cJson({ ok: true });
  } catch (err) {
    return cFail(err);
  }
}
