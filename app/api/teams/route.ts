import { NextRequest, NextResponse } from 'next/server';
import { getCurrentUser } from '@/lib/session';
import { createTeam, listOwnedTeams } from '@/lib/teams';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** GET: teams que posee el usuario. POST: crear team { name }. */
export async function GET() {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  const ownerId = user.actingUser?.id ?? user.id;
  return NextResponse.json({ rows: await listOwnedTeams(ownerId) });
}

export async function POST(req: NextRequest) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  // El team se crea sobre tu identidad real, aunque estés en otro workspace.
  const ownerId = user.actingUser?.id ?? user.id;
  const body = (await req.json().catch(() => null)) as { name?: string } | null;
  const team = await createTeam(ownerId, body?.name ?? '');
  return NextResponse.json(team, { status: 201 });
}
