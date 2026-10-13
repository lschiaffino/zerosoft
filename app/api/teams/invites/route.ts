import { NextRequest, NextResponse } from 'next/server';
import { getCurrentUser } from '@/lib/session';
import { createInvite, getMemberRole, getTeamById, listPendingInvites, roleAtLeast } from '@/lib/teams';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function baseUrl(req: NextRequest): string {
  return (process.env.NEXTAUTH_URL ?? req.nextUrl.origin).replace(/\/$/, '');
}

/** GET: invites pendientes del team. POST: crear invite { teamId, email }. */
export async function GET(req: NextRequest) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  const teamId = req.nextUrl.searchParams.get('teamId') ?? '';
  const team = teamId ? await getTeamById(teamId) : null;
  const ownerId = user.actingUser?.id ?? user.id;
  if (!team || !roleAtLeast((await getMemberRole(team.id, ownerId)) ?? 'member', 'admin')) {
    return NextResponse.json({ error: 'forbidden' }, { status: 403 });
  }
  return NextResponse.json({ rows: await listPendingInvites(team.id) });
}

export async function POST(req: NextRequest) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  const ownerId = user.actingUser?.id ?? user.id;
  const body = (await req.json().catch(() => null)) as
    | { teamId?: string; email?: string }
    | null;
  if (!body?.teamId || !body.email || !EMAIL_RE.test(body.email.trim())) {
    return NextResponse.json({ error: 'invalid_input' }, { status: 400 });
  }
  const team = await getTeamById(body.teamId);
  if (!team || !roleAtLeast((await getMemberRole(team.id, ownerId)) ?? 'member', 'admin')) {
    return NextResponse.json({ error: 'forbidden' }, { status: 403 });
  }
  const invite = await createInvite(team.id, body.email, ownerId);
  return NextResponse.json(
    { invite, url: `${baseUrl(req)}/en/invite/${invite.token}` },
    { status: 201 },
  );
}
