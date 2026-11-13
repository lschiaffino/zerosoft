/**
 * Lines: el texto que se acaba de mandar (ver lib/optimistic-send.ts). Aparece
 * en el chat como cualquier mensaje saliente, con el reloj de "enviando",
 * hasta que el servidor responde. Lo que todavía no salió vive acá afuera del
 * componente del chat (y en sessionStorage): si falla después de que la
 * persona abrió otro chat, al volver está como no enviado, con reintentar.
 */
import type { MessageDto } from '@/lib/groups';
import { withTimeout } from '@/lib/conditional-fetch';
import { LINES_DRAFT_PREFIX, UNSENT_LINES_KEY, isTempId, localPreviews, sendQueueFor, tempIdFor, unsentStore, uploadProgress, type Unsent, type UnsentMedia } from '@/lib/optimistic-send';
import { uploadWithProgress, type UploadedFile } from './wa/attachments';

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
export const linesDraftKey = (me: string, chatId: string) => {
  const key = `${LINES_DRAFT_PREFIX}${me}:${chatId}`;
  migrateDraft(me, chatId, key);
  return key;
};

/**
 * Un borrador de antes de que la clave llevara a la persona (`gr-draft:<chat>`): pasa a la clave nueva la primera vez
 * que se lee, para que no se pierda lo que alguien estaba escribiendo cuando se actualizó la app. Solo si la persona
 * ya está (me) y la clave nueva todavía no tiene nada.
 */
function migrateDraft(me: string, chatId: string, key: string): void {
  if (!me || typeof sessionStorage === 'undefined') return;
  try {
    const old = `${LINES_DRAFT_PREFIX}${chatId}`;
    const text = sessionStorage.getItem(old);
    if (text === null) return;
    if (!sessionStorage.getItem(key)) sessionStorage.setItem(key, text);
    sessionStorage.removeItem(old);
  } catch {
    // Sin almacenamiento: nada que mover.
  }
}

/** Cuánto se espera la respuesta de un envío antes de darlo por no enviado (se puede reintentar sin duplicar). */
export const SEND_TIMEOUT_MS = 30_000;
/**
 * Un archivo: el servidor espera hasta 90 s a que el gateway lo baje, lo convierta y lo suba a WhatsApp
 * (lib/groups-provider-bridge.ts). La pantalla espera más que eso: si cortara antes, el archivo saldría igual y la
 * cola dejaría pasar lo que sigue antes de tiempo.
 */
export const MEDIA_SEND_TIMEOUT_MS = 100_000;

/** La cola de envíos de un chat de Lines: textos, archivos, notas de voz y notas salen en el orden en que se mandaron. */
export const linesQueue = (chatId: string) => sendQueueFor(`lines:${chatId}`);

/** El archivo de la burbuja provisoria: la copia local mientras exista, si no lo ya subido. */
function tempMedia(u: Unsent): MessageDto['media'] {
  const m = u.media;
  if (!m) return null;
  return {
    url: localPreviews.get(u.clientId) ?? m.url ?? '',
    type: m.type,
    name: m.name,
    kind: m.kind,
    size: m.size,
    ...(m.width && m.height ? { width: m.width, height: m.height } : {}),
    ...(m.duration ? { duration: m.duration } : {}),
    ...(m.kind === 'voice' ? { ptt: true } : {}),
  };
}

/**
 * El archivo de un mensaje ya guardado que se mandó desde esta pestaña: mientras siga su copia local, esa (el
 * mensaje real reemplaza a la burbuja sin volver a bajar la foto ni cortar el audio).
 */
export function withLocalMedia(m: MessageDto): MessageDto['media'] {
  const local = m.media ? localPreviews.get(cidOf(m)) : undefined;
  return local && m.media ? { ...m.media, url: local } : m.media;
}

/** La burbuja de un mensaje (texto o archivo) que todavía no está guardado. */
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
    media: tempMedia(u),
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

// El archivo de cada envío de esta pestaña (para subirlo, o volver a subirlo si falló) y su subida en curso.
const files = new Map<string, File>();
const uploads = new Map<string, Promise<UploadedFile>>();

function upload(clientId: string): Promise<UploadedFile> | null {
  const running = uploads.get(clientId);
  if (running) return running;
  const file = files.get(clientId);
  if (!file) return null;
  const up = uploadWithProgress(file, (p) => uploadProgress.set(clientId, p)).done;
  uploads.set(clientId, up);
  up.catch(() => uploads.get(clientId) === up && uploads.delete(clientId));
  return up;
}

/**
 * Manda un archivo con la burbuja ya a la vista (foto, video, audio, nota de voz, documento, sticker): aparece con su
 * copia local y el reloj, se sube por detrás (o sigue la subida que ya había empezado en la bandeja) y sale por la
 * cola del chat con su clientId. Todo con el chat de cuando se mandó: cambiar de chat no lo pierde ni lo manda a otro.
 */
export function sendLinesMedia(input: {
  chatId: string;
  body: string;
  replyToId: string | null;
  file: File;
  media: UnsentMedia;
  /** Vista previa local que ya existe (la de la bandeja); si no, se crea una. */
  preview?: string;
  /** La subida que ya está en curso (o terminada) desde la bandeja. */
  upload?: Promise<UploadedFile> | null;
}): string {
  const entry = unsentLines.add({ chatId: input.chatId, body: input.body, replyToId: input.replyToId, media: input.media });
  const cid = entry.clientId;
  const preview = input.preview || (typeof URL !== 'undefined' && typeof URL.createObjectURL === 'function' ? URL.createObjectURL(input.file) : '');
  if (preview) localPreviews.set(cid, preview, `lines:${input.chatId}`, input.media.kind);
  files.set(cid, input.file);
  if (input.upload) {
    uploads.set(cid, input.upload);
    input.upload.catch(() => uploads.get(cid) === input.upload && uploads.delete(cid));
  } else if (!input.media.url) upload(cid);
  sendLinesText(cid);
  return cid;
}

/** Se descarta un envío que no salió: su burbuja, su archivo y su copia local. */
export function discardLinesSend(clientId: string): void {
  files.delete(clientId);
  uploads.delete(clientId);
  uploadProgress.clear(clientId);
  localPreviews.release(clientId);
  unsentLines.remove(clientId);
}

/**
 * Manda (o vuelve a mandar) un texto o un archivo pendiente. Corre fuera del
 * componente: termina aunque el chat ya no esté abierto, y el resultado queda
 * en `unsentLines` (guardado: sale de ahí; no salió: queda como no enviado).
 * Un archivo que todavía no está subido se sube primero (o se espera la subida
 * que ya está en curso); un reintento después de una subida que falló la
 * vuelve a empezar con el mismo archivo.
 */
export function sendLinesText(clientId: string): void {
  const entry = unsentLines.pending(clientId);
  if (!entry) return;
  // La subida empieza ya (no espera su turno en la cola); el envío sí sale en orden.
  const up = entry.media && !entry.media.url ? upload(clientId) : null;
  void linesQueue(entry.chatId)(async () => {
    let media = entry.media;
    if (media && !media.url) {
      let uploaded: UploadedFile | null = null;
      let error = 'upload_failed';
      try {
        if (up) uploaded = await up;
      } catch (err) {
        error = (err as Error).message || error;
      }
      if (!uploaded?.url) {
        uploadProgress.clear(clientId);
        unsentLines.fail(clientId, error);
        return;
      }
      media = { ...media, url: uploaded.url, type: uploaded.mimetype || media.type, name: uploaded.filename || media.name, size: uploaded.size || media.size, ...(uploaded.width ? { width: uploaded.width, height: uploaded.height } : {}), ...(uploaded.duration && !media.duration ? { duration: uploaded.duration } : {}) };
      unsentLines.setMedia(clientId, media);
    }
    // fetch directo (no el `api` de ./ui): este módulo no depende de ningún componente.
    let saved: MessageDto | null = null;
    let error = 'network';
    try {
      const res = await fetch(`/api/groups/chats/${entry.chatId}/messages`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          note: false,
          replyToId: entry.replyToId,
          body: entry.body,
          media: media
            ? { url: media.url, mimetype: media.type, filename: media.name, size: media.size, kind: media.kind, width: media.width, height: media.height, duration: media.duration, ...(media.kind === 'voice' ? { voice: true } : {}) }
            : null,
          clientId: entry.clientId,
        }),
        // Sin respuesta a tiempo: queda como no enviado, con reintentar (el mismo clientId: si sí había salido, el
        // servidor devuelve el que ya guardó y no lo manda otra vez). La cola del chat no se traba.
        signal: withTimeout(undefined, media ? MEDIA_SEND_TIMEOUT_MS : SEND_TIMEOUT_MS),
      });
      const json = (await res.json().catch(() => ({}))) as Record<string, unknown>;
      if (res.ok && typeof json.id === 'string') saved = json as unknown as MessageDto;
      else error = typeof json.error === 'string' ? json.error : 'server_error';
    } catch {
      /* sin red */
    }
    if (saved) {
      files.delete(clientId);
      uploads.delete(clientId);
      uploadProgress.clear(clientId);
      localPreviews.settle(clientId, saved.media?.url);
      unsentLines.saved(entry.clientId, saved);
    } else unsentLines.fail(entry.clientId, error);
  });
}
