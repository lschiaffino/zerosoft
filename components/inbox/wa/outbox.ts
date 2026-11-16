/**
 * Inbox (WhatsApp) sin conexión: un texto escrito sin red queda en el chat con el reloj y sale solo cuando vuelve la
 * conexión, en el orden en que se escribió y una sola vez (el mismo clientId en cada intento; una pestaña a la vez:
 * lib/optimistic-send.ts, `offlineOutbox`). Si el servidor lo rechaza, queda como no enviado con reintentar o quitar.
 * Los archivos no se encolan: necesitan conexión para subirse (el composer lo avisa y los deja en la bandeja).
 */
import type { MessageDto } from '@/lib/inbox/types';
import { withTimeout } from '@/lib/conditional-fetch';
import { isOffline, offlineOutbox, TEMP_PREFIX } from '@/lib/optimistic-send';
import { api } from '../api';
import { inboxQueue, unsentInbox } from './pending';

/** Lo que el composer manda a la cola: el texto como sale (menciones ya en "@<teléfono>"). */
export interface QueuedText {
  threadId: string;
  body: string;
  replyTo?: string | null;
  mentions?: string[];
  noPreview?: boolean;
  /** El de un envío que ya había empezado (se cortó la red a mitad): el mismo, así no se duplica. */
  clientId?: string;
}

/** Deja un texto en la cola de su chat (la burbuja aparece con el reloj) y, si hay red, la cola sigue. */
export function queueInboxText(input: QueuedText): string {
  const entry = unsentInbox.add(
    {
      chatId: input.threadId,
      body: input.body,
      replyToId: input.replyTo ?? null,
      ...(input.mentions?.length ? { mentions: input.mentions } : {}),
      ...(input.noPreview ? { noPreview: true } : {}),
      ...(input.clientId ? { clientId: input.clientId } : {}),
    },
    'queued',
  );
  if (!isOffline()) void inboxOutbox.flush();
  return entry.clientId;
}

/** ¿Hay algo de este chat esperando la red? Lo nuevo va detrás, para no adelantarse. */
export const hasQueued = (threadId: string): boolean => unsentInbox.queued(threadId).length > 0;

/**
 * Manda (o vuelve a mandar) un texto de la cola. Sin red queda en cola; con algo de su chat esperando antes que él,
 * también (sale detrás). Termina cuando se sabe cómo le fue.
 */
export function sendInboxUnsent(clientId: string, fromQueue = false): Promise<void> {
  const current = unsentInbox.get(clientId);
  if (!current) return Promise.resolve();
  const behind = !fromQueue && unsentInbox.queued(current.chatId).some((x) => x.clientId !== clientId);
  if (isOffline() || behind) {
    unsentInbox.queue(clientId);
    if (!isOffline()) void inboxOutbox.flush();
    return Promise.resolve();
  }
  const entry = unsentInbox.pending(clientId);
  if (!entry) return Promise.resolve();
  return inboxQueue(entry.chatId)(async () => {
    const r = await api<{ messages: MessageDto[] }>(`/api/inbox/threads/${entry.chatId}/messages`, {
      method: 'POST',
      json: {
        body: entry.body,
        clientId: entry.clientId,
        ...(entry.replyToId ? { replyTo: entry.replyToId } : {}),
        ...(entry.mentions?.length ? { mentions: entry.mentions } : {}),
        ...(entry.noPreview ? { linkPreview: false } : {}),
      },
      signal: withTimeout(undefined, 30_000),
    });
    if (r.ok && Array.isArray(r.data.messages)) return unsentInbox.saved(entry.clientId, r.data.messages);
    // Se cortó la red mientras salía: vuelve a la cola, con el mismo clientId.
    if (r.status === 0 && isOffline()) return unsentInbox.queue(entry.clientId);
    unsentInbox.fail(entry.clientId, r.data.error ?? 'send_failed');
  });
}

/** La cola de Inbox: la arranca InboxApp cuando sabe quién es la persona. */
export const inboxOutbox = offlineOutbox(unsentInbox, 'zs-outbox:inbox', (clientId) => sendInboxUnsent(clientId, true));

/** ¿Esta burbuja es un texto de la cola (esperando, saliendo o rechazado)? */
export const queuedText = (tempId: string) => (tempId.startsWith(TEMP_PREFIX) ? unsentInbox.get(tempId.slice(TEMP_PREFIX.length)) : undefined);

/** Reintentar un texto que el servidor rechazó (la misma burbuja, otra vez con el reloj). */
export const retryInboxText = (tempId: string): void => void sendInboxUnsent(tempId.slice(TEMP_PREFIX.length));

/** Borrar un texto de la cola antes de que salga, o uno que no salió. */
export const discardInboxText = (tempId: string): void => unsentInbox.remove(tempId.slice(TEMP_PREFIX.length));
