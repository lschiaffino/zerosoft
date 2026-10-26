import { NextResponse } from 'next/server';
import { deleteRecurring, getRecurring, recurringRuns, updateRecurring, type RecurringPatch } from '@/lib/groups-recurring';
import { visibleChatIds } from '@/lib/groups-access';
import { groupsError, groupsSession, handleGroupsError, readJson, sessionViewer, str, strArr, type GroupsSession } from '@/lib/groups-http';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

type Ctx = { params: Promise<{ id: string }> };

/** La serie, si la persona ve alguno de sus chats (acceso por etiqueta). */
async function visible(s: GroupsSession, id: string) {
  const rec = await getRecurring(s.ws, id);
  if (!rec) return null;
  const ids = await visibleChatIds(await sessionViewer(s));
  return !ids || rec.chatIds.some((c) => ids.has(c)) ? rec : null;
}

export async function GET(_req: Request, ctx: Ctx) {
  const s = await groupsSession();
  if (s instanceof NextResponse) return s;
  const id = (await ctx.params).id;
  const rec = await visible(s, id);
  if (!rec) return groupsError(404, 'not_found');
  return NextResponse.json({ recurring: rec, runs: await recurringRuns(s.ws, id) });
}

/** Editar (texto, encuesta, destinos, regla, zona, fin, ritmo, nombre) o pausar y reanudar ({ status }). */
export async function PATCH(req: Request, ctx: Ctx) {
  const s = await groupsSession({ write: true });
  if (s instanceof NextResponse) return s;
  const id = (await ctx.params).id;
  if (!(await visible(s, id))) return groupsError(404, 'not_found');
  const b = await readJson(req);
  const patch: RecurringPatch = {};
  if (typeof b.name === 'string') patch.name = b.name;
  if (typeof b.body === 'string') patch.body = b.body;
  if (b.poll !== undefined) patch.poll = b.poll;
  if (Array.isArray(b.chatIds)) patch.chatIds = strArr(b.chatIds, 2000);
  if (b.rule !== undefined) patch.rule = b.rule;
  if (typeof b.timezone === 'string') patch.timezone = b.timezone;
  if (b.endsAt === null || typeof b.endsAt === 'string') patch.endsAt = str(b.endsAt, 40) || null;
  if (b.perMinute !== undefined) patch.perMinute = Number(b.perMinute) || 20;
  if (b.status === 'active' || b.status === 'paused') patch.status = b.status;
  try {
    return NextResponse.json(await updateRecurring(s.ws, id, patch));
  } catch (err) {
    return handleGroupsError(err);
  }
}

export async function DELETE(_req: Request, ctx: Ctx) {
  const s = await groupsSession({ write: true });
  if (s instanceof NextResponse) return s;
  const id = (await ctx.params).id;
  if (!(await visible(s, id))) return groupsError(404, 'not_found');
  return (await deleteRecurring(s.ws, id)) ? NextResponse.json({ ok: true }) : groupsError(404, 'not_found');
}
