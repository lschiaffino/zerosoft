import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { voiceApiAuth, v1Error } from '@/lib/voice-v1';
import { getSessionDetail, updateSession } from '@/lib/voice';
import { VOICE_TITLE_MAX } from '@/lib/voice-types';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

type Ctx = { params: Promise<{ id: string }> };

/** GET /api/v1/voice/sessions/:id (voice:read): la sesión con transcripción y notas. */
export async function GET(req: NextRequest, ctx: Ctx) {
  const { id } = await ctx.params;
  const auth = await voiceApiAuth(req, 'voice:read');
  if (auth.res) return auth.res;
  const d = await getSessionDetail(auth.owner, id);
  if (!d) return v1Error(404, 'not_found');
  return NextResponse.json({ data: d });
}

const schema = z.object({
  title: z.string().max(VOICE_TITLE_MAX).optional(),
  status: z.enum(['recording', 'done']).optional(),
});

/** PATCH /api/v1/voice/sessions/:id (voice:write): título, o status "done" al cortar la grabación. */
export async function PATCH(req: NextRequest, ctx: Ctx) {
  const { id } = await ctx.params;
  const auth = await voiceApiAuth(req, 'voice:write');
  if (auth.res) return auth.res;
  const parsed = schema.safeParse(await req.json().catch(() => ({})));
  if (!parsed.success) return v1Error(400, 'invalid_input');
  const row = await updateSession(auth.owner, id, parsed.data);
  if (!row) return v1Error(404, 'not_found');
  return NextResponse.json({ data: { id: row.id, title: row.title, status: row.status, durationMs: row.duration_ms } });
}
