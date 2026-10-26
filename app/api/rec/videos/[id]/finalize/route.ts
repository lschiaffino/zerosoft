import { after, NextRequest } from 'next/server';
import { z } from 'zod';
import { finalizeVideo, getVideoRow, toDto } from '@/lib/rec';
import { recActor, recFail, recJson } from '@/lib/rec-http';
import { processRecVideo } from '@/lib/rec-ai';
import { recAiForcedOff } from '@/lib/rec-ai-flags';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 300;

const schema = z.object({
  durationSec: z.number().min(0).max(12 * 3600),
  width: z.number().min(0).max(10_000).optional(),
  height: z.number().min(0).max(10_000).optional(),
});

/** Grabación lista: pasa a la biblioteca y se transcribe después de responder. */
export async function POST(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const s = await recActor();
  if ('res' in s) return s.res;
  const { id } = await ctx.params;
  const parsed = schema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return recJson({ error: 'invalid_input' }, 400);
  try {
    await finalizeVideo(s.actor, id, parsed.data);
    const forceOff = await recAiForcedOff();
    after(() => processRecVideo(id, { forceOff }).catch(() => null));
    const v = await getVideoRow(s.actor, id);
    return recJson({ video: toDto(v!, s.actor) });
  } catch (err) {
    return recFail(err);
  }
}
