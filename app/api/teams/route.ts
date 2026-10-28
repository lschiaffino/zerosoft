import { NextRequest, NextResponse } from 'next/server';
import { getDb } from '@/lib/db';
import { rateLimit } from '@/lib/rate-limit';
import { isResponse, teamsCtx, teamsError } from '@/lib/teams-http';
import { setActiveTeam } from '@/lib/teams';
import { ensureWorkspace, listMyWorkspaces, updateWorkspace } from '@/lib/workspace';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** GET: mis workspaces (el propio y los ajenos donde soy parte), para el switcher. */
export async function GET() {
  const ctx = await teamsCtx();
  if (isResponse(ctx)) return ctx;
  const rows = await listMyWorkspaces(ctx.real);
  return NextResponse.json({ rows, active: ctx.real.active_team_id ?? null });
}

/**
 * POST { name }: "crear un equipo". Un workspace por persona: pone el propio
 * en modo equipo con ese nombre y lo deja activo. Devuelve la ficha.
 */
export async function POST(req: NextRequest) {
  const ctx = await teamsCtx();
  if (isResponse(ctx)) return ctx;
  const limit = await rateLimit(`teams:create:${ctx.realId}`, 20, 3600);
  if (!limit.ok) return teamsError('rate_limited', 429);
  const body = (await req.json().catch(() => null)) as { name?: string; size?: string } | null;
  const name = String(body?.name ?? '').trim();
  if (!name) return teamsError('invalid_name');
  const own = await ensureWorkspace(ctx.realId);
  const err = await updateWorkspace(own.id, { name, mode: 'team', ...(body?.size ? { size: body.size } : {}) });
  if (err) return teamsError(err);
  await setActiveTeam(ctx.realId, null);
  const row = await getDb().prepare('SELECT * FROM teams WHERE id = ?').get(own.id);
  return NextResponse.json(row, { status: 201 });
}
