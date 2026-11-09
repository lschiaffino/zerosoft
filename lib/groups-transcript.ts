/**
 * Lines: transcripción de audios del chat con la misma lógica que Inbox
 * (lib/wa-extras.ts, scope 'lines', dueño = el workspace). Acá solo se baja
 * el audio de donde lo haya guardado Lines. Server-only.
 */
import { readFile } from 'fs/promises';
import { getChatRow, getMessageRow, getNumberRow, readConfig, storeInboundMedia, type MessageRow } from './groups';
import { fetchCloudMedia } from './groups-provider-cloud';
import type { BridgeConfig, CloudConfig } from './groups-provider';
import { safeFetch } from './safe-fetch';
import { localUploadPath } from './uploads';
import { readTranscript, transcribeMessage, TRANSCRIBE_MAX_BYTES, type TranscriptDto } from './wa-extras';

async function readCapped(res: Response): Promise<Buffer> {
  if (!res.ok || !res.body) throw new Error('media_unavailable');
  const reader = res.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done || !value) break;
    total += value.byteLength;
    if (total > TRANSCRIBE_MAX_BYTES) {
      await reader.cancel().catch(() => null);
      throw new Error('audio_too_large');
    }
    chunks.push(value);
  }
  return Buffer.concat(chunks);
}

/** El audio de un mensaje de Lines (guardado por nosotros o todavía en el proveedor). */
async function loadAudio(ws: string, msg: MessageRow): Promise<{ data: Buffer; mimetype: string }> {
  let url = msg.media_url;
  const mimetype = msg.media_type || 'audio/ogg';
  const chat = await getChatRow(ws, msg.chat_id);
  const number = chat ? await getNumberRow(ws, chat.number_id) : null;
  if (!number || !chat) throw new Error('media_unavailable');
  if (url.startsWith('evo:')) {
    const stored = await storeInboundMedia(number, msg.id, { providerMessageId: url.slice(4), chatId: chat.provider_chat_id, fromMe: msg.direction === 'out' });
    url = stored?.url ?? (await getMessageRow(ws, msg.id))?.media_url ?? '';
    if (!url || url.startsWith('evo:')) throw new Error('media_unavailable');
  }
  const local = localUploadPath(url);
  if (local) return { data: await readFile(local), mimetype };
  if (url.startsWith('meta:') && number.provider === 'cloud') return { data: await readCapped(await fetchCloudMedia(readConfig(number) as CloudConfig, url.slice(5))), mimetype };
  if (url.startsWith('bridge:') && number.provider === 'waha') {
    const cfg = readConfig(number) as BridgeConfig;
    const target = url.slice(7);
    if (new URL(target).origin !== new URL(cfg.baseUrl).origin) throw new Error('media_unavailable');
    return { data: await readCapped(await safeFetch(target, { headers: { 'x-api-key': cfg.apiKey } }, 15_000)), mimetype };
  }
  if (/^https:\/\//.test(url)) return { data: await readCapped(await safeFetch(url, {}, 15_000, { maxRedirects: 2 })), mimetype };
  throw new Error('media_unavailable');
}

/** Transcripción de un audio de Lines (`start`: la hace si no está). El que llama ya chequeó el acceso al chat. */
export async function linesTranscript(ws: string, messageId: string, start: boolean): Promise<TranscriptDto | null | 'not_audio'> {
  const msg = await getMessageRow(ws, messageId);
  if (!msg || !msg.media_url || !/^audio\//.test(msg.media_type || '')) return 'not_audio';
  const saved = await readTranscript('lines', ws, msg.id);
  if (saved && (saved.status !== 'pending' || !start)) return saved;
  if (!start) return null;
  let seconds: number | undefined;
  try {
    seconds = (JSON.parse(msg.meta || '{}') as { media?: { duration?: number } }).media?.duration;
  } catch {
    seconds = undefined;
  }
  return transcribeMessage('lines', ws, msg.id, async () => ({ ...(await loadAudio(ws, msg)), seconds }));
}
