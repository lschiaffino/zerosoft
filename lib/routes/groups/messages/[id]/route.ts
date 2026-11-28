import { NextResponse } from 'next/server';
import { getMessageRow, reactToMessage, type MessageDto } from '@/lib/groups';
import { deleteMessage, editMessage, forwardMessage, pinMessage, reportMessage } from '@/lib/groups-inbox';
import { createTicket } from '@/lib/groups-tickets';
import type { TicketPriority } from '@/lib/groups-rules';
import { chatGuard, groupsError, groupsSession, handleGroupsError, readJson, str, strArr } from '@/lib/groups-http';
import { canSeeChat, maskChatName, maskMessage, maskTicket, unmaskEdit } from '@/lib/groups-access';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * Acciones sobre un mensaje: { action: 'react', emoji } (emoji vacío quita la
 * reacción), { action: 'ticket', title?, priority?, assigneeId? },
 * { action: 'edit', body } (nota o mensaje propio), { action: 'pin' | 'unpin' },
 * { action: 'forward', chatIds } y { action: 'report', block?, leave? }.
 */
export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const s = await groupsSession({ write: true });
  if (s instanceof NextResponse) return s;
  const id = (await ctx.params).id;
  const target = await getMessageRow(s.ws, id);
  if (!target) return groupsError(404, 'not_found');
  const guard = await chatGuard(s, target.chat_id);
  if (guard instanceof NextResponse) return guard;
  const b = await readJson(req);
  // Lo que vuelve pasa por la máscara de teléfonos de quien pide, como el hilo (GET de los mensajes).
  const mask = <T extends { message: MessageDto | null }>(res: T): T => ({ ...res, message: res.message ? maskMessage(guard.viewer, res.message) : null });
  try {
    if (b.action === 'react') return NextResponse.json(maskMessage(guard.viewer, await reactToMessage(s.ws, s.me, id, str(b.emoji, 16) ?? '')));
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
      return NextResponse.json({ ...res, ticket: maskTicket(guard.viewer, res.ticket) }, { status: res.created ? 201 : 200 });
    }
    if (b.action === 'retry') {
      const { retryMessage } = await import('@/lib/groups');
      return NextResponse.json(maskMessage(guard.viewer, await retryMessage(s.ws, s.me, id, s.isAdmin)));
    }
    if (b.action === 'star' || b.action === 'unstar') {
      const { starMessage } = await import('@/lib/groups-inbox');
      return NextResponse.json(maskMessage(guard.viewer, await starMessage(s.ws, id, b.action === 'star')));
    }
    if (b.action === 'edit') {
      // Una nota que llegó con los teléfonos ocultos: cada uno enmascarado vuelve a su número guardado.
      let text = str(b.body) ?? '';
      if (guard.viewer.mask) {
        const raw = await getMessageRow(s.ws, id);
        if (raw?.direction === 'note') text = unmaskEdit(raw.body, text);
      }
      return NextResponse.json(maskMessage(guard.viewer, await editMessage(s.ws, { me: s.me, isAdmin: s.isAdmin }, id, text)));
    }
    if (b.action === 'pin' || b.action === 'unpin') return NextResponse.json(mask(await pinMessage(s.ws, s.me, id, b.action === 'pin')));
    if (b.action === 'report') return NextResponse.json(mask(await reportMessage(s.ws, s.me, id, { block: b.block === true, leave: b.leave === true })));
    if (b.action === 'forward') {
      // Solo a chats que esta persona puede ver (acceso por etiqueta).
      const targets: string[] = [];
      for (const c of strArr(b.chatIds, 20)) if (await canSeeChat(guard.viewer, c)) targets.push(c);
      const results = await forwardMessage(s.ws, s.me, id, targets);
      return NextResponse.json({ results: results.map((r) => ({ ...r, name: maskChatName(guard.viewer, r.name) })) });
    }
    return groupsError(400, 'invalid_action');
  } catch (err) {
    return handleGroupsError(err);
  }
}

/** Borra una nota, o un mensaje propio para todos en WhatsApp (queda marcado como borrado). */
export async function DELETE(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const s = await groupsSession({ write: true });
  if (s instanceof NextResponse) return s;
  const id = (await ctx.params).id;
  const target = await getMessageRow(s.ws, id);
  if (!target) return groupsError(404, 'not_found');
  const guard = await chatGuard(s, target.chat_id);
  if (guard instanceof NextResponse) return guard;
  try {
    const res = await deleteMessage(s.ws, { me: s.me, isAdmin: s.isAdmin }, id);
    return NextResponse.json({ ...res, message: res.message ? maskMessage(guard.viewer, res.message) : null });
  } catch (err) {
    return handleGroupsError(err);
  }
}
