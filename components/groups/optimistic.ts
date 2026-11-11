/**
 * Lines: la burbuja provisoria de un texto que se acaba de mandar (ver
 * lib/optimistic-send.ts). Se ve como cualquier mensaje saliente, con el reloj
 * de "enviando", hasta que el servidor responde.
 */
import type { MessageDto } from '@/lib/groups';
import { tempIdFor } from '@/lib/optimistic-send';

/** Con qué clientId se mandó un mensaje (provisorio o ya guardado: viene en meta.cid). */
export function cidOf(m: Pick<MessageDto, 'meta'>): string | undefined {
  const cid = (m.meta as Record<string, unknown> | undefined)?.cid;
  return typeof cid === 'string' ? cid : undefined;
}

export function tempMessage(input: { clientId: string; chatId: string; me: string; body: string; replyToId: string | null }): MessageDto {
  return {
    id: tempIdFor(input.clientId),
    chatId: input.chatId,
    direction: 'out',
    senderPhone: '',
    senderName: '',
    authorId: input.me,
    authorKind: 'person',
    body: input.body,
    media: null,
    replyToId: input.replyToId,
    reactions: [],
    status: 'pending',
    error: '',
    createdAt: new Date().toISOString(),
    ticketId: null,
    editedAt: null,
    deletedAt: null,
    pinnedAt: null,
    forwarded: false,
    translations: {},
    meta: { cid: input.clientId },
    needsReply: null,
  };
}
