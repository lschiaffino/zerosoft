/**
 * Voice: transcripción de audio con proveedor por env. Server-only.
 *
 * VOICE_TRANSCRIBE_PROVIDER:
 * - gateway (default): AI SDK `experimental_transcribe` por Vercel AI Gateway
 *   (misma credencial que el resto de la IA). Modelo en VOICE_TRANSCRIBE_MODEL
 *   (default openai/whisper-1).
 * - openai: API de OpenAI directo con OPENAI_API_KEY (whisper-1 por defecto).
 * - deepgram: DEEPGRAM_API_KEY, nova-3 con separación de hablantes.
 * - assemblyai: ASSEMBLYAI_API_KEY, con separación de hablantes.
 * - fake: texto fijo para tests (nunca en un deploy de producción).
 *
 * Todas pasan por la cuota y el registro de lib/ai.ts (feature
 * voice_transcribe): cada segundo de audio cuenta como 10 tokens, un
 * equivalente aproximado para que la cuota del workspace también frene la
 * transcripción.
 */
import { experimental_transcribe as transcribe, gateway } from 'ai';
import { aiEnabled, AiError, assertAiMonthlyQuota, recordAiUsage } from './ai';
import { rateLimit } from './rate-limit';

export type TranscribeProvider = 'gateway' | 'openai' | 'deepgram' | 'assemblyai' | 'fake';

export interface TranscriptPiece {
  text: string;
  startMs: number;
  endMs: number;
  /** Hablante que devolvió el proveedor ('' si no separa hablantes). */
  speaker: string;
}

export interface TranscriptResult {
  text: string;
  language: string;
  durationMs: number;
  pieces: TranscriptPiece[];
  provider: TranscribeProvider;
}

export type VoiceErrorCode = 'transcribe_disabled' | 'transcribe_failed' | 'audio_too_large' | 'audio_type' | 'empty_audio';

export class VoiceTranscribeError extends Error {
  constructor(public code: VoiceErrorCode) {
    super(code);
    this.name = 'VoiceTranscribeError';
  }
}

/** Trozos por minuto y workspace (VOICE_TRANSCRIBE_RATE_PER_MINUTE, default 120). */
export function transcribeRatePerMinute(): number {
  const n = Number(process.env.VOICE_TRANSCRIBE_RATE_PER_MINUTE);
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : 120;
}

/** Tokens equivalentes por segundo de audio (cuota y ai_usage). */
export const TOKENS_PER_AUDIO_SECOND = 10;

export function transcribeProvider(): TranscribeProvider {
  const raw = (process.env.VOICE_TRANSCRIBE_PROVIDER ?? '').trim().toLowerCase();
  if (raw === 'fake') return process.env.VERCEL_ENV === 'production' ? 'gateway' : 'fake';
  if (raw === 'openai' || raw === 'deepgram' || raw === 'assemblyai') return raw;
  return 'gateway';
}

export function transcribeModel(provider = transcribeProvider()): string {
  const env = process.env.VOICE_TRANSCRIBE_MODEL?.trim();
  if (env) return env;
  if (provider === 'gateway') return 'openai/whisper-1';
  if (provider === 'openai') return 'whisper-1';
  if (provider === 'deepgram') return 'nova-3';
  if (provider === 'assemblyai') return 'universal';
  return 'fake';
}

/** ¿Hay con qué transcribir? (la UI lo muestra antes de grabar). */
export function transcriptionConfigured(provider = transcribeProvider()): boolean {
  switch (provider) {
    case 'fake':
      return true;
    case 'gateway':
      return aiEnabled();
    case 'openai':
      return Boolean(process.env.OPENAI_API_KEY?.trim());
    case 'deepgram':
      return Boolean(process.env.DEEPGRAM_API_KEY?.trim());
    case 'assemblyai':
      return Boolean(process.env.ASSEMBLYAI_API_KEY?.trim());
  }
}

/** ¿El proveedor separa hablantes dentro de una misma pista? */
export function providerDiarizes(provider = transcribeProvider()): boolean {
  return provider === 'deepgram' || provider === 'assemblyai' || provider === 'fake';
}

export interface TranscribeInput {
  workspaceId: string;
  audio: Uint8Array;
  mimeType: string;
  /** 'auto' o ISO-639-1. */
  language?: string;
  /** Palabras del diccionario para sesgar el reconocimiento. */
  vocabulary?: string[];
  /** Duración que midió el cliente (si el proveedor no la devuelve). */
  durationHintMs?: number;
  /** Solo para el modo fake: qué devolver. */
  fakeText?: string;
  fakeSpeakers?: boolean;
}

function lang(input: TranscribeInput): string | undefined {
  const l = input.language?.trim().toLowerCase();
  return l && l !== 'auto' ? l : undefined;
}

/** Texto del modo fake (sin "um" ni autocorrecciones resueltos: los limpia la otra capa). */
export const FAKE_DICTATION = 'um so the launch is on monday, no, I mean tuesday and we need three things first the landing second the email and third the demo';
export const FAKE_MEETING_ME = 'I think the price should be twenty dollars per seat. Let us decide the launch date today.';
export const FAKE_MEETING_THEM = 'Ana here. Twenty dollars works for us if we get annual billing. We agree to launch on Tuesday and I will send the contract by Friday.';

function fakeResult(input: TranscribeInput): TranscriptResult {
  const text = input.fakeText ?? FAKE_DICTATION;
  const durationMs = input.durationHintMs && input.durationHintMs > 0 ? input.durationHintMs : 4000;
  if (!input.fakeSpeakers) {
    return { text, language: lang(input) ?? 'en', durationMs, pieces: [{ text, startMs: 0, endMs: durationMs, speaker: '' }], provider: 'fake' };
  }
  const sentences = text.match(/[^.!?]+[.!?]?/g)?.map((s) => s.trim()).filter(Boolean) ?? [text];
  const step = Math.floor(durationMs / sentences.length);
  return {
    text,
    language: lang(input) ?? 'en',
    durationMs,
    pieces: sentences.map((s, i) => ({ text: s, startMs: i * step, endMs: (i + 1) * step, speaker: String(i % 2) })),
    provider: 'fake',
  };
}

async function viaGateway(input: TranscribeInput, model: string): Promise<Omit<TranscriptResult, 'provider'>> {
  const language = lang(input);
  const res = await transcribe({
    model: gateway.transcription(model),
    audio: input.audio,
    maxRetries: 1,
    providerOptions: {
      openai: {
        ...(language ? { language } : {}),
        ...(input.vocabulary?.length ? { prompt: input.vocabulary.join(', ').slice(0, 800) } : {}),
      },
    },
  });
  const durationMs = Math.round((res.durationInSeconds ?? 0) * 1000) || input.durationHintMs || 0;
  const pieces = res.segments.length
    ? res.segments.map((s) => ({ text: s.text.trim(), startMs: Math.round(s.startSecond * 1000), endMs: Math.round(s.endSecond * 1000), speaker: '' }))
    : [{ text: res.text.trim(), startMs: 0, endMs: durationMs, speaker: '' }];
  return { text: res.text.trim(), language: res.language ?? language ?? '', durationMs, pieces };
}

function extFor(mime: string): string {
  const m = mime.split(';')[0].trim().toLowerCase();
  if (m.includes('webm')) return 'webm';
  if (m.includes('ogg')) return 'ogg';
  if (m.includes('mpeg')) return 'mp3';
  if (m.includes('wav')) return 'wav';
  if (m.includes('flac')) return 'flac';
  if (m.includes('mp4') || m.includes('m4a') || m.includes('aac')) return 'm4a';
  return 'webm';
}

async function viaOpenAi(input: TranscribeInput, model: string): Promise<Omit<TranscriptResult, 'provider'>> {
  const form = new FormData();
  const type = input.mimeType.split(';')[0];
  form.append('file', new Blob([input.audio as BlobPart], { type }), `audio.${extFor(type)}`);
  form.append('model', model);
  const language = lang(input);
  if (language) form.append('language', language);
  if (input.vocabulary?.length) form.append('prompt', input.vocabulary.join(', ').slice(0, 800));
  const verbose = model.startsWith('whisper');
  form.append('response_format', verbose ? 'verbose_json' : 'json');
  const res = await fetch('https://api.openai.com/v1/audio/transcriptions', {
    method: 'POST',
    headers: { authorization: `Bearer ${process.env.OPENAI_API_KEY}` },
    body: form,
    signal: AbortSignal.timeout(120_000),
  });
  if (!res.ok) throw new VoiceTranscribeError('transcribe_failed');
  const data = (await res.json()) as {
    text?: string;
    language?: string;
    duration?: number;
    segments?: Array<{ start: number; end: number; text: string }>;
  };
  const durationMs = Math.round((data.duration ?? 0) * 1000) || input.durationHintMs || 0;
  const text = (data.text ?? '').trim();
  const pieces = data.segments?.length
    ? data.segments.map((s) => ({ text: s.text.trim(), startMs: Math.round(s.start * 1000), endMs: Math.round(s.end * 1000), speaker: '' }))
    : [{ text, startMs: 0, endMs: durationMs, speaker: '' }];
  return { text, language: data.language ?? language ?? '', durationMs, pieces };
}

async function viaDeepgram(input: TranscribeInput, model: string): Promise<Omit<TranscriptResult, 'provider'>> {
  const params = new URLSearchParams({ model, smart_format: 'true', punctuate: 'true', diarize: 'true', utterances: 'true' });
  const language = lang(input);
  if (language) params.set('language', language);
  else params.set('detect_language', 'true');
  for (const w of (input.vocabulary ?? []).slice(0, 50)) params.append('keyterm', w);
  const res = await fetch(`https://api.deepgram.com/v1/listen?${params}`, {
    method: 'POST',
    headers: { authorization: `Token ${process.env.DEEPGRAM_API_KEY}`, 'content-type': input.mimeType.split(';')[0] },
    body: input.audio as BodyInit,
    signal: AbortSignal.timeout(120_000),
  });
  if (!res.ok) throw new VoiceTranscribeError('transcribe_failed');
  const data = (await res.json()) as {
    metadata?: { duration?: number };
    results?: {
      channels?: Array<{ detected_language?: string; alternatives?: Array<{ transcript?: string }> }>;
      utterances?: Array<{ start: number; end: number; transcript: string; speaker?: number }>;
    };
  };
  const channel = data.results?.channels?.[0];
  const text = (channel?.alternatives?.[0]?.transcript ?? '').trim();
  const durationMs = Math.round((data.metadata?.duration ?? 0) * 1000) || input.durationHintMs || 0;
  const utterances = data.results?.utterances ?? [];
  const pieces = utterances.length
    ? utterances.map((u) => ({ text: u.transcript.trim(), startMs: Math.round(u.start * 1000), endMs: Math.round(u.end * 1000), speaker: u.speaker === undefined ? '' : String(u.speaker) }))
    : [{ text, startMs: 0, endMs: durationMs, speaker: '' }];
  return { text, language: channel?.detected_language ?? language ?? '', durationMs, pieces };
}

async function viaAssembly(input: TranscribeInput, model: string): Promise<Omit<TranscriptResult, 'provider'>> {
  const key = process.env.ASSEMBLYAI_API_KEY ?? '';
  const base = 'https://api.assemblyai.com/v2';
  const up = await fetch(`${base}/upload`, {
    method: 'POST',
    headers: { authorization: key, 'content-type': 'application/octet-stream' },
    body: input.audio as BodyInit,
    signal: AbortSignal.timeout(120_000),
  });
  if (!up.ok) throw new VoiceTranscribeError('transcribe_failed');
  const { upload_url } = (await up.json()) as { upload_url: string };
  const language = lang(input);
  const created = await fetch(`${base}/transcript`, {
    method: 'POST',
    headers: { authorization: key, 'content-type': 'application/json' },
    body: JSON.stringify({
      audio_url: upload_url,
      speech_model: model,
      speaker_labels: true,
      ...(language ? { language_code: language } : { language_detection: true }),
      ...(input.vocabulary?.length ? { word_boost: input.vocabulary.slice(0, 100) } : {}),
    }),
    signal: AbortSignal.timeout(30_000),
  });
  if (!created.ok) throw new VoiceTranscribeError('transcribe_failed');
  const { id } = (await created.json()) as { id: string };
  const deadline = Date.now() + 240_000;
  while (Date.now() < deadline) {
    await new Promise((r) => setTimeout(r, 2000));
    const poll = await fetch(`${base}/transcript/${id}`, { headers: { authorization: key }, signal: AbortSignal.timeout(30_000) });
    if (!poll.ok) throw new VoiceTranscribeError('transcribe_failed');
    const data = (await poll.json()) as {
      status: string;
      text?: string;
      language_code?: string;
      audio_duration?: number;
      utterances?: Array<{ start: number; end: number; text: string; speaker?: string }>;
    };
    if (data.status === 'error') throw new VoiceTranscribeError('transcribe_failed');
    if (data.status !== 'completed') continue;
    const text = (data.text ?? '').trim();
    const durationMs = Math.round((data.audio_duration ?? 0) * 1000) || input.durationHintMs || 0;
    const pieces = data.utterances?.length
      ? data.utterances.map((u) => ({ text: u.text.trim(), startMs: u.start, endMs: u.end, speaker: u.speaker ?? '' }))
      : [{ text, startMs: 0, endMs: durationMs, speaker: '' }];
    return { text, language: data.language_code ?? language ?? '', durationMs, pieces };
  }
  throw new VoiceTranscribeError('transcribe_failed');
}

/**
 * Transcribe un audio. Tira VoiceTranscribeError (sin proveedor, falló) o
 * AiError (cuota, rate limit) para que la ruta devuelva el código.
 */
export async function transcribeAudio(input: TranscribeInput): Promise<TranscriptResult> {
  if (!input.audio.byteLength) throw new VoiceTranscribeError('empty_audio');
  const provider = transcribeProvider();
  if (!transcriptionConfigured(provider)) {
    throw provider === 'gateway' ? new AiError('ai_disabled') : new VoiceTranscribeError('transcribe_disabled');
  }
  await assertAiMonthlyQuota(input.workspaceId);
  // Rate limit propio de la transcripción (más alto que el del chat): una reunión
  // con dos pistas manda unos 6 trozos por minuto por persona.
  if (process.env.RATE_LIMIT_DISABLED !== 'true') {
    const res = await rateLimit(`ai:transcribe:${input.workspaceId}`, transcribeRatePerMinute(), 60);
    if (!res.ok) throw new AiError('rate_limited');
  }
  const model = transcribeModel(provider);
  let result: Omit<TranscriptResult, 'provider'>;
  try {
    if (provider === 'fake') result = fakeResult(input);
    else if (provider === 'openai') result = await viaOpenAi(input, model);
    else if (provider === 'deepgram') result = await viaDeepgram(input, model);
    else if (provider === 'assemblyai') result = await viaAssembly(input, model);
    else result = await viaGateway(input, model);
  } catch (err) {
    if (err instanceof VoiceTranscribeError || err instanceof AiError) throw err;
    console.error('[voice] transcribe failed', provider, err instanceof Error ? err.message : 'error');
    throw new VoiceTranscribeError('transcribe_failed');
  }
  await recordAiUsage({
    workspaceId: input.workspaceId,
    feature: 'voice_transcribe',
    model: `${provider}/${model}`,
    inputTokens: Math.ceil((result.durationMs || 1000) / 1000) * TOKENS_PER_AUDIO_SECOND,
    outputTokens: 0,
  }).catch(() => {});
  return { ...result, pieces: result.pieces.filter((p) => p.text), provider };
}
