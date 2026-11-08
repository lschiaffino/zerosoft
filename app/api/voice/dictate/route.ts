import { after, NextRequest, NextResponse } from 'next/server';
import { voiceAuth } from '@/lib/voice-route';
import { fakeTextFromRequest, readAudio, voiceErrorResponse } from '@/lib/voice-http';
import { dictate } from '@/lib/voice-service';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 60;

/**
 * Dictado: multipart con audio, context (email|chat|note|other), sourceApp
 * durationMs y capture (mic | desktop, la app de escritorio). Transcribe, limpia con IA (o por reglas si no hay IA) y lo
 * guarda en el historial. Devuelve { text, raw, ai, aiError, session, timings }.
 * fast=1 (la app de escritorio, que pega el texto apenas llega): frases cortas
 * por reglas, la IA con tope de tiempo y el historial guardado después de
 * contestar. Server-Timing dice dónde se fue el tiempo.
 */
export async function POST(req: NextRequest) {
  const auth = await voiceAuth({ bucket: 'dictate', limit: 60 });
  if (auth.res) return auth.res;
  try {
    const { bytes, type, fields } = await readAudio(req);
    const res = await dictate({
      owner: auth.owner,
      audio: bytes,
      type,
      context: String(fields.get('context') ?? 'other'),
      sourceApp: String(fields.get('sourceApp') ?? '').slice(0, 200),
      durationMs: Number(fields.get('durationMs')) || 0,
      capture: fields.get('capture') === 'desktop' ? 'desktop' : 'mic',
      fakeText: await fakeTextFromRequest(),
      fast: fields.get('fast') === '1',
      later: (job) => after(() => job().then(() => undefined).catch((err) => console.error('[voice] save dictation failed', err instanceof Error ? err.message : 'error'))),
    });
    const t = res.timings;
    const timing = `setup;dur=${t.setupMs}, transcribe;dur=${t.transcribeMs}, cleanup;dur=${t.cleanupMs}, save;dur=${t.saveMs}, total;dur=${t.totalMs}`;
    return NextResponse.json(res, { status: 201, headers: { 'server-timing': timing } });
  } catch (err) {
    return voiceErrorResponse(err);
  }
}
