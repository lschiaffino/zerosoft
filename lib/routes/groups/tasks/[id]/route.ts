import { NextResponse } from 'next/server';
import { crmTaskScope, deleteGroupTask, getGroupTask, updateGroupTask, type TaskPatch } from '@/lib/groups-tasks';
import { cleanPriority } from '@/lib/tasks-shared';
import { groupsError, groupsSession, handleGroupsError, readJson, sessionViewer, str } from '@/lib/groups-http';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

type Ctx = { params: Promise<{ id: string }> };

export async function GET(_req: Request, ctx: Ctx) {
  const s = await groupsSession();
  if (s instanceof NextResponse) return s;
  const t = await getGroupTask(s.ws, (await ctx.params).id, await crmTaskScope(s.user), await sessionViewer(s));
  return t ? NextResponse.json(t) : groupsError(404, 'not_found');
}

/** { title?, notes?, dueAt?, ownerId?, done?, priority? } (también las del CRM del contacto del chat, si se ven en el CRM). */
export async function PATCH(req: Request, ctx: Ctx) {
  const s = await groupsSession({ write: true });
  if (s instanceof NextResponse) return s;
  const b = await readJson(req);
  const patch: TaskPatch = {};
  if (typeof b.title === 'string') patch.title = b.title;
  if (typeof b.notes === 'string') patch.notes = b.notes;
  if (b.dueAt === null || typeof b.dueAt === 'string') patch.dueAt = str(b.dueAt, 40) || null;
  if (b.ownerId === null || typeof b.ownerId === 'string') patch.ownerId = str(b.ownerId, 100) || null;
  if (typeof b.done === 'boolean') patch.done = b.done;
  if (typeof b.priority === 'string') patch.priority = cleanPriority(b.priority);
  try {
    return NextResponse.json(await updateGroupTask(s.ws, (await ctx.params).id, patch, await crmTaskScope(s.user), await sessionViewer(s)));
  } catch (err) {
    return handleGroupsError(err);
  }
}

export async function DELETE(_req: Request, ctx: Ctx) {
  const s = await groupsSession({ write: true });
  if (s instanceof NextResponse) return s;
  return (await deleteGroupTask(s.ws, (await ctx.params).id, await sessionViewer(s))) ? NextResponse.json({ ok: true }) : groupsError(404, 'not_found');
}
