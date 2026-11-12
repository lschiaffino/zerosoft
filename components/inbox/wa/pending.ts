/**
 * Inbox (WhatsApp): la burbuja provisoria de un texto que se acaba de mandar
 * (ver lib/optimistic-send.ts) y lo que vuelve del servidor al terminar un
 * envío. Todo va con el id de SU chat: la respuesta de un envío puede llegar
 * cuando la persona ya abrió otro, y nunca se pinta en el que está a la vista
 * si no es el suyo.
 */
import type { MessageDto } from '@/lib/inbox/types';
import { dropSettled, isTempId, sendQueueFor, tempIdFor } from '@/lib/optimistic-send';

export type PendingEvent =
  /** Se apretó Enter: aparece la burbuja. */
  | { type: 'add'; threadId: string; message: MessageDto }
  /** El envío no salió: la burbuja se va (el texto vuelve al campo, o queda como borrador del chat). */
  | { type: 'drop'; threadId: string; id: string }
  /** El servidor respondió con la página de mensajes de ese chat (de un texto, un archivo o una nota de voz). */
  | { type: 'sent'; threadId: string; messages: MessageDto[]; id?: string };

const listeners = new Set<(e: PendingEvent) => void>();
/** Las burbujas cuyo envío sigue en curso en esta pestaña. Una que no está acá ya no se muestra. */
const inFlight = new Set<string>();

export const pendingSends = {
  emit(e: PendingEvent): void {
    if (e.type === 'add') inFlight.add(e.message.id);
    else if (e.id) inFlight.delete(e.id);
    for (const fn of [...listeners]) fn(e);
  },
  subscribe(fn: (e: PendingEvent) => void): () => void {
    listeners.add(fn);
    return () => {
      listeners.delete(fn);
    };
  },
  /** ¿El envío de esta burbuja sigue en curso? */
  active: (id: string): boolean => inFlight.has(id),
};

/** La cola de envíos de un chat de Inbox: textos, archivos y notas de voz salen en el orden en que se mandaron. */
export const inboxQueue = (threadId: string) => sendQueueFor(`inbox:${threadId}`);

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

/** Las burbujas provisorias de una conversación cuyo envío sigue en curso (las demás ya no tienen por qué verse). */
const liveTemps = (messages: MessageDto[]) => messages.filter((m) => isTempId(m.id) && pendingSends.active(m.id));

/**
 * Aplica un aviso a una conversación (la que está a la vista, o una guardada
 * en la caché de chats ya abiertos) SOLO si es la de ese chat. Devuelve la
 * misma si no le corresponde.
 */
export function applyPending<D extends WithMessages>(detail: D | null, e: PendingEvent): D | null {
  if (!detail || detail.thread.id !== e.threadId) return detail;
  if (e.type === 'drop') return { ...detail, messages: detail.messages.filter((m) => m.id !== e.id) };
  if (e.type === 'add') return { ...detail, messages: [...detail.messages.filter((m) => m.id !== e.message.id), e.message] };
  // La página del servidor, más lo que todavía se está mandando a este chat (otro texto escrito enseguida).
  return keepPending(detail, { ...detail, messages: e.messages });
}

/**
 * La conversación recién leída del servidor, con las burbujas provisorias que
 * había en pantalla, cuyo envío sigue en curso y cuyo mensaje guardado todavía
 * no llegó (las demás ya vienen en `next`, como mensajes de verdad, o su envío
 * terminó).
 */
export function keepPending<D extends WithMessages>(prev: WithMessages | null, next: D): D {
  const clean = next.messages.some((m) => isTempId(m.id)) ? next.messages.filter((m) => !isTempId(m.id)) : next.messages;
  const temps = prev && prev.thread.id === next.thread.id ? dropSettled(liveTemps(prev.messages), clean, cidOf) : [];
  if (!temps.length && clean === next.messages) return next;
  return { ...next, messages: [...clean, ...temps] };
}

/** Una conversación guardada, sin burbujas cuyo envío ya terminó (o se perdió): nunca queda un "enviando" para siempre. */
export function withoutStale<D extends WithMessages>(detail: D): D {
  const stale = detail.messages.some((m) => isTempId(m.id) && !pendingSends.active(m.id));
  return stale ? { ...detail, messages: detail.messages.filter((m) => !isTempId(m.id) || pendingSends.active(m.id)) } : detail;
}
