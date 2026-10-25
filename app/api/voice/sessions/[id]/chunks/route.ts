import { NextRequest, NextResponse } from 'next/server';
import { voiceAuth } from '@/lib/voice-route';
import { readAudio, voiceErrorResponse, voiceJsonError } from '@/lib/voice-http';
import { ingestChunk } from '@/lib/voice-service';
import { VOICE_SOURCES, type VoiceSource } from '@/lib/voice-types';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 120;

/**
 * Un trozo de audio de la reunión (multipart: audio, source me|them|mixed,
 * seq, offsetMs, durationMs). Devuelve los segmentos transcritos. El audio no
 * se guarda.
 */
export async function POST(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const auth = await voiceAuth({ bucket: 'chunk', limit: 120 });
  if (auth.res) return auth.res;
  try {
    const { bytes, type, fields } = await readAudio(req);
    const source = String(fields.get('source') ?? 'mixed');
    const seq = Number(fields.get('seq'));
    const offsetMs = Number(fields.get('offsetMs'));
    const durationMs = Number(fields.get('durationMs'));
    if (!(VOICE_SOURCES as readonly string[]).includes(source) || !Number.isInteger(seq) || seq < 0 || seq > 10_000_000) {
      return voiceJsonError(400, 'invalid_input');
    }
    const res = await ingestChunk({
      owner: auth.owner,
      sessionId: id,
      source: source as VoiceSource,
      seq,
      offsetMs: Number.isFinite(offsetMs) && offsetMs >= 0 ? offsetMs : 0,
      durationMs: Number.isFinite(durationMs) && durationMs > 0 ? Math.min(durationMs, 600_000) : 0,
      audio: bytes,
      type,
    });
    return NextResponse.json(res, { status: res.duplicate ? 200 : 201 });
  } catch (err) {
    return voiceErrorResponse(err);
  }
}
