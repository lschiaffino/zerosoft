import { NextRequest, NextResponse } from 'next/server';
import { getCurrentUser } from '@/lib/session';
import { getTeamById, removeMember } from '@/lib/teams';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * Remover un member del team. Permitido si sos el owner del team
 * o si te removés a vos mismo (leave).
 */
export async function DELETE(req: NextRequest, { params }: { params: { userId: string } }) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  const realId = user.actingUser?.id ?? user.id;
  const targetId = params.userId === 'self' ? realId : params.userId;
  const teamId = req.nextUrl.searchParams.get('teamId') ?? '';
  const team = teamId ? await getTeamById(teamId) : null;
  if (!team) return NextResponse.json({ error: 'not_found' }, { status: 404 });
  const isOwner = team.owner_id === realId;
  const isSelf = targetId === realId;
  if (!isOwner && !isSelf) return NextResponse.json({ error: 'forbidden' }, { status: 403 });
  if (isSelf && isOwner) return NextResponse.json({ error: 'owner_cant_leave' }, { status: 400 });
  await removeMember(team.id, targetId);
  return NextResponse.json({ ok: true });
}
