import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { rateLimit } from '@/lib/rate-limit';
import { getCurrentUser, realUserId } from '@/lib/session';
import { getMemberRole, removeMember } from '@/lib/teams';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const schema = z.object({ teamId: z.string().min(1).max(128) });

/**
 * DELETE { teamId }: dejar de ser guest de un workspace. Un guest nunca tiene
 * sesión adentro (lib/teams.ts → resolveWorkspace), así que no puede usar
 * /api/teams/members/self; esta ruta solo saca a la propia persona y solo si
 * es guest ahí. Pierde lo que le compartieron persona a persona.
 */
export async function DELETE(req: NextRequest) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  const realId = realUserId(user);
  const limit = await rateLimit(`teams:guest-leave:${realId}`, 30, 3600);
  if (!limit.ok) return NextResponse.json({ error: 'rate_limited' }, { status: 429 });
  const parsed = schema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: 'invalid_input' }, { status: 400 });
  if ((await getMemberRole(parsed.data.teamId, realId)) !== 'guest') return NextResponse.json({ error: 'not_found' }, { status: 404 });
  await removeMember(parsed.data.teamId, realId);
  return NextResponse.json({ ok: true });
}
