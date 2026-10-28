/**
 * Voice: helpers de las rutas (sesión y API v1). Server-only.
 */
import { NextResponse } from 'next/server';
import { AiError } from './ai';
import { VoiceTranscribeError } from './voice-transcribe';
import { VoiceError } from './voice';
import { isVoiceAudioType, VOICE_CHUNK_MAX_BYTES } from './voice-types';
import type { MeetingLabels } from './voice-integrations';
import en from '@/messages/en/voice.json';
import es from '@/messages/es/voice.json';
import pt from '@/messages/pt/voice.json';

const MESSAGES = { en, es, pt } as const;

export function voiceMessages(locale: string | null | undefined) {
  return MESSAGES[(locale ?? 'en') as keyof typeof MESSAGES] ?? MESSAGES.en;
}

export function meetingLabels(locale: string | null | undefined): MeetingLabels {
  const m = voiceMessages(locale).export;
  return {
    me: m.me,
    them: m.them,
    speaker: m.speaker,
    summary: m.summary,
    decisions: m.decisions,
    actionItems: m.actionItems,
    myNotes: m.myNotes,
    transcript: m.transcript,
    fromVoice: m.fromVoice,
    privateSpace: m.privateSpace,
  };
}

/** Recipes o transforms de fábrica en el idioma pedido (messages/<locale>/voice.json › prompts). */
export function builtinPrompts(locale: string | null | undefined, kind: 'recipe' | 'transform'): Record<string, { name: string; prompt: string }> {
  const p = voiceMessages(locale).prompts;
  return (kind === 'recipe' ? p.recipes : p.transforms) as Record<string, { name: string; prompt: string }>;
}

export function voiceJsonError(status: number, code: string): NextResponse {
  return NextResponse.json({ error: code }, { status });
}

/** Error conocido → respuesta con código; el resto, 500 sin detalles. */
export function voiceErrorResponse(err: unknown): NextResponse {
  if (err instanceof AiError) {
    const res = voiceJsonError(err.code === 'ai_disabled' ? 503 : 429, err.code);
    // El grabador reintenta el trozo cuando pasa la ventana del rate limit.
    if (err.code === 'rate_limited') res.headers.set('retry-after', '20');
    return res;
  }
  if (err instanceof VoiceTranscribeError) {
    const status = err.code === 'transcribe_disabled' ? 503 : err.code === 'audio_too_large' ? 413 : err.code === 'audio_type' || err.code === 'empty_audio' ? 400 : 502;
    return voiceJsonError(status, err.code);
  }
  if (err instanceof VoiceError) {
    const status = err.code === 'not_found' ? 404 : err.code === 'duplicate' || err.code === 'not_recorder' || err.code === 'recording_elsewhere' || err.code === 'docs_private_unavailable' ? 409 : 400;
    return voiceJsonError(status, err.code);
  }
  console.error('[voice] request failed', err instanceof Error ? err.name : 'error');
  return voiceJsonError(500, 'server_error');
}

export interface AudioUpload {
  bytes: Uint8Array;
  type: string;
  fields: FormData;
}

/**
 * Lee el audio de un multipart (campo "audio"). Chequea tamaño y tipo antes
 * de leer todo el cuerpo cuando el navegador manda content-length.
 */
export async function readAudio(req: Request, maxBytes = VOICE_CHUNK_MAX_BYTES): Promise<AudioUpload> {
  const len = Number(req.headers.get('content-length') || 0);
  if (len && len > maxBytes + 64 * 1024) throw new VoiceTranscribeError('audio_too_large');
  let form: FormData;
  try {
    form = await req.formData();
  } catch {
    throw new VoiceTranscribeError('empty_audio');
  }
  const file = form.get('audio');
  if (!file || typeof file === 'string') throw new VoiceTranscribeError('empty_audio');
  if (file.size > maxBytes) throw new VoiceTranscribeError('audio_too_large');
  if (!file.size) throw new VoiceTranscribeError('empty_audio');
  const type = file.type || 'audio/webm';
  if (!isVoiceAudioType(type)) throw new VoiceTranscribeError('audio_type');
  return { bytes: new Uint8Array(await file.arrayBuffer()), type, fields: form };
}

/** Texto del modo fake: la cookie voice_fake_text deja a los e2e elegir qué "se dijo". */
export async function fakeTextFromRequest(): Promise<string | undefined> {
  if (process.env.VERCEL_ENV === 'production') return undefined;
  try {
    const { cookies } = await import('next/headers');
    const v = (await cookies()).get('voice_fake_text')?.value;
    return v ? decodeURIComponent(v).slice(0, 2000) : undefined;
  } catch {
    return undefined;
  }
}
