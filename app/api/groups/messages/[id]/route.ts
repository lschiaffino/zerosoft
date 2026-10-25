import { NextResponse } from 'next/server';
import { getMessageRow, reactToMessage } from '@/lib/groups';
import { deleteMessage, editMessage, forwardMessage, pinMessage } from '@/lib/groups-inbox';
import { createTicket } from '@/lib/groups-tickets';
import type { TicketPriority } from '@/lib/groups-rules';
import { groupsError, groupsSession, handleGroupsError, readJson, str, strArr } from '@/lib/groups-http';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * Acciones sobre un mensaje: { action: 'react', emoji } (emoji vacío quita la
 * reacción), { action: 'ticket', title?, priority?, assigneeId? },
 * { action: 'edit', body } (nota o mensaje propio), { action: 'pin' | 'unpin' }
 * y { action: 'forward', chatIds }.
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
    if (b.action === 'edit') return NextResponse.json(await editMessage(s.ws, { me: s.me, isAdmin: s.isAdmin }, id, str(b.body) ?? ''));
    if (b.action === 'pin' || b.action === 'unpin') return NextResponse.json(await pinMessage(s.ws, s.me, id, b.action === 'pin'));
    if (b.action === 'forward') return NextResponse.json({ results: await forwardMessage(s.ws, s.me, id, strArr(b.chatIds, 20)) });
    return groupsError(400, 'invalid_action');
  } catch (err) {
    return handleGroupsError(err);
  }
}

/** Borra una nota, o un mensaje propio para todos en WhatsApp (queda marcado como borrado). */
export async function DELETE(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const s = await groupsSession({ write: true });
  if (s instanceof NextResponse) return s;
  try {
    return NextResponse.json(await deleteMessage(s.ws, { me: s.me, isAdmin: s.isAdmin }, (await ctx.params).id));
  } catch (err) {
    return handleGroupsError(err);
  }
}
