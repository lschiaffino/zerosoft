import { NextResponse } from 'next/server';
import { createTicket, listTickets, type TicketQuery } from '@/lib/groups-tickets';
import { TICKET_STATUSES, type TicketPriority } from '@/lib/groups-rules';
import { groupsSession, handleGroupsError, readJson, str } from '@/lib/groups-http';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(req: Request) {
  const s = await groupsSession();
  if (s instanceof NextResponse) return s;
  const p = new URL(req.url).searchParams;
  const status = p.get('status') ?? 'active';
  const query: TicketQuery = {
    status: (['active', 'all', ...TICKET_STATUSES] as string[]).includes(status) ? (status as TicketQuery['status']) : 'active',
    assignee: p.get('assignee') === 'me' ? s.me : p.get('assignee') || undefined,
    chatId: p.get('chat') || undefined,
    breached: p.get('breached') === '1',
    q: p.get('q') ?? undefined,
  };
  return NextResponse.json({ tickets: await listTickets(s.ws, query) });
}

/** Ticket a mano sobre un chat (sin mensaje). */
export async function POST(req: Request) {
  const s = await groupsSession({ write: true });
  if (s instanceof NextResponse) return s;
  const b = await readJson(req);
  try {
    const res = await createTicket(s.ws, s.me, {
      chatId: str(b.chatId, 100) ?? '',
      messageId: str(b.messageId, 100) || null,
      title: str(b.title, 200),
      priority: str(b.priority, 10) as TicketPriority | undefined,
      assigneeId: str(b.assigneeId, 100) || null,
      source: 'manual',
    });
    return NextResponse.json(res.ticket, { status: res.created ? 201 : 200 });
  } catch (err) {
    return handleGroupsError(err);
  }
}
