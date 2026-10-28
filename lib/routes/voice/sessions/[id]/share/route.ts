import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { voiceAuth } from '@/lib/voice-route';
import { voiceJsonError } from '@/lib/voice-http';
import { getSessionRow } from '@/lib/voice';
import { getShare, revokeShare, setShare } from '@/lib/voice-share';
import { listBoardMembers } from '@/lib/board-comments';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

type Ctx = { params: Promise<{ id: string }> };

/** El link de la reunión (o null) y las personas del workspace con las que se puede compartir. */
export async function GET(_req: NextRequest, ctx: Ctx) {
  const { id } = await ctx.params;
  const auth = await voiceAuth();
  if (auth.res) return auth.res;
  const row = await getSessionRow(auth.owner, id);
  if (!row || row.kind !== 'meeting') return voiceJsonError(404, 'not_found');
  const members = (await listBoardMembers(auth.owner.workspaceId)).filter((m) => m.id !== auth.owner.personId);
  return NextResponse.json({ share: await getShare(auth.owner, id), members });
}

const schema = z.object({
  access: z.enum(['workspace', 'people', 'anyone']),
  includeTranscript: z.boolean().optional(),
  people: z.array(z.string().max(64)).max(50).optional(),
  /** Cambiar el link: el anterior deja de andar. */
  regenerate: z.boolean().optional(),
});

/** Crea o cambia el link (acceso, transcripción, personas). */
export async function PUT(req: NextRequest, ctx: Ctx) {
  const { id } = await ctx.params;
  const auth = await voiceAuth({ bucket: 'write' });
  if (auth.res) return auth.res;
  const parsed = schema.safeParse(await req.json().catch(() => ({})));
  if (!parsed.success) return voiceJsonError(400, 'invalid_input');
  const res = await setShare(auth.owner, id, parsed.data);
  if (!res.ok) return voiceJsonError(res.code === 'not_found' ? 404 : 400, res.code);
  return NextResponse.json({ share: res.share });
}

/** Deja de compartir: el link deja de andar para todos. */
export async function DELETE(_req: NextRequest, ctx: Ctx) {
  const { id } = await ctx.params;
  const auth = await voiceAuth({ bucket: 'write' });
  if (auth.res) return auth.res;
  await revokeShare(auth.owner, id);
  return NextResponse.json({ ok: true });
}
