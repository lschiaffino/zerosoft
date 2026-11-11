/**
 * Inbox (WhatsApp): la burbuja provisoria de un texto que se acaba de mandar
 * (ver lib/optimistic-send.ts). El composer la anuncia acá; la app la suma a
 * la conversación abierta y la conserva mientras el envío está en curso,
 * aunque la conversación se relea en el medio.
 */
import type { MessageDto } from '@/lib/inbox/types';
import { dropSettled, isTempId, tempIdFor } from '@/lib/optimistic-send';

export type PendingEvent = { type: 'add'; threadId: string; message: MessageDto } | { type: 'drop'; threadId: string; id: string };

const listeners = new Set<(e: PendingEvent) => void>();

export const pendingSends = {
  emit(e: PendingEvent): void {
    for (const fn of [...listeners]) fn(e);
  },
  subscribe(fn: (e: PendingEvent) => void): () => void {
    listeners.add(fn);
    return () => {
      listeners.delete(fn);
    };
  },
};

export function tempInboxMessage(clientId: string, body: string): MessageDto {
  return {
    id: tempIdFor(clientId),
    fromMe: true,
    senderName: '',
    senderHandle: '',
    subject: '',
    body,
    emailTo: '',
    mediaType: '',
    mediaName: '',
    hasMedia: false,
    status: 'pending',
    edited: false,
    revoked: false,
    sentAt: new Date().toISOString(),
    reply: null,
    reactions: [],
    meta: { cid: clientId },
  };
}

const cidOf = (m: MessageDto): string | undefined => m.meta?.cid;

interface WithMessages {
  thread: { id: string };
  messages: MessageDto[];
}

/** Suma (o saca) una burbuja provisoria de la conversación abierta, si es la de ese chat. */
export function applyPending<D extends WithMessages>(detail: D | null, e: PendingEvent): D | null {
  if (!detail || detail.thread.id !== e.threadId) return detail;
  if (e.type === 'drop') return { ...detail, messages: detail.messages.filter((m) => m.id !== e.id) };
  return { ...detail, messages: [...detail.messages.filter((m) => m.id !== e.message.id), e.message] };
}

/**
 * La conversación recién leída del servidor, con las burbujas provisorias que
 * había en pantalla y cuyo mensaje guardado todavía no llegó (las demás ya
 * vienen en `next`, como mensajes de verdad).
 */
export function keepPending<D extends WithMessages>(prev: WithMessages | null, next: D): D {
  if (!prev || prev.thread.id !== next.thread.id) return next;
  const temps = dropSettled(
    prev.messages.filter((m) => isTempId(m.id)),
    next.messages,
    cidOf,
  );
  return temps.length ? { ...next, messages: [...next.messages.filter((m) => !isTempId(m.id)), ...temps] } : next;
}
