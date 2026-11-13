/**
 * Inbox: mandar archivos por WhatsApp (fotos, videos, audios, notas de voz,
 * documentos), con comentario y como respuesta. Hasta 4 MB el archivo viene
 * en el pedido y sale en base64; más grande, el navegador lo sube directo a
 * Blob (lib/routes/inbox/upload) y el servidor de WhatsApp lo baja por URL:
 * apenas sale, se borra de Blob. Server-only.
 */
import { baseMime, MEDIA_KINDS, MediaPlanError, planOutboundKind, WA_MEDIA_LIMITS, type MediaKind } from '../groups-media';
import { ProviderError } from '../groups-provider';
import { deleteUploads } from '../uploads';
import { addMessage, getAccount, getMessageRow, getThreadRow, sentWithClientId, type AccountRow, type ThreadRow } from './core';
import { onceInFlight } from '../send-once';
import { InboxError, LIMITS, type WaMessageMeta } from './types';
import { waProviderFor } from './whatsapp';

/** Lo que entra por el pedido (el resto va por Blob). */
export const INLINE_MEDIA_MAX = 4 * 1024 * 1024;

export interface OutgoingFile {
  /** Bytes del archivo (subida chica) o URL de Blob (grande). */
  data?: Buffer;
  url?: string;
  mimetype: string;
  filename: string;
  size: number;
  caption?: string;
  /** "voice": nota de voz grabada en el navegador. */
  kind?: MediaKind | null;
  duration?: number;
  /** Id (nuestro) del mensaje que se cita. */
  replyTo?: string;
  /** Id que puso la pantalla al mandar: un reintento del mismo archivo no sale dos veces. */
  clientId?: string;
  /** Video que sale como GIF (gifPlayback), de la pestaña GIFs; con sus medidas para la burbuja. */
  gif?: boolean;
  width?: number;
  height?: number;
}

/** Solo URLs de nuestro Blob y de la carpeta de Inbox (nada que el servidor de WhatsApp vaya a bajar de otro lado). */
export function isInboxBlobUrl(raw: string): boolean {
  try {
    const u = new URL(raw);
    return u.protocol === 'https:' && /\.public\.blob\.vercel-storage\.com$/i.test(u.hostname) && /^\/inbox\/[0-9a-f-]{36}-[A-Za-z0-9._-]{1,120}$/.test(u.pathname);
  } catch {
    return false;
  }
}

/** Nombre de archivo sin rutas ni caracteres raros. */
function safeName(name: string, mimetype: string): string {
  const base = (name || '').split(/[\\/]/).pop()!.replace(/[\u0000-\u001f]/g, '').trim().slice(0, 120);
  if (base) return base;
  const ext = mimetype.split('/')[1]?.split(';')[0]?.replace(/[^a-z0-9]/gi, '') || 'bin';
  return `file.${ext}`;
}

/** Tipo para guardar y mostrar (image, video, audio, document, sticker). */
function storedType(kind: MediaKind): string {
  return kind === 'voice' ? 'audio' : kind;
}

/**
 * Manda un archivo al chat y lo guarda como enviado (con la referencia para
 * volver a bajarlo y mostrarlo). Devuelve el id del mensaje en WhatsApp.
 */
export async function sendWhatsappMedia(owner: string, threadId: string, f: OutgoingFile): Promise<string> {
  // El chat y, en la misma vuelta, si este archivo (mismo clientId) ya está guardado: un reintento no sale dos veces.
  const [thread, sent] = await Promise.all([getThreadRow(owner, threadId), sentWithClientId(owner, threadId, f.clientId)]);
  if (thread.channel !== 'whatsapp') throw new InboxError('unsupported', 400);
  if (sent) {
    // Ya salió: lo que se volvió a subir para este reintento no se usa.
    if (f.url && isInboxBlobUrl(f.url)) await deleteUploads([f.url]).catch(() => null);
    return '';
  }
  return onceInFlight(
    f.clientId ? `inbox:${threadId}:${f.clientId}` : null,
    () => sendMediaNow(owner, thread, f),
    async () => {
      if (f.url && isInboxBlobUrl(f.url)) await deleteUploads([f.url]).catch(() => null);
      return '';
    },
  );
}

async function sendMediaNow(owner: string, thread: Awaited<ReturnType<typeof getThreadRow>>, f: OutgoingFile): Promise<string> {
  const account = await getAccount(owner, thread.account_id);
  if (account.status !== 'connected') throw new InboxError('not_connected', 409);
  if (!f.data && !(f.url && isInboxBlobUrl(f.url))) throw new InboxError('invalid_input', 400);
  if (f.data && f.data.length > INLINE_MEDIA_MAX) throw new InboxError('file_too_large', 413);
  const mimetype = (f.mimetype || 'application/octet-stream').split(';')[0].trim().toLowerCase().slice(0, 100);
  const filename = safeName(f.filename, mimetype);
  const caption = (f.caption ?? '').trim().slice(0, LIMITS.message);
  let kind: MediaKind;
  try {
    kind = planOutboundKind(mimetype, f.size, f.kind ?? null);
  } catch (err) {
    throw new InboxError(err instanceof MediaPlanError ? err.code : 'invalid_input', err instanceof MediaPlanError && err.code === 'media_too_large' ? 413 : 400);
  }
  if (f.size > WA_MEDIA_LIMITS[kind]) throw new InboxError('file_too_large', 413);
  let replyExternal: string | undefined;
  if (f.replyTo) {
    const q = await getMessageRow(owner, f.replyTo);
    if (q.thread_id !== thread.id) throw new InboxError('not_found', 404);
    replyExternal = q.external_id;
  }
  const gif = kind === 'video' && f.gif === true;
  let id = '';
  try {
    const p = waProviderFor(account);
    id = (
      await p.sendMedia(thread.external_id, {
        url: f.url ?? '',
        mimetype,
        filename,
        ...(kind === 'voice' ? {} : caption ? { caption } : {}),
        kind,
        ...(f.data ? { base64: f.data.toString('base64') } : {}),
        ...(replyExternal ? { replyTo: replyExternal } : {}),
        ...(gif ? { gifPlayback: true } : {}),
      })
    ).id;
  } catch (err) {
    if (err instanceof InboxError) throw err;
    throw new InboxError(err instanceof ProviderError && err.code === 'not_connected' ? 'not_connected' : 'send_failed', 502);
  } finally {
    // El archivo grande ya lo bajó el servidor de WhatsApp (o falló): no queda en Blob.
    if (f.url) await deleteUploads([f.url]).catch(() => null);
  }
  const meta: WaMessageMeta = { mime: mimetype, size: f.size, ...(f.clientId ? { cid: f.clientId } : {}) };
  if (kind === 'voice') meta.ptt = true;
  if (f.duration && Number.isFinite(f.duration)) meta.duration = Math.round(f.duration);
  if (gif) meta.animated = true;
  if ((kind === 'video' || kind === 'image') && f.width && f.height) Object.assign(meta, { width: Math.round(f.width), height: Math.round(f.height) });
  const externalId = id || `local-${Date.now()}`;
  await addMessage(thread, {
    externalId,
    fromMe: true,
    body: kind === 'voice' ? '' : caption,
    mediaType: storedType(kind),
    mediaName: kind === 'document' || kind === 'audio' ? filename : '',
    // Para volver a bajarlo del servidor y mostrarlo (como lo recibido).
    mediaRef: id ? JSON.stringify({ providerMessageId: id, chatId: thread.external_id, fromMe: true }) : '',
    meta: JSON.stringify(meta),
    kind: kind === 'voice' ? 'voice' : storedType(kind),
    replyTo: replyExternal ?? '',
    status: 'sent',
    ...(f.clientId ? { clientId: f.clientId } : {}),
  });
  return id;
}

/** Un archivo de un mensaje guardado, para reenviarlo. */
export interface ForwardSource {
  /** Tipo guardado: image, video, audio, document o sticker. */
  mediaType: string;
  mediaName: string;
  body: string;
  meta: WaMessageMeta;
}

/** Tipo de mensaje de WhatsApp con el que sale un reenvío: el mismo que el original (nota de voz como nota de voz). */
export function forwardKind(src: Pick<ForwardSource, 'mediaType' | 'meta'>, mimetype: string, size: number): MediaKind {
  if (src.meta.ptt) return 'voice';
  if ((MEDIA_KINDS as readonly string[]).includes(src.mediaType) && src.mediaType !== 'voice') return src.mediaType as MediaKind;
  return planOutboundKind(mimetype, size, null);
}

/** Lo que se ve del archivo (medidas, duración, onda, miniatura) pasa a la copia; nada propio del original (cid, menciones). */
function forwardMeta(meta: WaMessageMeta, kind: MediaKind, mime: string, size: number): WaMessageMeta {
  const out: WaMessageMeta = { mime, size };
  for (const k of ['width', 'height', 'duration', 'pages', 'thumb', 'animated', 'waveform'] as const) {
    if (meta[k] !== undefined) (out as Record<string, unknown>)[k] = meta[k];
  }
  if (kind === 'voice') out.ptt = true;
  return out;
}

/**
 * Reenvía por copia un archivo ya bajado (el servidor de WhatsApp no tiene
 * reenvío nativo): sale en base64 con el mismo tipo y queda guardado como
 * "Reenviado". El texto de un audio o sticker (WhatsApp no lo muestra) lo
 * manda quien llama, aparte. Devuelve el id del mensaje en WhatsApp.
 */
export async function forwardWhatsappMedia(account: AccountRow, thread: ThreadRow, src: ForwardSource, file: { data: Buffer; mimetype: string; filename: string }): Promise<string> {
  if (account.status !== 'connected') throw new InboxError('not_connected', 409);
  const mimetype = (baseMime(file.mimetype || src.meta.mime || '') || 'application/octet-stream').slice(0, 100);
  let kind: MediaKind;
  try {
    kind = forwardKind(src, mimetype, file.data.length);
  } catch (err) {
    const big = err instanceof MediaPlanError && err.code === 'media_too_large';
    throw new InboxError(big ? 'file_too_large' : 'invalid_input', big ? 413 : 400);
  }
  if (file.data.length > WA_MEDIA_LIMITS[kind]) throw new InboxError('file_too_large', 413);
  const filename = safeName(src.mediaName || file.filename, mimetype);
  const captioned = kind === 'image' || kind === 'video' || kind === 'document';
  const caption = captioned ? src.body.trim().slice(0, LIMITS.message) : '';
  let id = '';
  try {
    id = (
      await waProviderFor(account).sendMedia(thread.external_id, {
        url: '',
        mimetype,
        filename,
        ...(caption ? { caption } : {}),
        kind,
        base64: file.data.toString('base64'),
        // Un GIF reenviado sigue siendo GIF.
        ...(kind === 'video' && src.meta.animated ? { gifPlayback: true } : {}),
      })
    ).id;
  } catch (err) {
    if (err instanceof InboxError) throw err;
    throw new InboxError(err instanceof ProviderError && err.code === 'not_connected' ? 'not_connected' : 'send_failed', 502);
  }
  await addMessage(thread, {
    externalId: id || `local-${Date.now()}`,
    fromMe: true,
    body: caption,
    mediaType: storedType(kind),
    mediaName: kind === 'document' || kind === 'audio' ? filename : '',
    mediaRef: id ? JSON.stringify({ providerMessageId: id, chatId: thread.external_id, fromMe: true }) : '',
    meta: JSON.stringify(forwardMeta(src.meta, kind, mimetype, file.data.length)),
    kind: kind === 'voice' ? 'voice' : storedType(kind),
    status: 'sent',
    forwarded: true,
  });
  return id;
}
