import { NextResponse } from 'next/server';
import { getDb } from '@/lib/db';
import { listChats, listPropertyDefs, propertyText, type PropertyFilter } from '@/lib/groups';
import { listTickets, type TicketQuery } from '@/lib/groups-tickets';
import { TICKET_STATUSES } from '@/lib/groups-rules';
import { chatGuard, groupsError, groupsSession, sessionViewer } from '@/lib/groups-http';
import { maskPhone, ticketsForViewer } from '@/lib/groups-access';
import { recordAudit } from '@/lib/groups-audit';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** Celda CSV: comillas si hace falta y sin fórmulas (= + - @ al inicio). */
function cell(v: unknown): string {
  let s = v == null ? '' : String(v);
  if (/^[=+\-@\t\r]/.test(s)) s = `'${s}`;
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

function jsonFilters(raw: string | null): PropertyFilter[] {
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

function csv(rows: unknown[][]): string {
  return rows.map((r) => r.map(cell).join(',')).join('\n') + '\n';
}

/** CSV de chats, tickets o mensajes (?type=chats|tickets|messages, &chat=<id> para un chat). */
export async function GET(req: Request) {
  const s = await groupsSession();
  if (s instanceof NextResponse) return s;
  const p = new URL(req.url).searchParams;
  const type = p.get('type') ?? 'chats';
  const viewer = await sessionViewer(s);
  let body: string;
  if (type === 'chats') {
    const defs = await listPropertyDefs(s.ws, 'chat');
    const { rows } = await listChats(s.ws, s.me, { filter: 'all', limit: 200, viewer });
    const closed = await listChats(s.ws, s.me, { filter: 'closed', limit: 200, viewer });
    body = csv([
      ['id', 'kind', 'name', 'phone', 'members', 'status', 'assigned_to', 'labels', 'last_message_at', 'awaiting_since', 'crm_company_id', 'crm_contact_id', ...defs.map((d) => d.label)],
      ...[...rows, ...closed.rows].map((c) => [
        c.id,
        c.kind,
        c.name,
        c.phone,
        c.memberCount,
        c.status,
        c.assignedTo,
        c.labels.map((l) => l.name).join('; '),
        c.lastMessageAt,
        c.awaitingSince,
        c.crmCompanyId,
        c.crmContactId,
        ...defs.map((d) => propertyText(c.properties[d.key], d.type)),
      ]),
    ]);
  } else if (type === 'tickets') {
    // Mismos filtros que la pantalla de tickets (estado, asignado, vencidos, búsqueda y campos propios).
    const defs = await listPropertyDefs(s.ws, 'ticket');
    const status = p.get('status') ?? 'all';
    const tickets = await ticketsForViewer(
      viewer,
      await listTickets(s.ws, {
      status: (['active', 'all', ...TICKET_STATUSES] as string[]).includes(status) ? (status as TicketQuery['status']) : 'all',
      assignee: p.get('assignee') === 'me' ? s.me : p.get('assignee') || undefined,
      breached: p.get('breached') === '1',
      q: p.get('q') ?? undefined,
      fields: jsonFilters(p.get('fields')),
      limit: 500,
      }),
    );
    body = csv([
      ['number', 'title', 'status', 'priority', 'assignee_id', 'chat', 'source', 'created_at', 'due_at', 'first_response_at', 'resolved_at', 'breached', ...defs.map((d) => d.label)],
      ...tickets.map((t) => [
        t.number,
        t.title,
        t.status,
        t.priority,
        t.assigneeId,
        t.chatName,
        t.source,
        t.createdAt,
        t.dueAt,
        t.firstResponseAt,
        t.resolvedAt,
        t.breached ? 'yes' : 'no',
        ...defs.map((d) => propertyText(t.fields[d.key], d.type)),
      ]),
    ]);
  } else if (type === 'messages') {
    const chat = p.get('chat');
    if (!chat) return groupsError(400, 'missing_chat');
    const guard = await chatGuard(s, chat);
    if (guard instanceof NextResponse) return guard;
    const rows = (await getDb()
      .prepare(
        `SELECT m.created_at, m.direction, m.sender_name, m.sender_phone, m.author_id, m.body, m.media_type, m.status
         FROM groups_messages m WHERE m.chat_id = ? AND m.user_id = ? ORDER BY m.created_at LIMIT 50000`,
      )
      .all(chat, s.ws)) as Array<Record<string, unknown>>;
    body = csv([
      ['created_at', 'direction', 'sender_name', 'sender_phone', 'author_id', 'body', 'media_type', 'status'],
      ...rows.map((r) => [r.created_at, r.direction, r.sender_name, viewer.mask && r.sender_phone ? maskPhone(String(r.sender_phone)) : r.sender_phone, r.author_id, r.body, r.media_type, r.status]),
    ]);
    const { getChat } = await import('@/lib/groups');
    const c = await getChat(s.ws, chat);
    await recordAudit(s.ws, { chatId: chat, chatName: c?.name ?? '', actorId: s.me, action: 'exported', detail: { type: 'messages', rows: rows.length } });
  } else return groupsError(400, 'invalid_type');
  if (type !== 'messages') await recordAudit(s.ws, { chatId: null, actorId: s.me, action: 'exported', detail: { type } });
  return new NextResponse(body, {
    headers: {
      'content-type': 'text/csv; charset=utf-8',
      'content-disposition': `attachment; filename="groups-${type}-${new Date().toISOString().slice(0, 10)}.csv"`,
    },
  });
}
