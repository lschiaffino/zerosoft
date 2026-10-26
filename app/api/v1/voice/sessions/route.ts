import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { voiceApiAuth, v1Error, v1ErrorResponse } from '@/lib/voice-v1';
import { createSession, listSessions } from '@/lib/voice';
import { VOICE_TITLE_MAX } from '@/lib/voice-types';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** GET /api/v1/voice/sessions (voice:read): ?kind=meeting|dictation, ?q=, ?limit=, ?offset=. */
export async function GET(req: NextRequest) {
  const auth = await voiceApiAuth(req, 'voice:read');
  if (auth.res) return auth.res;
  const sp = new URL(req.url).searchParams;
  const kind = sp.get('kind');
  const data = await listSessions(auth.owner, {
    kind: kind === 'meeting' || kind === 'dictation' ? kind : undefined,
    q: sp.get('q')?.slice(0, 200) ?? null,
    limit: Math.min(Number(sp.get('limit')) || 50, 200),
    offset: Number(sp.get('offset')) || 0,
  });
  return NextResponse.json({ data });
}

const schema = z.object({
  title: z.string().max(VOICE_TITLE_MAX).optional(),
  templateKey: z.string().max(64).optional(),
});

/** POST /api/v1/voice/sessions (voice:write): reunión nueva grabada desde el escritorio. */
export async function POST(req: NextRequest) {
  const auth = await voiceApiAuth(req, 'voice:write');
  if (auth.res) return auth.res;
  const parsed = schema.safeParse(await req.json().catch(() => ({})));
  if (!parsed.success) return v1Error(400, 'invalid_input');
  try {
    const row = await createSession(auth.owner, {
      kind: 'meeting',
      title: parsed.data.title,
      capture: 'desktop',
      templateKey: parsed.data.templateKey ?? 'general',
      status: 'recording',
    });
    return NextResponse.json({ data: { id: row.id, title: row.title, status: row.status, startedAt: row.started_at } }, { status: 201 });
  } catch (err) {
    return v1ErrorResponse(err);
  }
}
