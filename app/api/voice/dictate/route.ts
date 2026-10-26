import { NextRequest, NextResponse } from 'next/server';
import { voiceAuth } from '@/lib/voice-route';
import { fakeTextFromRequest, readAudio, voiceErrorResponse } from '@/lib/voice-http';
import { dictate } from '@/lib/voice-service';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 60;

/**
 * Dictado: multipart con audio, context (email|chat|note|other), sourceApp
 * y durationMs. Transcribe, limpia con IA (o por reglas si no hay IA) y lo
 * guarda en el historial. Devuelve { text, raw, ai, aiError, session }.
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
      fakeText: await fakeTextFromRequest(),
    });
    return NextResponse.json(res, { status: 201 });
  } catch (err) {
    return voiceErrorResponse(err);
  }
}
