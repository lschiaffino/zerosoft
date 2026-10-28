import { NextRequest, NextResponse } from 'next/server';
import { isResponse, teamsCtx, teamsError } from '@/lib/teams-http';
import { createGroup, listGroups, WorkspaceGroupError } from '@/lib/workspace-groups';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** GET: subequipos del workspace activo. */
export async function GET() {
  const ctx = await teamsCtx();
  if (isResponse(ctx)) return ctx;
  return NextResponse.json({ rows: await listGroups(ctx.team.owner_id) });
}

/** POST { name, description?, color?, memberIds?, leadIds? }: crea un subequipo (owner y admins). */
export async function POST(req: NextRequest) {
  const ctx = await teamsCtx('admin');
  if (isResponse(ctx)) return ctx;
  const body = (await req.json().catch(() => null)) as Record<string, unknown> | null;
  if (!body) return teamsError('invalid_input');
  try {
    return NextResponse.json(await createGroup(ctx.team.owner_id, { ...body, name: body.name }), { status: 201 });
  } catch (err) {
    if (err instanceof WorkspaceGroupError) return teamsError(err.code, err.status);
    throw err;
  }
}
