import { NextRequest, NextResponse } from 'next/server';
import { loadDirectory } from '@/lib/workspace-directory';
import { isResponse, publicBase, teamsCtx } from '@/lib/teams-http';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** GET: personas, invitaciones pendientes (solo admins) y subequipos del workspace activo. */
export async function GET(req: NextRequest) {
  const ctx = await teamsCtx();
  if (isResponse(ctx)) return ctx;
  const dir = await loadDirectory(ctx.team, ctx.role, publicBase(req));
  return NextResponse.json({ ...dir, me: ctx.realId, role: ctx.role });
}
