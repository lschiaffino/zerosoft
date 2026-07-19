import { NextRequest, NextResponse } from 'next/server';
import { getCurrentUser } from '@/lib/session';
import { setActiveTeam } from '@/lib/teams';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** Cambia el workspace activo: { teamId } o { teamId: null } para el personal. */
export async function POST(req: NextRequest) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  const realId = user.actingUser?.id ?? user.id;
  const body = (await req.json().catch(() => null)) as { teamId?: string | null } | null;
  const teamId = body?.teamId ?? null;
  const ok = await setActiveTeam(realId, teamId);
  if (!ok) return NextResponse.json({ error: 'not_a_member' }, { status: 403 });
  return NextResponse.json({ ok: true });
}
