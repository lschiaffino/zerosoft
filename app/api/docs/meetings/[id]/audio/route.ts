import { NextRequest, NextResponse } from 'next/server';
import { AiError, aiTranscribe } from '@/lib/ai';
import { aiErrorStatus, fakeTranscript } from '@/lib/docs-ai';
import { docsAiFakeActive } from '@/lib/docs-db-ai';
import { appendTranscript, getMeeting, hasAudioBudget, MEETING_CHUNK_MAX_BYTES, setMeetingError } from '@/lib/docs-meetings';
import { meetingFor } from '@/lib/docs-meetings-http';
import { docsError } from '@/lib/docs-http';
import { realUserId } from '@/lib/session';
import { limitWrites } from '@/lib/write-limit';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 120;

const AUDIO_TYPES = /^audio\/(webm|ogg|mp4|mpeg|mp3|wav|x-wav|m4a|x-m4a|aac)(;.*)?$/i;

/**
 * Un trozo de audio de la grabación (el navegador manda uno por minuto, de
 * micrófono y, si se compartió, de la pestaña de la llamada). Se transcribe
 * con lib/ai.ts y se suma a la transcripción.
 */
export async function POST(req: NextRequest, props: { params: Promise<{ id: string }> }) {
  const { id } = await props.params;
  const ctx = await meetingFor(id, true);
  if ('res' in ctx) return ctx.res;
  const limited = await limitWrites('docs:meeting-audio', realUserId(ctx.user), 20);
  if (limited) return limited;
  const form = await req.formData().catch(() => null);
  const file = form?.get('audio');
  if (!(file instanceof Blob) || file.size === 0) return docsError(400, 'missing_audio');
  if (file.size > MEETING_CHUNK_MAX_BYTES) return docsError(413, 'chunk_too_large');
  if (file.type && !AUDIO_TYPES.test(file.type)) return docsError(415, 'unsupported_audio');
  const seconds = Math.max(1, Math.min(Number(form?.get('seconds')) || 60, 600));
  const seq = Math.max(0, Number(form?.get('seq')) || 0);
  const language = String(form?.get('language') ?? '').slice(0, 5) || undefined;
  if (!(await hasAudioBudget(id, seconds))) return docsError(409, 'meeting_too_long');
  try {
    const fake = await docsAiFakeActive();
    const { text } = await aiTranscribe({
      workspaceId: ctx.meeting.workspace_id,
      feature: 'docs_meeting_transcribe',
      audio: file,
      filename: `chunk-${seq}.${/ogg/.test(file.type) ? 'ogg' : /mp4|m4a|aac/.test(file.type) ? 'm4a' : 'webm'}`,
      seconds,
      language,
      ...(fake ? { fake: () => fakeTranscript(seq) } : {}),
    });
    if (text) await appendTranscript(id, text, seconds);
    return NextResponse.json({ text, meeting: await getMeeting(id) });
  } catch (err) {
    if (err instanceof AiError) {
      await setMeetingError(id, err.code);
      return docsError(aiErrorStatus(err.code), err.code);
    }
    await setMeetingError(id, 'transcribe_failed');
    // eslint-disable-next-line no-console
    console.error('[docs] transcribe failed', (err as Error)?.message?.slice(0, 40) ?? 'error');
    return docsError(502, 'transcribe_failed');
  }
}
