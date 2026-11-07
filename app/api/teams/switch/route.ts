import { NextRequest, NextResponse } from 'next/server';
import { getCurrentUser } from '@/lib/session';
import { setActiveTeam } from '@/lib/teams';
import { ensureWorkspace, listMyWorkspaces } from '@/lib/workspace';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * GET ?id=: ¿ese workspace sigue siendo el activo de esta sesión y puede volver
 * a él? (La pestaña que se quedó atrás; components/app/WorkspaceGuard.tsx.)
 */
export async function GET(req: NextRequest) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  const real = user.actingUser ?? user;
  const id = req.nextUrl.searchParams.get('id') ?? '';
  const active = (user.workspace?.id ?? null) === id;
  const own = await ensureWorkspace(real.id);
  if (id === own.id) return NextResponse.json({ active, member: true, teamId: null });
  const entry = (await listMyWorkspaces(real)).find((e) => e.teamId === id);
  return NextResponse.json({ active, member: Boolean(entry), teamId: entry?.teamId ?? null });
}

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
