import { NextRequest, NextResponse } from 'next/server';
import { voiceApiAuth, v1ErrorResponse } from '@/lib/voice-v1';
import { readAudio } from '@/lib/voice-http';
import { dictate } from '@/lib/voice-service';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 60;

/**
 * POST /api/v1/voice/dictate (voice:write). Multipart: audio (webm, ogg, wav,
 * m4a, mp3; hasta 4 MB), context (email|chat|note|other), sourceApp,
 * durationMs. Transcribe, limpia y guarda en el historial de dictados.
 * La app de escritorio pega `data.text` en la app activa.
 */
export async function POST(req: NextRequest) {
  const auth = await voiceApiAuth(req, 'voice:write');
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
      capture: 'desktop',
    });
    return NextResponse.json({ data: { id: res.session.id, text: res.text, raw: res.raw, ai: res.ai } }, { status: 201 });
  } catch (err) {
    return v1ErrorResponse(err);
  }
}
