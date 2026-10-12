import { NextRequest, NextResponse } from 'next/server';
import { getCurrentUser, realUserId } from '@/lib/session';
import { getMemberRole, getTeamById, removeMember, roleAtLeast, setMemberRole } from '@/lib/teams';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * Remover un member del team. Permitido si:
 * - sos el owner (a cualquiera menos a vos),
 * - sos admin y el otro es member,
 * - o te removés a vos mismo (leave), salvo que seas el owner.
 */
export async function DELETE(req: NextRequest, { params }: { params: { userId: string } }) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  const realId = realUserId(user);
  const targetId = params.userId === 'self' ? realId : params.userId;
  const teamId = req.nextUrl.searchParams.get('teamId') ?? '';
  const team = teamId ? await getTeamById(teamId) : null;
  if (!team) return NextResponse.json({ error: 'not_found' }, { status: 404 });

  const myRole = await getMemberRole(team.id, realId);
  const targetRole = await getMemberRole(team.id, targetId);
  if (!myRole || !targetRole) return NextResponse.json({ error: 'not_found' }, { status: 404 });

  const isSelf = targetId === realId;
  if (isSelf && myRole === 'owner') return NextResponse.json({ error: 'owner_cant_leave' }, { status: 400 });
  const allowed =
    isSelf || myRole === 'owner' || (myRole === 'admin' && targetRole === 'member');
  if (!allowed) return NextResponse.json({ error: 'forbidden' }, { status: 403 });

  await removeMember(team.id, targetId);
  return NextResponse.json({ ok: true });
}

/** Cambiar el rol de un member (admin ↔ member). Solo el owner. */
export async function PATCH(req: NextRequest, { params }: { params: { userId: string } }) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  const body = (await req.json().catch(() => null)) as { teamId?: string; role?: string } | null;
  if (!body?.teamId || (body.role !== 'admin' && body.role !== 'member')) {
    return NextResponse.json({ error: 'invalid_input' }, { status: 400 });
  }
  const myRole = await getMemberRole(body.teamId, realUserId(user));
  if (!myRole || !roleAtLeast(myRole, 'owner')) {
    return NextResponse.json({ error: 'forbidden' }, { status: 403 });
  }
  if (!(await setMemberRole(body.teamId, params.userId, body.role))) {
    return NextResponse.json({ error: 'not_found' }, { status: 404 });
  }
  return NextResponse.json({ ok: true });
}
