/**
 * Inbox (WhatsApp): la burbuja provisoria de un texto que se acaba de mandar
 * (ver lib/optimistic-send.ts) y lo que vuelve del servidor al terminar un
 * envío. Todo va con el id de SU chat: la respuesta de un envío puede llegar
 * cuando la persona ya abrió otro, y nunca se pinta en el que está a la vista
 * si no es el suyo.
 */
import type { MessageDto } from '@/lib/inbox/types';
import { dropSettled, isTempId, localPreviews, sendQueueFor, tempIdFor, type UnsentMedia } from '@/lib/optimistic-send';

export type PendingEvent =
  /** Se apretó Enter (o se mandó un archivo): aparece la burbuja. Con el id de una que ya está, la cambia en su lugar. */
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

/**
 * Cuánto se espera la respuesta de un archivo: más que lo que el servidor espera al gateway (90 s, que lo baja, lo
 * convierte y lo sube a WhatsApp). Si la pantalla cortara antes, el archivo saldría igual y la cola del chat dejaría
 * pasar lo que sigue antes de tiempo.
 */
export const MEDIA_SEND_TIMEOUT_MS = 100_000;

/** La cola de envíos de un chat de Inbox: textos, archivos y notas de voz salen en el orden en que se mandaron. */
export const inboxQueue = (threadId: string) => sendQueueFor(`inbox:${threadId}`);

export function tempInboxMessage(clientId: string, body: string, noPreview = false): MessageDto {
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
    meta: { cid: clientId, ...(noPreview ? { noPreview: true } : {}) },
  };
}

/**
 * La burbuja de un archivo que se acaba de mandar (foto, video, audio, nota de voz, documento, sticker): con la copia
 * local para verlo o escucharlo ya, el reloj, y su clientId. `failed`: no salió (reintentar o quitar).
 */
export function tempInboxMedia(clientId: string, media: UnsentMedia, caption: string, status: 'pending' | 'failed' = 'pending', sentAt = new Date().toISOString()): MessageDto {
  const voice = media.kind === 'voice';
  return {
    ...tempInboxMessage(clientId, caption),
    // Inbox guarda la nota de voz como audio con ptt.
    mediaType: voice ? 'audio' : media.kind,
    mediaName: media.name,
    hasMedia: true,
    status,
    sentAt,
    meta: {
      cid: clientId,
      mime: media.type,
      size: media.size,
      ...(media.width && media.height ? { width: media.width, height: media.height } : {}),
      ...(media.duration ? { duration: media.duration } : {}),
      ...(voice ? { ptt: true } : {}),
    },
  };
}

/**
 * Dónde se ve el archivo de un mensaje: la copia local mientras exista (la burbuja provisoria, y el mensaje guardado
 * que la reemplaza, sin volver a bajarlo), si no el del servidor. Una provisoria sin copia local no tiene archivo.
 */
export function inboxMediaUrl(m: Pick<MessageDto, 'id' | 'hasMedia' | 'meta'>): string {
  if (!m.hasMedia) return '';
  return localPreviews.get(m.meta?.cid ?? undefined) ?? (isTempId(m.id) ? '' : `/api/inbox/media/${m.id}`);
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
  if (e.type === 'add') {
    // La misma burbuja otra vez (cambió su estado: no salió, o se reintenta): en su lugar, no al final.
    const at = detail.messages.findIndex((m) => m.id === e.message.id);
    if (at >= 0) return { ...detail, messages: detail.messages.map((m, i) => (i === at ? e.message : m)) };
    return { ...detail, messages: [...detail.messages, e.message] };
  }
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
