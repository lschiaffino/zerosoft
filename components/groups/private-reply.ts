'use client';

import type { MessageDto, ReplyQuote } from '@/lib/groups';

/**
 * "Responder en privado" en Lines: el mensaje del grupo viaja al chat 1:1 de
 * quien lo mandó. El hilo del grupo lo deja acá antes de navegar y el hilo del
 * 1:1 lo toma al abrirse (una vez), con la respuesta citándolo.
 */
const pending = new Map<string, { message: MessageDto; quote: ReplyQuote }>();

/** Lo citado en privado que ya se usó, por id de mensaje (para dibujar la cita antes de que vuelva del servidor). */
const known = new Map<string, ReplyQuote>();

export function quoteFromGroup(m: MessageDto, chat: { id: string; name: string }): ReplyQuote {
  return {
    id: m.id,
    chatId: chat.id,
    chatName: chat.name,
    direction: m.direction,
    senderName: m.senderName,
    senderPhone: m.senderPhone,
    body: m.deletedAt ? '' : m.body.slice(0, 300),
    mediaType: m.media?.type ?? '',
    deleted: !!m.deletedAt,
  };
}

export function setPendingPrivateReply(dmId: string, message: MessageDto, chat: { id: string; name: string }): void {
  const quote = quoteFromGroup(message, chat);
  pending.set(dmId, { message, quote });
  known.set(message.id, quote);
}

export function peekPendingPrivateReply(dmId: string): boolean {
  return pending.has(dmId);
}

export function takePendingPrivateReply(dmId: string): { message: MessageDto; quote: ReplyQuote } | null {
  const p = pending.get(dmId) ?? null;
  pending.delete(dmId);
  return p;
}

export function knownPrivateQuote(id: string | null | undefined): ReplyQuote | null {
  return id ? (known.get(id) ?? null) : null;
}
