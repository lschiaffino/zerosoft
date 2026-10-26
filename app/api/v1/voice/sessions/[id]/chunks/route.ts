import { NextRequest, NextResponse } from 'next/server';
import { voiceApiAuth, v1Error, v1ErrorResponse } from '@/lib/voice-v1';
import { readAudio } from '@/lib/voice-http';
import { ingestChunk } from '@/lib/voice-service';
import { VOICE_SOURCES, type VoiceSource } from '@/lib/voice-types';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 120;

/**
 * POST /api/v1/voice/sessions/:id/chunks (voice:write). Multipart: audio
 * (hasta 4 MB), source (me = micrófono, them = audio del sistema, mixed),
 * seq (número de trozo por fuente, desde 0), offsetMs y durationMs.
 * Idempotente por (source, seq): un reintento devuelve duplicate: true.
 */
export async function POST(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const auth = await voiceApiAuth(req, 'voice:write');
  if (auth.res) return auth.res;
  try {
    const { bytes, type, fields } = await readAudio(req);
    const source = String(fields.get('source') ?? 'mixed');
    const seq = Number(fields.get('seq'));
    if (!(VOICE_SOURCES as readonly string[]).includes(source) || !Number.isInteger(seq) || seq < 0 || seq > 10_000_000) {
      return v1Error(400, 'invalid_input');
    }
    const offsetMs = Number(fields.get('offsetMs'));
    const durationMs = Number(fields.get('durationMs'));
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
    return NextResponse.json({ data: res }, { status: res.duplicate ? 200 : 201 });
  } catch (err) {
    return v1ErrorResponse(err);
  }
}
