import { NextResponse } from 'next/server';
import { deleteTicket, getTicket, updateTicket, type TicketPatch } from '@/lib/groups-tickets';
import type { TicketPriority, TicketStatus } from '@/lib/groups-rules';
import { groupsError, groupsSession, handleGroupsError, readJson, str } from '@/lib/groups-http';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

type Ctx = { params: Promise<{ id: string }> };

export async function GET(_req: Request, ctx: Ctx) {
  const s = await groupsSession();
  if (s instanceof NextResponse) return s;
  const t = await getTicket(s.ws, (await ctx.params).id);
  return t ? NextResponse.json(t) : groupsError(404, 'not_found');
}

export async function PATCH(req: Request, ctx: Ctx) {
  const s = await groupsSession({ write: true });
  if (s instanceof NextResponse) return s;
  const b = await readJson(req);
  const patch: TicketPatch = {};
  if (typeof b.title === 'string') patch.title = b.title;
  if (typeof b.status === 'string') patch.status = b.status as TicketStatus;
  if (typeof b.priority === 'string') patch.priority = b.priority as TicketPriority;
  if (b.assigneeId === null || typeof b.assigneeId === 'string') patch.assigneeId = str(b.assigneeId, 100) || null;
  if (b.fields && typeof b.fields === 'object' && !Array.isArray(b.fields)) patch.fields = b.fields as Record<string, unknown>;
  try {
    return NextResponse.json(await updateTicket(s.ws, (await ctx.params).id, patch));
  } catch (err) {
    return handleGroupsError(err);
  }
}

export async function DELETE(_req: Request, ctx: Ctx) {
  const s = await groupsSession({ write: true });
  if (s instanceof NextResponse) return s;
  return (await deleteTicket(s.ws, (await ctx.params).id)) ? NextResponse.json({ ok: true }) : groupsError(404, 'not_found');
}
