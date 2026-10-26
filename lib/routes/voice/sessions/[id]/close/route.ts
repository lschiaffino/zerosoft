import { NextRequest, NextResponse } from 'next/server';
import { voiceAuth } from '@/lib/voice-route';
import { voiceJsonError } from '@/lib/voice-http';
import { closeRecording, getSessionRow } from '@/lib/voice';
import { queueNoteAfterResponse } from '@/lib/voice-jobs';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * Cierra una grabación en curso y deja la nota con IA en cola. Lo manda el
 * grabador con navigator.sendBeacon al cerrar la pestaña (POST sin cuerpo) o
 * cuando la grabación se corta por un error.
 */
export async function POST(_req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const auth = await voiceAuth({ bucket: 'write' });
  if (auth.res) return auth.res;
  const row = await getSessionRow(auth.owner, id);
  if (!row || row.kind !== 'meeting') return voiceJsonError(404, 'not_found');
  const res = await closeRecording(id, { queueNotes: true });
  if (res.queued) await queueNoteAfterResponse(id);
  return NextResponse.json(res);
}
