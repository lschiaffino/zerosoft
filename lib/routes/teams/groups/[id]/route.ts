import { NextRequest, NextResponse } from 'next/server';
import { isResponse, teamsCtx, teamsError } from '@/lib/teams-http';
import { deleteGroup, updateGroup, WorkspaceGroupError } from '@/lib/workspace-groups';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** PATCH: renombrar, describir o cambiar los miembros de un subequipo (owner y admins). */
export async function PATCH(req: NextRequest, props: { params: Promise<{ id: string }> }) {
  const params = await props.params;
  const ctx = await teamsCtx('admin');
  if (isResponse(ctx)) return ctx;
  const body = (await req.json().catch(() => null)) as Record<string, unknown> | null;
  if (!body) return teamsError('invalid_input');
  try {
    const group = await updateGroup(ctx.team.owner_id, params.id, body);
    if (!group) return teamsError('not_found', 404);
    return NextResponse.json(group);
  } catch (err) {
    if (err instanceof WorkspaceGroupError) return teamsError(err.code, err.status);
    throw err;
  }
}

/** DELETE: borra el subequipo en todas las apps. */
export async function DELETE(_req: NextRequest, props: { params: Promise<{ id: string }> }) {
  const params = await props.params;
  const ctx = await teamsCtx('admin');
  if (isResponse(ctx)) return ctx;
  if (!(await deleteGroup(ctx.team.owner_id, params.id))) return teamsError('not_found', 404);
  return NextResponse.json({ ok: true });
}
