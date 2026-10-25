/**
 * Rec: transcripción, título, resumen y capítulos automáticos (como Loom AI).
 * Server-only.
 *
 * Transcripción con proveedor por env (REC_TRANSCRIBE_PROVIDER, o el de
 * Voice VOICE_TRANSCRIBE_PROVIDER si está): `gateway` (AI SDK transcribe por
 * el AI Gateway, el default), `openai` (OPENAI_API_KEY), `deepgram`
 * (DEEPGRAM_API_KEY) o `fake` (e2e). Título, resumen y capítulos con
 * lib/ai.ts (aiGenerateObject). Todo pasa por la cuota, el rate limit y
 * ai_usage del workspace: con la IA apagada queda `disabled` con el código
 * ai_disabled y la UI lo explica.
 *
 * Se corre después de cerrar la grabación (after() en la ruta) y el cron de
 * cada minuto levanta lo que haya quedado en cola. Cada video se reclama con
 * compare-and-set sobre transcript_status para no procesarlo dos veces.
 */
import { readFile } from 'fs/promises';
import { generateText, Output } from 'ai';
import { z } from 'zod';
import { AiError, aiEnabled, aiGenerateObject, assertAiAvailable, assertAiQuota, recordAiUsage } from './ai';
import { fakeModel } from './crm-ai-fake';
import { getDb } from './db';
import { localUploadPath } from './uploads';
import { cleanSegments, fmtClock, normalizeChapters, type RecChapter, type RecSegment } from './rec-schema';
import type { RecVideoRow } from './rec';

export type TranscribeProvider = 'gateway' | 'openai' | 'deepgram' | 'fake';

/** Whisper (Gateway y OpenAI) acepta hasta 25 MB por archivo. */
const WHISPER_MAX_BYTES = 25 * 1024 * 1024;
const DEEPGRAM_MAX_BYTES = 1024 * 1024 * 1024;
/** Estimación para la cuota: el audio no trae tokens; ~16 por segundo. */
const TOKENS_PER_AUDIO_SECOND = 16;

/** En e2e (REC_AI_FAKE=1, nunca en producción) todo corre contra el modelo falso. */
export function recAiFake(): boolean {
  return process.env.REC_AI_FAKE === '1' && process.env.VERCEL_ENV !== 'production';
}

export function transcribeProvider(): TranscribeProvider {
  if (recAiFake()) return 'fake';
  const raw = (process.env.REC_TRANSCRIBE_PROVIDER || process.env.VOICE_TRANSCRIBE_PROVIDER || 'gateway').trim().toLowerCase();
  return raw === 'openai' || raw === 'deepgram' || raw === 'fake' ? raw : 'gateway';
}

/** ¿Hay con qué transcribir? (la UI lo muestra antes de grabar). */
export function transcriptionConfigured(): boolean {
  const p = transcribeProvider();
  if (p === 'fake') return true;
  if (p === 'openai') return !!process.env.OPENAI_API_KEY?.trim();
  if (p === 'deepgram') return !!process.env.DEEPGRAM_API_KEY?.trim();
  return aiEnabled();
}

async function readAudio(url: string): Promise<Uint8Array> {
  const local = localUploadPath(url, 'rec');
  if (local) return new Uint8Array(await readFile(local));
  if (!/^https:\/\/[^/]+\.blob\.vercel-storage\.com\//.test(url)) throw new Error('invalid_audio_url');
  const { readRecBlob } = await import('./rec-upload');
  return readRecBlob(url);
}

/** Transcripción falsa para e2e: un segmento cada 5 s, en el idioma del workspace no importa. */
export function fakeSegments(durationSec: number): RecSegment[] {
  const n = Math.max(1, Math.min(24, Math.ceil(Math.max(1, durationSec) / 5)));
  return Array.from({ length: n }, (_, i) => ({
    start: i * 5,
    end: Math.min((i + 1) * 5, Math.max(durationSec, (i + 1) * 5)),
    text: i === 0 ? 'Hi, this is a quick walkthrough of the new onboarding.' : `Here is step ${i + 1} of the walkthrough.`,
  }));
}

async function transcribeWithProvider(
  provider: TranscribeProvider,
  audio: Uint8Array,
  mediaType: string,
  durationSec: number,
): Promise<{ segments: RecSegment[]; language: string | null; model: string }> {
  if (provider === 'fake') return { segments: fakeSegments(durationSec), language: 'en', model: 'rec-fake' };
  if (provider === 'deepgram') {
    if (audio.length > DEEPGRAM_MAX_BYTES) throw new Error('audio_too_large');
    const model = process.env.REC_DEEPGRAM_MODEL?.trim() || 'nova-3';
    const res = await fetch(`https://api.deepgram.com/v1/listen?model=${encodeURIComponent(model)}&smart_format=true&utterances=true&detect_language=true`, {
      method: 'POST',
      headers: { authorization: `Token ${process.env.DEEPGRAM_API_KEY}`, 'content-type': mediaType },
      body: Buffer.from(audio),
      signal: AbortSignal.timeout(300_000),
    });
    if (!res.ok) throw new Error('transcribe_failed');
    const data = (await res.json()) as {
      results?: { utterances?: Array<{ start: number; end: number; transcript: string }>; channels?: Array<{ detected_language?: string }> };
    };
    const segments = cleanSegments((data.results?.utterances ?? []).map((u) => ({ start: u.start, end: u.end, text: u.transcript })));
    return { segments, language: data.results?.channels?.[0]?.detected_language ?? null, model: `deepgram/${model}` };
  }
  if (audio.length > WHISPER_MAX_BYTES) throw new Error('audio_too_large');
  if (provider === 'openai') {
    const model = process.env.REC_TRANSCRIBE_MODEL?.trim()?.replace(/^openai\//, '') || 'whisper-1';
    const form = new FormData();
    const ext = mediaType.includes('mp4') ? 'm4a' : mediaType.includes('ogg') ? 'ogg' : 'webm';
    form.set('file', new Blob([Buffer.from(audio)], { type: mediaType }), `audio.${ext}`);
    form.set('model', model);
    form.set('response_format', 'verbose_json');
    form.append('timestamp_granularities[]', 'segment');
    const res = await fetch('https://api.openai.com/v1/audio/transcriptions', {
      method: 'POST',
      headers: { authorization: `Bearer ${process.env.OPENAI_API_KEY}` },
      body: form,
      signal: AbortSignal.timeout(300_000),
    });
    if (!res.ok) throw new Error('transcribe_failed');
    const data = (await res.json()) as { language?: string; segments?: Array<{ start: number; end: number; text: string }>; text?: string };
    const segments = data.segments?.length ? cleanSegments(data.segments) : cleanSegments([{ start: 0, end: durationSec, text: data.text ?? '' }]);
    return { segments, language: data.language ?? null, model: `openai/${model}` };
  }
  const { transcribe, gateway } = await import('ai');
  const modelId = process.env.REC_TRANSCRIBE_MODEL?.trim() || 'openai/whisper-1';
  const result = await transcribe({ model: gateway.transcriptionModel(modelId), audio, maxRetries: 1 });
  const segments = result.segments.length
    ? cleanSegments(result.segments.map((s) => ({ start: s.startSecond, end: s.endSecond, text: s.text })))
    : cleanSegments([{ start: 0, end: durationSec, text: result.text }]);
  return { segments, language: result.language ?? null, model: modelId };
}

/** Transcribe por la cuota del workspace. `forceOff` = el request pidió comportarse como sin IA (e2e). */
export async function transcribeForWorkspace(
  ws: string,
  audio: Uint8Array,
  mediaType: string,
  durationSec: number,
  opts: { forceOff?: boolean } = {},
): Promise<{ segments: RecSegment[]; language: string | null }> {
  if (opts.forceOff) throw new AiError('ai_disabled');
  const provider = transcribeProvider();
  if (provider === 'gateway') await assertAiAvailable(ws);
  else if (!transcriptionConfigured()) throw new AiError('ai_disabled');
  else await assertAiQuota(ws);
  const out = await transcribeWithProvider(provider, audio, mediaType, durationSec);
  await recordAiUsage({
    workspaceId: ws,
    feature: 'rec_transcribe',
    model: out.model,
    inputTokens: Math.round(Math.max(1, durationSec) * TOKENS_PER_AUDIO_SECOND),
    outputTokens: Math.round(out.segments.reduce((s, x) => s + x.text.length, 0) / 4),
  }).catch(() => {});
  return { segments: out.segments, language: out.language };
}

const summarySchema = z.object({
  title: z.string().min(1).max(120),
  summary: z.string().max(1500),
  chapters: z.array(z.object({ start: z.number().min(0), title: z.string().min(1).max(80) })).max(20),
});
export type RecSummary = z.infer<typeof summarySchema>;

export function summaryPrompt(segments: RecSegment[], durationSec: number): string {
  const lines: string[] = [];
  let size = 0;
  for (const s of segments) {
    const line = `[${fmtClock(s.start)}] ${s.text}`;
    size += line.length;
    if (size > 40_000) break;
    lines.push(line);
  }
  return [
    `Transcript of a recorded screen video (${fmtClock(durationSec)} long). Write in the language of the transcript.`,
    '- title: a short, specific title (max 8 words), no quotes.',
    '- summary: 2 to 4 sentences on what the video covers and what the viewer should do.',
    `- chapters: only if the video is 60 seconds or longer. The first chapter starts at 0. Each chapter at least 20 seconds long. Starts in seconds, within 0 and ${Math.floor(durationSec)}. Otherwise an empty list.`,
    'Only use what is in the transcript.',
    '',
    ...lines,
  ].join('\n');
}

export function fakeSummary(segments: RecSegment[], durationSec: number): RecSummary {
  return {
    title: 'Onboarding walkthrough',
    summary: `A short walkthrough with ${segments.length} parts. ${segments[0]?.text ?? ''}`.trim(),
    chapters: durationSec >= 60 ? [{ start: 0, title: 'Intro' }, { start: Math.floor(durationSec / 2), title: 'Walkthrough' }] : [],
  };
}

export async function summarizeTranscript(
  ws: string,
  segments: RecSegment[],
  durationSec: number,
  opts: { forceOff?: boolean } = {},
): Promise<RecSummary> {
  if (opts.forceOff) throw new AiError('ai_disabled');
  if (recAiFake()) {
    await assertAiQuota(ws);
    const result = await generateText({
      model: fakeModel(() => ({ text: JSON.stringify(fakeSummary(segments, durationSec)) })),
      prompt: summaryPrompt(segments, durationSec),
      output: Output.object({ schema: summarySchema }),
    });
    await recordAiUsage({ workspaceId: ws, feature: 'rec_summary', model: 'rec-fake', inputTokens: result.totalUsage?.inputTokens ?? 0, outputTokens: result.totalUsage?.outputTokens ?? 0 }).catch(() => {});
    return result.output as RecSummary;
  }
  const res = await aiGenerateObject({
    workspaceId: ws,
    feature: 'rec_summary',
    prompt: summaryPrompt(segments, durationSec),
    schema: summarySchema,
    maxOutputTokens: 900,
    temperature: 0.2,
    timeoutMs: 60_000,
  });
  return res.object;
}

function dbNow(offsetMs = 0): string {
  return new Date(Date.now() + offsetMs).toISOString().slice(0, 19).replace('T', ' ');
}

/**
 * Procesa un video en cola: transcribe y, si hay texto, genera título (si la
 * persona no lo cambió), resumen y capítulos (si no los escribió a mano).
 * Devuelve el estado final o null si otro proceso ya lo tenía.
 */
export async function processRecVideo(id: string, opts: { forceOff?: boolean } = {}): Promise<string | null> {
  const db = getDb();
  const claim = await db
    .prepare(
      `UPDATE rec_videos SET transcript_status = 'processing', processing_at = ?
       WHERE id = ? AND status = 'ready' AND (transcript_status = 'pending' OR (transcript_status = 'processing' AND processing_at < ?))`,
    )
    .run(dbNow(), id, dbNow(-15 * 60_000));
  if (!claim.changes) return null;
  const v = (await db.prepare('SELECT * FROM rec_videos WHERE id = ?').get(id)) as RecVideoRow | undefined;
  if (!v) return null;
  const finish = async (status: string, error: string | null) => {
    await db.prepare('UPDATE rec_videos SET transcript_status = ?, transcript_error = ?, processing_at = NULL WHERE id = ?').run(status, error, id);
    return status;
  };
  try {
    const source = v.audio_url ?? v.url;
    if (!source) return await finish('failed', 'no_audio');
    const mediaType = v.audio_url ? (v.audio_url.endsWith('.m4a') ? 'audio/mp4' : v.audio_url.endsWith('.ogg') ? 'audio/ogg' : 'audio/webm') : v.content_type;
    const audio = transcribeProvider() === 'fake' ? new Uint8Array(0) : await readAudio(source);
    const { segments, language } = await transcribeForWorkspace(v.workspace_id, audio, mediaType, v.duration_sec, opts);
    await db.prepare('UPDATE rec_videos SET transcript = ?, transcript_lang = ? WHERE id = ?').run(JSON.stringify(segments), language, id);
    if (segments.length) {
      try {
        const s = await summarizeTranscript(v.workspace_id, segments, v.duration_sec, opts);
        const fresh = (await db.prepare('SELECT title_source, chapters_source FROM rec_videos WHERE id = ?').get(id)) as Pick<RecVideoRow, 'title_source' | 'chapters_source'>;
        const chapters: RecChapter[] = v.duration_sec >= 60 ? normalizeChapters(s.chapters, v.duration_sec) : [];
        await db
          .prepare(
            `UPDATE rec_videos SET summary = ?,
               title = CASE WHEN ? = 'auto' THEN ? ELSE title END,
               chapters = CASE WHEN ? = 'auto' AND ? > 0 THEN ? ELSE chapters END,
               updated_at = datetime('now') WHERE id = ?`,
          )
          .run(s.summary.trim(), fresh.title_source, s.title.trim().slice(0, 200), fresh.chapters_source, chapters.length, JSON.stringify(chapters), id);
      } catch (err) {
        // Sin resumen la transcripción igual sirve; se anota el motivo.
        const code = err instanceof AiError ? err.code : 'summary_failed';
        return await finish('done', code);
      }
    }
    return await finish('done', null);
  } catch (err) {
    if (err instanceof AiError) return finish(err.code === 'ai_disabled' ? 'disabled' : 'failed', err.code);
    const msg = err instanceof Error && /^[a-z_]+$/.test(err.message) ? err.message : 'transcribe_failed';
    console.error('[rec] transcribe', id, err instanceof Error ? err.message : err);
    return finish('failed', msg);
  }
}

/** Cron: lo que quedó en cola (o colgado más de 15 min). */
export async function processPendingRec(opts: { limit?: number; budgetMs?: number } = {}): Promise<{ processed: number }> {
  const start = Date.now();
  const rows = (await getDb()
    .prepare(
      `SELECT id FROM rec_videos WHERE status = 'ready' AND (transcript_status = 'pending' OR (transcript_status = 'processing' AND processing_at < ?))
       ORDER BY updated_at LIMIT ?`,
    )
    .all(dbNow(-15 * 60_000), opts.limit ?? 5)) as Array<{ id: string }>;
  let processed = 0;
  const { cleanupStaleRecordings } = await import('./rec');
  await cleanupStaleRecordings().catch(() => 0);
  for (const r of rows) {
    if (Date.now() - start > (opts.budgetMs ?? 20_000)) break;
    if (await processRecVideo(r.id)) processed++;
  }
  return { processed };
}
