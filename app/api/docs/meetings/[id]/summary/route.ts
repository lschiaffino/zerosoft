import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { AiError } from '@/lib/ai';
import { aiErrorStatus, summarizeMeeting } from '@/lib/docs-ai';
import { getMeeting, meetingBlockContent, saveNotes, setMeetingError } from '@/lib/docs-meetings';
import { meetingFor } from '@/lib/docs-meetings-http';
import { docsError, invalidBody } from '@/lib/docs-http';
import { realUserId } from '@/lib/session';
import { limitWrites } from '@/lib/write-limit';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 90;

const schema = z.object({ language: z.string().max(10).optional(), notes: z.string().max(20_000).optional() });

/** Genera resumen, decisiones y tareas de la transcripción (y las notas escritas a mano). */
export async function POST(req: NextRequest, props: { params: Promise<{ id: string }> }) {
  const { id } = await props.params;
  const ctx = await meetingFor(id, true);
  if ('res' in ctx) return ctx.res;
  const parsed = schema.safeParse(await req.json().catch(() => ({})));
  if (!parsed.success) return invalidBody(parsed.error);
  const limited = await limitWrites('docs:meeting-summary', realUserId(ctx.user), 10);
  if (limited) return limited;
  const m = await getMeeting(id);
  if (!m) return docsError(404, 'not_found');
  // Como en Notion: hace falta cerca de un minuto de transcripción para resumir.
  if (m.transcript.trim().length < 40) return docsError(400, 'transcript_too_short');
  try {
    const notes = await summarizeMeeting(ctx.meeting.workspace_id, { title: m.title, transcript: m.transcript, notes: parsed.data.notes, language: parsed.data.language });
    const meeting = await saveNotes(id, notes);
    return NextResponse.json({ meeting, content: meeting ? meetingBlockContent(meeting) : '' });
  } catch (err) {
    if (err instanceof AiError) {
      await setMeetingError(id, err.code);
      return docsError(aiErrorStatus(err.code), err.code);
    }
    await setMeetingError(id, 'ai_error');
    // eslint-disable-next-line no-console
    console.error('[docs] meeting summary failed', (err as Error)?.name ?? 'error');
    return docsError(502, 'ai_error');
  }
}
