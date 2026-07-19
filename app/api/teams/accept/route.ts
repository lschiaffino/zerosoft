import { NextRequest, NextResponse } from 'next/server';
import { getCurrentUser } from '@/lib/session';
import { acceptInvite, getInviteByToken, setActiveTeam } from '@/lib/teams';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** Aceptar una invite por token: suma al usuario al team y lo activa como workspace. */
export async function POST(req: NextRequest) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  const realId = user.actingUser?.id ?? user.id;
  const body = (await req.json().catch(() => null)) as { token?: string } | null;
  if (!body?.token) return NextResponse.json({ error: 'invalid_input' }, { status: 400 });
  const invite = await getInviteByToken(body.token);
  if (!invite) return NextResponse.json({ error: 'not_found' }, { status: 404 });
  const team = await acceptInvite(invite, realId);
  if (!team) return NextResponse.json({ error: 'invite_invalid' }, { status: 400 });
  // El owner ya vive en su propio workspace: solo switcheamos a invitados.
  if (team.owner_id !== realId) await setActiveTeam(realId, team.id);
  return NextResponse.json({ ok: true, team: { id: team.id, name: team.name } });
}
