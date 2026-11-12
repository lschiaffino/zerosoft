/**
 * Lines: el texto que se acaba de mandar (ver lib/optimistic-send.ts). Aparece
 * en el chat como cualquier mensaje saliente, con el reloj de "enviando",
 * hasta que el servidor responde. Lo que todavía no salió vive acá afuera del
 * componente del chat (y en sessionStorage): si falla después de que la
 * persona abrió otro chat, al volver está como no enviado, con reintentar.
 */
import type { MessageDto } from '@/lib/groups';
import { withTimeout } from '@/lib/conditional-fetch';
import { LINES_DRAFT_PREFIX, UNSENT_LINES_KEY, isTempId, sendQueueFor, tempIdFor, unsentStore, type Unsent } from '@/lib/optimistic-send';

/** Con qué clientId se mandó un mensaje (provisorio o ya guardado: viene en meta.cid). */
export function cidOf(m: Pick<MessageDto, 'meta'>): string | undefined {
  const cid = (m.meta as Record<string, unknown> | undefined)?.cid;
  return typeof cid === 'string' ? cid : undefined;
}

/** Lo que no salió de cada chat de Lines en esta pestaña (de la persona que lo escribió: ver `setOwner`). */
export const unsentLines = unsentStore<MessageDto>(UNSENT_LINES_KEY);

/**
 * El borrador de un chat de Lines en esta pestaña, de esta persona. Otra persona que entre en la misma pestaña (o el
 * mismo navegador) no ve ni manda lo que escribió la anterior; además se borran al cerrar sesión (clearOfflineData).
 */
export const linesDraftKey = (me: string, chatId: string) => `${LINES_DRAFT_PREFIX}${me}:${chatId}`;

/** Cuánto se espera la respuesta de un envío antes de darlo por no enviado (se puede reintentar sin duplicar). */
export const SEND_TIMEOUT_MS = 30_000;

/** La cola de envíos de un chat de Lines: textos, archivos, notas de voz y notas salen en el orden en que se mandaron. */
export const linesQueue = (chatId: string) => sendQueueFor(`lines:${chatId}`);

/** La burbuja de un texto que todavía no está guardado. */
export function tempMessage(u: Unsent, me: string): MessageDto {
  return {
    id: tempIdFor(u.clientId),
    chatId: u.chatId,
    direction: 'out',
    senderPhone: '',
    senderName: '',
    authorId: me,
    authorKind: 'person',
    body: u.body,
    media: null,
    replyToId: u.replyToId,
    reactions: [],
    status: u.status,
    error: u.error,
    createdAt: u.createdAt,
    ticketId: null,
    editedAt: null,
    deletedAt: null,
    pinnedAt: null,
    forwarded: false,
    translations: {},
    meta: { cid: u.clientId },
    needsReply: null,
  };
}

/** El orden del hilo: por hora y, a igual hora, por orden de llegada (lo que todavía no lo tiene va al final). */
export const byArrival = (a: MessageDto, b: MessageDto) => a.createdAt.localeCompare(b.createdAt) || (a.seq ?? Number.MAX_SAFE_INTEGER) - (b.seq ?? Number.MAX_SAFE_INTEGER);

/**
 * Los mensajes del hilo con lo que todavía no salió de ese chat: una burbuja
 * por cada texto pendiente o no enviado. Lo que el servidor ya trae (mismo
 * clientId) no se repite; `settled` devuelve esos, para sacarlos de lo
 * pendiente.
 */
export function withUnsent(messages: MessageDto[], unsent: Unsent[], me: string): { messages: MessageDto[]; settled: string[] } {
  const real = messages.filter((m) => !isTempId(m.id));
  const have = new Set(real.map(cidOf).filter((c): c is string => !!c));
  const settled = unsent.filter((u) => have.has(u.clientId)).map((u) => u.clientId);
  const temps = unsent.filter((u) => !have.has(u.clientId)).map((u) => tempMessage(u, me));
  // Sin nada pendiente y sin provisorias que sacar: la misma lista (no se redibuja).
  if (!temps.length && real.length === messages.length) return { messages, settled };
  return { messages: [...real, ...temps].sort(byArrival), settled };
}

/**
 * Manda (o vuelve a mandar) un texto pendiente. Corre fuera del componente:
 * termina aunque el chat ya no esté abierto, y el resultado queda en
 * `unsentLines` (guardado: sale de ahí; no salió: queda como no enviado).
 */
export function sendLinesText(clientId: string): void {
  const entry = unsentLines.pending(clientId);
  if (!entry) return;
  void linesQueue(entry.chatId)(async () => {
    // fetch directo (no el `api` de ./ui): este módulo no depende de ningún componente.
    let saved: MessageDto | null = null;
    let error = 'network';
    try {
      const res = await fetch(`/api/groups/chats/${entry.chatId}/messages`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ note: false, replyToId: entry.replyToId, body: entry.body, media: null, clientId: entry.clientId }),
        // Sin respuesta en 30 s: queda como no enviado, con reintentar (el mismo clientId: si sí había salido, el
        // servidor devuelve el que ya guardó y no lo manda otra vez). La cola del chat no se traba.
        signal: withTimeout(undefined, SEND_TIMEOUT_MS),
      });
      const json = (await res.json().catch(() => ({}))) as Record<string, unknown>;
      if (res.ok && typeof json.id === 'string') saved = json as unknown as MessageDto;
      else error = typeof json.error === 'string' ? json.error : 'server_error';
    } catch {
      /* sin red */
    }
    if (saved) unsentLines.saved(entry.clientId, saved);
    else unsentLines.fail(entry.clientId, error);
  });
}
