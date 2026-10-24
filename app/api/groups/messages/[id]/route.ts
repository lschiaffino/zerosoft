import { NextResponse } from 'next/server';
import { getMessageRow, reactToMessage } from '@/lib/groups';
import { createTicket } from '@/lib/groups-tickets';
import type { TicketPriority } from '@/lib/groups-rules';
import { groupsError, groupsSession, handleGroupsError, readJson, str } from '@/lib/groups-http';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * Acciones sobre un mensaje: { action: 'react', emoji } (emoji vacío quita la
 * reacción) o { action: 'ticket', title?, priority?, assigneeId? }.
 */
export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const s = await groupsSession({ write: true });
  if (s instanceof NextResponse) return s;
  const id = (await ctx.params).id;
  const b = await readJson(req);
  try {
    if (b.action === 'react') return NextResponse.json(await reactToMessage(s.ws, s.me, id, str(b.emoji, 16) ?? ''));
    if (b.action === 'ticket') {
      const msg = await getMessageRow(s.ws, id);
      if (!msg) return groupsError(404, 'not_found');
      const res = await createTicket(s.ws, s.me, {
        chatId: msg.chat_id,
        messageId: msg.id,
        title: str(b.title, 200),
        priority: str(b.priority, 10) as TicketPriority | undefined,
        assigneeId: str(b.assigneeId, 100) || null,
        source: 'manual',
      });
      return NextResponse.json(res, { status: res.created ? 201 : 200 });
    }
    return groupsError(400, 'invalid_action');
  } catch (err) {
    return handleGroupsError(err);
  }
}
