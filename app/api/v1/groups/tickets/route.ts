import { NextResponse } from 'next/server';
import { apiError, requireApiUser } from '@/lib/api-auth';
import { GroupsError } from '@/lib/groups';
import { createTicket, listTickets, type TicketQuery } from '@/lib/groups-tickets';
import { TICKET_STATUSES, type TicketPriority } from '@/lib/groups-rules';

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
  return NextResponse.json({ data: tickets });
}

/** POST /api/v1/groups/tickets { chatId, title?, messageId?, priority? } */
export async function POST(req: Request) {
  const auth = await requireApiUser(req, 'groups:write');
  if ('res' in auth) return auth.res;
  const b = (await req.json().catch(() => ({}))) as Record<string, unknown>;
  if (typeof b.chatId !== 'string') return apiError(400, 'invalid_input', 'chatId is required.');
  try {
    const res = await createTicket(auth.user.id, auth.personId, {
      chatId: b.chatId,
      messageId: typeof b.messageId === 'string' ? b.messageId : null,
      title: typeof b.title === 'string' ? b.title : undefined,
      priority: typeof b.priority === 'string' ? (b.priority as TicketPriority) : undefined,
      source: 'api',
    });
    return NextResponse.json({ data: res.ticket }, { status: res.created ? 201 : 200 });
  } catch (err) {
    if (err instanceof GroupsError) return apiError(err.status, err.code, 'Could not create the ticket.');
    throw err;
  }
}
