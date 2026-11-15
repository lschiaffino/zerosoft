import { NextResponse } from 'next/server';
import { deleteLabel, updateLabel } from '@/lib/groups';
import { groupsError, groupsSession, handleGroupsError, readJson, sessionViewer, str, type GroupsSession } from '@/lib/groups-http';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

type Ctx = { params: Promise<{ id: string }> };

/** Con acceso por etiqueta, las etiquetas deciden quién ve qué chat: solo quien no está restringido las cambia. */
async function labelsLocked(s: GroupsSession): Promise<boolean> {
  return (await sessionViewer(s)).restricted;
}

export async function PATCH(req: Request, ctx: Ctx) {
  const s = await groupsSession({ write: true });
  if (s instanceof NextResponse) return s;
  if (await labelsLocked(s)) return groupsError(403, 'forbidden');
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
  if (await labelsLocked(s)) return groupsError(403, 'forbidden');
  return (await deleteLabel(s.ws, (await ctx.params).id)) ? NextResponse.json({ ok: true }) : groupsError(404, 'not_found');
}
