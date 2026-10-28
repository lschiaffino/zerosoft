import { NextRequest, NextResponse } from 'next/server';
import { rateLimit } from '@/lib/rate-limit';
import { getCurrentUser, realUserId } from '@/lib/session';
import { addMember, setActiveTeam } from '@/lib/teams';
import { domainWorkspaces } from '@/lib/workspace';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** GET: workspaces a los que me puedo sumar por el dominio de mi email (Ajustes › Workspace › dominios). */
export async function GET() {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  const rows = await domainWorkspaces(user.actingUser ?? user);
  return NextResponse.json({ rows: rows.map((t) => ({ id: t.id, name: t.name, logoUrl: t.logo_url ?? null })) });
}

/** POST { teamId }: sumarse como miembro a un workspace que permite mi dominio. */
export async function POST(req: NextRequest) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  const real = user.actingUser ?? user;
  const realId = realUserId(user);
  const limit = await rateLimit(`teams:join:${realId}`, 10, 3600);
  if (!limit.ok) return NextResponse.json({ error: 'rate_limited' }, { status: 429 });
  const body = (await req.json().catch(() => null)) as { teamId?: string } | null;
  const team = (await domainWorkspaces(real)).find((t) => t.id === body?.teamId);
  if (!team) return NextResponse.json({ error: 'not_allowed' }, { status: 403 });
  await addMember(team.id, realId, 'member', { apps: '*', invitedBy: null });
  await setActiveTeam(realId, team.id);
  return NextResponse.json({ ok: true, team: { id: team.id, name: team.name }, next: real.onboarded_at ? '/app' : '/app/welcome?invited=1' });
}
