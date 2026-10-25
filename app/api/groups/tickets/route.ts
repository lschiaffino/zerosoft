import { NextResponse } from 'next/server';
import { createTicket, listTickets, type TicketQuery } from '@/lib/groups-tickets';
import type { PropertyFilter } from '@/lib/groups';
import { TICKET_STATUSES, type TicketPriority } from '@/lib/groups-rules';
import { chatGuard, groupsSession, handleGroupsError, readJson, sessionViewer, str } from '@/lib/groups-http';
import { ticketsForViewer } from '@/lib/groups-access';
import { recordAudit } from '@/lib/groups-audit';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** ?fields=[{"key":"area","op":"is","value":"Billing"}] */
function parseFields(raw: string | null): PropertyFilter[] {
  if (!raw) return [];
  try {
    const v = JSON.parse(raw) as unknown;
    return Array.isArray(v)
      ? v.slice(0, 10).map((f) => {
          const o = (f ?? {}) as Record<string, unknown>;
          return { key: String(o.key ?? ''), op: (['set', 'unset'].includes(String(o.op)) ? o.op : 'is') as PropertyFilter['op'], value: o.value == null ? undefined : String(o.value) };
        })
      : [];
  } catch {
    return [];
  }
}

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
    fields: parseFields(p.get('fields')),
  };
  return NextResponse.json({ tickets: await ticketsForViewer(await sessionViewer(s), await listTickets(s.ws, query)) });
}

/** Ticket a mano sobre un chat (sin mensaje). */
export async function POST(req: Request) {
  const s = await groupsSession({ write: true });
  if (s instanceof NextResponse) return s;
  const b = await readJson(req);
  const guard = await chatGuard(s, str(b.chatId, 100) ?? '');
  if (guard instanceof NextResponse) return guard;
  try {
    const res = await createTicket(s.ws, s.me, {
      chatId: str(b.chatId, 100) ?? '',
      messageId: str(b.messageId, 100) || null,
      title: str(b.title, 200),
      priority: str(b.priority, 10) as TicketPriority | undefined,
      assigneeId: str(b.assigneeId, 100) || null,
      source: 'manual',
      fields: b.fields && typeof b.fields === 'object' && !Array.isArray(b.fields) ? (b.fields as Record<string, unknown>) : undefined,
    });
    if (res.created) {
      await recordAudit(s.ws, { chatId: res.ticket.chatId, chatName: res.ticket.chatName, actorId: s.me, action: 'ticket_created', detail: { number: res.ticket.number } });
    }
    return NextResponse.json(res.ticket, { status: res.created ? 201 : 200 });
  } catch (err) {
    return handleGroupsError(err);
  }
}
