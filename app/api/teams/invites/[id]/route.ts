import { NextRequest, NextResponse } from 'next/server';
import { getCurrentUser } from '@/lib/session';
import { getTeamById, revokeInvite } from '@/lib/teams';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** Revocar una invite pendiente (solo el owner del team). */
export async function DELETE(_req: NextRequest, { params }: { params: { id: string } }) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  const ownerId = user.actingUser?.id ?? user.id;
  const teamId = _req.nextUrl.searchParams.get('teamId') ?? '';
  const team = teamId ? await getTeamById(teamId) : null;
  if (!team || team.owner_id !== ownerId) {
    return NextResponse.json({ error: 'forbidden' }, { status: 403 });
  }
  await revokeInvite(params.id, team.id);
  return NextResponse.json({ ok: true });
}
