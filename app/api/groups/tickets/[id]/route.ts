import { NextResponse } from 'next/server';
import { deleteTicket, getTicket, updateTicket, type TicketPatch } from '@/lib/groups-tickets';
import type { TicketPriority, TicketStatus } from '@/lib/groups-rules';
import { groupsError, groupsSession, handleGroupsError, readJson, sessionViewer, str, type GroupsSession } from '@/lib/groups-http';
import { canSeeChat, ticketsForViewer } from '@/lib/groups-access';
import { recordAudit } from '@/lib/groups-audit';
import { ticketLinks } from '@/lib/groups-integrations';

/** El ticket, si la persona ve su chat (acceso por etiqueta). */
async function visibleTicket(s: GroupsSession, id: string) {
  const t = await getTicket(s.ws, id);
  if (!t) return null;
  const viewer = await sessionViewer(s);
  if (t.chatId && !(await canSeeChat(viewer, t.chatId))) return null;
  if (!t.chatId && viewer.restricted) return null;
  return (await ticketsForViewer(viewer, [t]))[0] ?? null;
}

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

type Ctx = { params: Promise<{ id: string }> };

export async function GET(_req: Request, ctx: Ctx) {
  const s = await groupsSession();
  if (s instanceof NextResponse) return s;
  const t = await visibleTicket(s, (await ctx.params).id);
  return t ? NextResponse.json({ ...t, links: await ticketLinks(t.id) }) : groupsError(404, 'not_found');
}

export async function PATCH(req: Request, ctx: Ctx) {
  const s = await groupsSession({ write: true });
  if (s instanceof NextResponse) return s;
  const id = (await ctx.params).id;
  const before = await visibleTicket(s, id);
  if (!before) return groupsError(404, 'not_found');
  const b = await readJson(req);
  const patch: TicketPatch = {};
  if (typeof b.title === 'string') patch.title = b.title;
  if (typeof b.status === 'string') patch.status = b.status as TicketStatus;
  if (typeof b.priority === 'string') patch.priority = b.priority as TicketPriority;
  if (b.assigneeId === null || typeof b.assigneeId === 'string') patch.assigneeId = str(b.assigneeId, 100) || null;
  try {
    const after = await updateTicket(s.ws, id, patch);
    const changed = (['status', 'priority', 'assigneeId', 'title'] as const).filter((k) => before[k] !== after[k]);
    if (changed.length) {
      await recordAudit(s.ws, {
        chatId: after.chatId,
        chatName: before.chatName,
        actorId: s.me,
        action: 'ticket_updated',
        detail: { number: after.number, ...Object.fromEntries(changed.map((k) => [k, after[k]])) },
      });
    }
    return NextResponse.json(after);
  } catch (err) {
    return handleGroupsError(err);
  }
}

export async function DELETE(_req: Request, ctx: Ctx) {
  const s = await groupsSession({ write: true });
  if (s instanceof NextResponse) return s;
  const id = (await ctx.params).id;
  const t = await visibleTicket(s, id);
  if (!t || !(await deleteTicket(s.ws, id))) return groupsError(404, 'not_found');
  await recordAudit(s.ws, { chatId: t.chatId, chatName: t.chatName, actorId: s.me, action: 'ticket_deleted', detail: { number: t.number } });
  return NextResponse.json({ ok: true });
}
