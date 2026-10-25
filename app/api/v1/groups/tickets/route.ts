import { NextResponse } from 'next/server';
import { apiError, requireApiUser } from '@/lib/api-auth';
import { createTicket, listTickets, type TicketQuery } from '@/lib/groups-tickets';
import { TICKET_STATUSES, type TicketPriority } from '@/lib/groups-rules';
import { ticketsForViewer } from '@/lib/groups-access';
import { recordAudit } from '@/lib/groups-audit';
import { v1Chat, v1Error, v1Json, v1Viewer } from '@/lib/groups-v1';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** GET /api/v1/groups/tickets?status=active|all|open|in_progress|resolved|closed&chat= */
export async function GET(req: Request) {
  const auth = await requireApiUser(req, 'groups:read');
  if ('res' in auth) return auth.res;
  const p = new URL(req.url).searchParams;
  const status = p.get('status') ?? 'active';
  const tickets = await listTickets(auth.user.id, {
    status: (['active', 'all', ...TICKET_STATUSES] as string[]).includes(status) ? (status as TicketQuery['status']) : 'active',
    chatId: p.get('chat') || undefined,
  });
  return NextResponse.json({ data: await ticketsForViewer(await v1Viewer(auth), tickets) });
}

/** POST /api/v1/groups/tickets { chatId, title?, messageId?, priority? } */
export async function POST(req: Request) {
  const auth = await requireApiUser(req, 'groups:write');
  if ('res' in auth) return auth.res;
  const b = await v1Json(req);
  if (typeof b.chatId !== 'string') return apiError(400, 'invalid_input', 'chatId is required.');
  const g = await v1Chat(auth, b.chatId);
  if ('res' in g) return g.res;
  try {
    const res = await createTicket(auth.user.id, auth.personId, {
      chatId: b.chatId,
      messageId: typeof b.messageId === 'string' ? b.messageId : null,
      title: typeof b.title === 'string' ? b.title : undefined,
      priority: typeof b.priority === 'string' ? (b.priority as TicketPriority) : undefined,
      source: 'api',
    });
    if (res.created) {
      await recordAudit(auth.user.id, { chatId: b.chatId, chatName: res.ticket.chatName, actorId: auth.personId, actorKind: 'api', action: 'ticket_created', detail: { number: res.ticket.number } });
    }
    return NextResponse.json({ data: res.ticket }, { status: res.created ? 201 : 200 });
  } catch (err) {
    return v1Error(err);
  }
}
