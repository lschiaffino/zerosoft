import { after, NextRequest } from 'next/server';
import { getVideoRow, requeueTranscript, toDto } from '@/lib/rec';
import { recActor, recFail, recJson } from '@/lib/rec-http';
import { processRecVideo } from '@/lib/rec-ai';
import { recAiForcedOff } from '@/lib/rec-ai-flags';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 300;

/** Volver a transcribir y generar título, resumen y capítulos. */
export async function POST(_req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const s = await recActor();
  if ('res' in s) return s.res;
  const { id } = await ctx.params;
  try {
    await requeueTranscript(s.actor, id);
    const forceOff = await recAiForcedOff();
    after(() => processRecVideo(id, { forceOff }).catch(() => null));
    const v = await getVideoRow(s.actor, id);
    return recJson({ video: toDto(v!, s.actor) });
  } catch (err) {
    return recFail(err);
  }
}
