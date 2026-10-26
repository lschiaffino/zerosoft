import { NextResponse } from 'next/server';
import { deleteLabel, updateLabel } from '@/lib/groups';
import { groupsError, groupsSession, handleGroupsError, readJson, str } from '@/lib/groups-http';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

type Ctx = { params: Promise<{ id: string }> };

export async function PATCH(req: Request, ctx: Ctx) {
  const s = await groupsSession({ write: true });
  if (s instanceof NextResponse) return s;
  const b = await readJson(req);
  try {
    return NextResponse.json(await updateLabel(s.ws, (await ctx.params).id, { name: str(b.name, 40), color: str(b.color, 20) }));
  } catch (err) {
    return handleGroupsError(err);
  }
}

export async function DELETE(_req: Request, ctx: Ctx) {
  const s = await groupsSession({ write: true });
  if (s instanceof NextResponse) return s;
  return (await deleteLabel(s.ws, (await ctx.params).id)) ? NextResponse.json({ ok: true }) : groupsError(404, 'not_found');
}
