import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { createSession, getSessionDetail, listSessions } from '@/lib/voice';
import { voiceAuth } from '@/lib/voice-route';
import { voiceErrorResponse, voiceJsonError } from '@/lib/voice-http';
import { linkBooking } from '@/lib/voice-integrations';
import { sessionScope } from '@/lib/crm-visibility';
import { VOICE_TITLE_MAX } from '@/lib/voice-types';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** Lista propia. ?kind=meeting|dictation, ?q= busca en título, notas y transcripción. */
export async function GET(req: NextRequest) {
  const auth = await voiceAuth();
  if (auth.res) return auth.res;
  const sp = new URL(req.url).searchParams;
  const kind = sp.get('kind');
  const sessions = await listSessions(auth.owner, {
    kind: kind === 'meeting' || kind === 'dictation' ? kind : undefined,
    q: sp.get('q')?.slice(0, 200) ?? null,
    limit: Number(sp.get('limit')) || 200,
    offset: Number(sp.get('offset')) || 0,
  });
  return NextResponse.json({ sessions });
}

const createSchema = z.object({
  title: z.string().max(VOICE_TITLE_MAX).optional(),
  capture: z.enum(['mic', 'mic_tab', 'file', 'desktop']).optional(),
  templateKey: z.string().max(64).optional(),
  bookingId: z.string().max(64).optional(),
  locale: z.enum(['en', 'es', 'pt']).optional(),
});

/** Reunión nueva (los dictados se crean en /api/voice/dictate). */
export async function POST(req: NextRequest) {
  const auth = await voiceAuth({ bucket: 'write' });
  if (auth.res) return auth.res;
  const parsed = createSchema.safeParse(await req.json().catch(() => ({})));
  if (!parsed.success) return voiceJsonError(400, 'invalid_input');
  try {
    const row = await createSession(auth.owner, {
      kind: 'meeting',
      title: parsed.data.title,
      capture: parsed.data.capture ?? 'mic',
      templateKey: parsed.data.templateKey ?? 'general',
      // 'recording' solo mientras graba (lo pone el grabador).
      status: 'done',
      locale: parsed.data.locale,
    });
    if (parsed.data.bookingId) {
      await linkBooking({
        owner: auth.owner,
        scope: await sessionScope(auth.user),
        sessionId: row.id,
        bookingId: parsed.data.bookingId,
        currentTitle: row.title,
      });
    }
    return NextResponse.json(await getSessionDetail(auth.owner, row.id), { status: 201 });
  } catch (err) {
    return voiceErrorResponse(err);
  }
}
