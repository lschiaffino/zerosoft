import { NextResponse } from 'next/server';
import { deleteTeam, updateTeam } from '@/lib/groups-inbox';
import { groupsError, groupsSession, handleGroupsError, readJson } from '@/lib/groups-http';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

type Ctx = { params: Promise<{ id: string }> };

/** Renombrar o cambiar miembros: { name?, memberIds? }. Solo admins. */
export async function PATCH(req: Request, ctx: Ctx) {
  const s = await groupsSession({ write: true, admin: true });
  if (s instanceof NextResponse) return s;
  const b = await readJson(req);
  try {
    return NextResponse.json(await updateTeam(s.ws, (await ctx.params).id, { name: b.name, memberIds: b.memberIds }));
  } catch (err) {
    return handleGroupsError(err);
  }
}

export async function DELETE(_req: Request, ctx: Ctx) {
  const s = await groupsSession({ write: true, admin: true });
  if (s instanceof NextResponse) return s;
  return (await deleteTeam(s.ws, (await ctx.params).id)) ? NextResponse.json({ ok: true }) : groupsError(404, 'not_found');
}
