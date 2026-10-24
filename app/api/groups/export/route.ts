import { NextResponse } from 'next/server';
import { getDb } from '@/lib/db';
import { listChats } from '@/lib/groups';
import { listTickets } from '@/lib/groups-tickets';
import { groupsError, groupsSession } from '@/lib/groups-http';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** Celda CSV: comillas si hace falta y sin fórmulas (= + - @ al inicio). */
function cell(v: unknown): string {
  let s = v == null ? '' : String(v);
  if (/^[=+\-@\t\r]/.test(s)) s = `'${s}`;
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
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
  let body: string;
  if (type === 'chats') {
    const { rows } = await listChats(s.ws, s.me, { filter: 'all', limit: 200 });
    const closed = await listChats(s.ws, s.me, { filter: 'closed', limit: 200 });
    body = csv([
      ['id', 'kind', 'name', 'phone', 'members', 'status', 'assigned_to', 'labels', 'last_message_at', 'awaiting_since', 'crm_company_id', 'crm_contact_id', 'properties'],
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
        JSON.stringify(c.properties),
      ]),
    ]);
  } else if (type === 'tickets') {
    const tickets = await listTickets(s.ws, { status: 'all', limit: 500 });
    body = csv([
      ['number', 'title', 'status', 'priority', 'assignee_id', 'chat', 'source', 'created_at', 'due_at', 'first_response_at', 'resolved_at', 'breached'],
      ...tickets.map((t) => [t.number, t.title, t.status, t.priority, t.assigneeId, t.chatName, t.source, t.createdAt, t.dueAt, t.firstResponseAt, t.resolvedAt, t.breached ? 'yes' : 'no']),
    ]);
  } else if (type === 'messages') {
    const chat = p.get('chat');
    if (!chat) return groupsError(400, 'missing_chat');
    const rows = (await getDb()
      .prepare(
        `SELECT m.created_at, m.direction, m.sender_name, m.sender_phone, m.author_id, m.body, m.media_type, m.status
         FROM groups_messages m WHERE m.chat_id = ? AND m.user_id = ? ORDER BY m.created_at LIMIT 50000`,
      )
      .all(chat, s.ws)) as Array<Record<string, unknown>>;
    body = csv([
      ['created_at', 'direction', 'sender_name', 'sender_phone', 'author_id', 'body', 'media_type', 'status'],
      ...rows.map((r) => [r.created_at, r.direction, r.sender_name, r.sender_phone, r.author_id, r.body, r.media_type, r.status]),
    ]);
  } else return groupsError(400, 'invalid_type');
  return new NextResponse(body, {
    headers: {
      'content-type': 'text/csv; charset=utf-8',
      'content-disposition': `attachment; filename="groups-${type}-${new Date().toISOString().slice(0, 10)}.csv"`,
    },
  });
}
