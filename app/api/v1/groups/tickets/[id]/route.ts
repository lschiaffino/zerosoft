import { NextResponse } from 'next/server';
import { apiError, requireApiUser, type ApiKeyAuth } from '@/lib/api-auth';
import { getTicket, updateTicket, type TicketPatch } from '@/lib/groups-tickets';
import type { TicketPriority, TicketStatus } from '@/lib/groups-rules';
import { canSeeChat, ticketsForViewer } from '@/lib/groups-access';
import { recordAudit } from '@/lib/groups-audit';
import { ticketLinks } from '@/lib/groups-integrations';
import { v1Error, v1Json, v1Viewer } from '@/lib/groups-v1';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

type Ctx = { params: Promise<{ id: string }> };

async function visibleTicket(auth: ApiKeyAuth, id: string) {
  const t = await getTicket(auth.user.id, id);
  if (!t) return null;
  const viewer = await v1Viewer(auth);
  if (t.chatId ? !(await canSeeChat(viewer, t.chatId)) : viewer.restricted) return null;
  return (await ticketsForViewer(viewer, [t]))[0] ?? null;
}

/** GET /api/v1/groups/tickets/:id (con los tickets vinculados en Freshdesk o Zoho Desk). */
export async function GET(req: Request, ctx: Ctx) {
  const auth = await requireApiUser(req, 'groups:read');
  if ('res' in auth) return auth.res;
  const t = await visibleTicket(auth, (await ctx.params).id);
  if (!t) return apiError(404, 'not_found', 'Ticket not found.');
  return NextResponse.json({ data: { ...t, links: await ticketLinks(t.id) } });
}

/** PATCH /api/v1/groups/tickets/:id { status?, priority?, assigneeId?, title? } */
export async function PATCH(req: Request, ctx: Ctx) {
  const auth = await requireApiUser(req, 'groups:write');
  if ('res' in auth) return auth.res;
  const before = await visibleTicket(auth, (await ctx.params).id);
  if (!before) return apiError(404, 'not_found', 'Ticket not found.');
  const b = await v1Json(req);
  const patch: TicketPatch = {};
  if (typeof b.title === 'string') patch.title = b.title;
  if (typeof b.status === 'string') patch.status = b.status as TicketStatus;
  if (typeof b.priority === 'string') patch.priority = b.priority as TicketPriority;
  if (b.assigneeId === null || typeof b.assigneeId === 'string') patch.assigneeId = (b.assigneeId as string | null) || null;
  try {
    const after = await updateTicket(auth.user.id, before.id, patch);
    await recordAudit(auth.user.id, { chatId: after.chatId, chatName: before.chatName, actorId: auth.personId, actorKind: 'api', action: 'ticket_updated', detail: { number: after.number, status: after.status } });
    return NextResponse.json({ data: after });
  } catch (err) {
    return v1Error(err);
  }
}
