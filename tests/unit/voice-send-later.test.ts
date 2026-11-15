import { existsSync, mkdtempSync } from 'fs';
import os from 'os';
import path from 'path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { inboxVoicePayload, linesVoicePayload, longEnough, recordedType, voiceFileName } from '@/components/groups/wa/voice-later';
import { getDb } from '@/lib/db';
import { connectNumber, createNumber, getNumberRowById, ingestEvents, listChats } from '@/lib/groups';
import { cancelBroadcast, createBroadcast, deleteBroadcast, listScheduledMessages, processBroadcasts, sendBroadcastNow, updateBroadcast, voiceOf } from '@/lib/groups-broadcasts';
import { fakeSent, resetFakeProvider } from '@/lib/groups-provider-fake';
import { addMessage, listScheduled, updateScheduled, upsertThread } from '@/lib/inbox/core';
import { cancelBatch, cleanParts, createBatch } from '@/lib/inbox/schedule';
import { scheduledCreateSchema } from '@/lib/inbox/schemas';
import { sendScheduledNow } from '@/lib/inbox/send';
import { connectWhatsapp } from '@/lib/inbox/whatsapp';
import { localUploadPath, saveUpload } from '@/lib/uploads';
import { makeUser } from './helpers';

/**
 * "Enviar más tarde" desde la grabadora de notas de voz, en Inbox y en Lines:
 * lo que manda la pantalla, cómo queda guardado, que sale como nota de voz de
 * verdad (ptt) y que cancelar borra el audio. WhatsApp falso (GROUPS_FAKE=1).
 */

beforeEach(() => {
  vi.stubEnv('GROUPS_FAKE', '1');
  vi.stubEnv('INBOX_FAKE', '1');
  vi.stubEnv('RATE_LIMIT_DISABLED', 'true');
  vi.stubEnv('BLOB_READ_WRITE_TOKEN', '');
  vi.stubEnv('UPLOADS_DIR', mkdtempSync(path.join(os.tmpdir(), 'voice-later-')));
  resetFakeProvider();
});
afterEach(() => vi.unstubAllEnvs());

const inHours = (h: number) => new Date(Date.now() + h * 3600_000).toISOString();
const AUDIO = Buffer.from('audio-de-prueba');

describe('Nota de voz más tarde: lo que manda la pantalla', () => {
  it('Inbox: un solo mensaje, sin texto, con el audio marcado como nota de voz, su duración y la cita', () => {
    const media = { url: '/uploads/inbox/abc-voice-note.weba', name: 'voice-note.weba', type: 'audio/webm' };
    const payload = inboxVoicePayload({ threadId: 'ibt_1', sendAt: '2026-11-16T12:00:00.000Z', media, seconds: 4.6, replyTo: 'ibm_9', key: 'k-voz-12345' });
    expect(payload).toEqual({
      threadId: 'ibt_1',
      sendAt: '2026-11-16T12:00:00.000Z',
      key: 'k-voz-12345',
      parts: [{ body: '', media: { ...media, voice: true, duration: 5 }, replyTo: 'ibm_9' }],
    });
    // Es lo que acepta la ruta.
    expect(scheduledCreateSchema.safeParse(payload).success).toBe(true);
    // Sin cita no viaja el campo.
    expect(inboxVoicePayload({ threadId: 'ibt_1', sendAt: '2026-11-16T12:00:00.000Z', media, seconds: 2, key: 'k-voz-12345' }).parts[0]).not.toHaveProperty('replyTo');
  });

  it('Lines: programado a un chat, sin texto, con kind voice, la duración y la cita', () => {
    const media = { url: 'https://x.public.blob.vercel-storage.com/chat/voice-note.weba', mimetype: 'audio/webm', filename: 'voice-note.weba' };
    expect(linesVoicePayload({ chatId: 'c1', scheduledAt: '2026-11-16T12:00:00.000Z', media, seconds: 61.2, replyToId: 'm1' })).toEqual({
      chatIds: ['c1'],
      body: '',
      media: { ...media, kind: 'voice', duration: 61 },
      scheduledAt: '2026-11-16T12:00:00.000Z',
      kind: 'scheduled',
      replyToId: 'm1',
    });
    expect(linesVoicePayload({ chatId: 'c1', scheduledAt: '2026-11-16T12:00:00.000Z', media, seconds: 3 }).replyToId).toBeNull();
  });

  it('menos de un segundo no alcanza; el nombre y el tipo salen del audio grabado', () => {
    expect(longEnough(0.4)).toBe(false);
    expect(longEnough(0.99)).toBe(false);
    expect(longEnough(1)).toBe(true);
    expect(longEnough(Number.NaN)).toBe(false);
    expect(recordedType({ mimeType: 'audio/webm;codecs=opus' }, '')).toBe('audio/webm');
    expect(recordedType({ mimeType: '' }, 'audio/mp4')).toBe('audio/mp4');
    expect(voiceFileName('audio/webm')).toBe('voice-note.weba');
    expect(voiceFileName('audio/ogg')).toBe('voice-note.ogg');
    expect(voiceFileName('audio/mp4')).toBe('voice-note.m4a');
  });
});

// ---------- Inbox ----------

async function inboxChat() {
  const owner = (await makeUser('voice-later-inbox')).id;
  const { account } = await connectWhatsapp(owner);
  await getDb().prepare("UPDATE inbox_accounts SET status = 'connected' WHERE id = ?").run(account.id);
  // El proveedor falso tarda 1,5 s en "escanear".
  await new Promise((r) => setTimeout(r, 1600));
  const thread = await upsertThread(account, { externalId: `54911${Math.floor(1e7 + Math.random() * 8e7)}@s.whatsapp.net`, kind: 'dm', title: 'Chat de prueba' });
  const sent = () => fakeSent(`inbox-${account.id}`).filter((m) => m.chatId === thread.external_id);
  return { owner, account, thread, sent };
}

const inboxVoice = async () => ({ url: await saveUpload('inbox', 'voice-note.weba', 'audio/webm', AUDIO), name: 'voice-note.weba', type: 'audio/webm', voice: true, duration: 5 });

describe('Inbox: nota de voz programada', () => {
  it('una nota de voz es un audio de al menos un segundo, sin texto', () => {
    const media = { url: '/uploads/inbox/abc-voice-note.weba', name: 'voice-note.weba', type: 'audio/webm', voice: true, duration: 5 };
    const [p] = cleanParts([{ body: 'no va', media, replyTo: 'ibm_1' }], 'whatsapp');
    expect(p).toMatchObject({ body: '', media: { voice: true, duration: 5 }, replyTo: 'ibm_1' });
    expect(() => cleanParts([{ body: '', media: { ...media, duration: 0 } }], 'whatsapp')).toThrow(/voice_too_short/);
    expect(() => cleanParts([{ body: '', media: { ...media, type: 'image/png' } }], 'whatsapp')).toThrow();
    // Un archivo común no cambia.
    expect(cleanParts([{ body: 'pie', media: { url: media.url, name: 'a.ogg', type: 'audio/ogg' } }], 'whatsapp')[0]).toMatchObject({ body: 'pie', media: { url: media.url, name: 'a.ogg', type: 'audio/ogg' }, replyTo: '' });
  });

  it('queda en la lista como nota de voz con su duración; "Enviar ya" la manda como nota de voz, con la cita, y borra el audio', async () => {
    const { owner, thread, sent } = await inboxChat();
    await addMessage(thread, { externalId: 'wa-cita-1', fromMe: false, body: 'una pregunta', status: 'received' });
    const quoted = (await getDb().prepare("SELECT id FROM inbox_messages WHERE thread_id = ? AND external_id = 'wa-cita-1'").get(thread.id)) as { id: string };
    const media = await inboxVoice();
    const [s] = await createBatch(owner, { threadId: thread.id, sendAt: inHours(3), parts: [{ body: '', media, replyTo: quoted.id }], key: 'k-voz-ahora-1' });
    expect(s).toMatchObject({ body: '', mediaVoice: true, mediaDuration: 5, mediaType: 'audio/webm', replyTo: quoted.id, status: 'pending' });
    expect(existsSync(localUploadPath(media.url, 'inbox')!)).toBe(true);

    // Cambiar la hora (Editar) no toca el audio.
    await updateScheduled(owner, s.id, { sendAt: inHours(5) });
    expect((await listScheduled(owner, thread.id))[0]).toMatchObject({ mediaVoice: true, mediaDuration: 5 });

    expect((await sendScheduledNow(s.id)).sent).toBe(1);
    expect(sent()).toHaveLength(1);
    expect(sent()[0]).toMatchObject({ kind: 'media', media: { kind: 'voice', mimetype: 'audio/webm', base64: true } });
    const msg = (await getDb().prepare('SELECT body, media_type, media_name, media_ref, reply_to, meta FROM inbox_messages WHERE thread_id = ? AND from_me = 1').get(thread.id)) as Record<string, string>;
    expect(msg).toMatchObject({ body: '', media_type: 'audio', media_name: '', reply_to: 'wa-cita-1' });
    expect(JSON.parse(msg.meta)).toMatchObject({ ptt: true, duration: 5, mime: 'audio/webm' });
    expect(msg.media_ref).toContain('providerMessageId');
    expect(await listScheduled(owner, thread.id)).toEqual([]);
    expect(existsSync(localUploadPath(media.url, 'inbox')!)).toBe(false);
  });

  it('la cita tiene que ser de ese chat', async () => {
    const { owner, thread } = await inboxChat();
    await expect(createBatch(owner, { threadId: thread.id, sendAt: inHours(3), parts: [{ body: '', media: await inboxVoice(), replyTo: 'ibm_de_otro' }] })).rejects.toThrow(/not_found/);
  });

  it('con la línea desconectada queda como no enviada (con el audio, para reintentar); cancelar borra el audio', async () => {
    const { owner, account, thread, sent } = await inboxChat();
    const media = await inboxVoice();
    const [s] = await createBatch(owner, { threadId: thread.id, sendAt: inHours(3), parts: [{ body: '', media }] });
    await getDb().prepare("UPDATE inbox_accounts SET status = 'disconnected' WHERE id = ?").run(account.id);
    expect(await sendScheduledNow(s.id)).toMatchObject({ sent: 0, failed: 1 });
    expect(sent()).toEqual([]);
    expect((await listScheduled(owner, thread.id))[0]).toMatchObject({ status: 'failed', error: 'not_connected', mediaVoice: true });
    expect(existsSync(localUploadPath(media.url, 'inbox')!)).toBe(true);

    await cancelBatch(owner, s.id);
    expect(await listScheduled(owner, thread.id)).toEqual([]);
    expect(existsSync(localUploadPath(media.url, 'inbox')!)).toBe(false);
  });
});

// ---------- Lines ----------

async function linesChat(label: string) {
  const user = await makeUser(label);
  const n = await createNumber(user.id, user.id, { provider: 'fake' });
  await connectNumber(user.id, n.id);
  const s = (globalThis as unknown as { __groupsFake: Map<string, { connectedAt: number | null }> }).__groupsFake.get(n.id);
  if (s) s.connectedAt = Date.now() - 5000;
  const row = (await getNumberRowById(n.id))!;
  await ingestEvents(row, [{ type: 'message' as const, chatId: '5491155552001@c.us', isGroup: false, fromMe: false, senderPhone: '5491155552001', senderName: 'Contacto', providerMessageId: `${label}-in`, body: 'una pregunta' }]);
  const chat = (await listChats(user.id, user.id)).rows[0];
  const inbound = (await getDb().prepare("SELECT id FROM groups_messages WHERE chat_id = ? AND direction = 'in'").get(chat.id)) as { id: string };
  return { user, numberId: n.id, chat, inboundId: inbound.id };
}

async function linesVoice() {
  const local = await saveUpload('chat', 'voice-note.weba', 'audio/webm', AUDIO);
  return { local, media: { url: `https://app.example${local}`, mimetype: 'audio/webm', filename: 'voice-note.weba', kind: 'voice' as const, duration: 7 } };
}

describe('Lines: nota de voz programada', () => {
  it('una nota de voz es un audio de al menos un segundo y no va con una encuesta', () => {
    const media = { url: 'https://app.example/uploads/chat/x.weba', mimetype: 'audio/webm', filename: 'voice-note.weba', kind: 'voice' as const, duration: 3 };
    expect(voiceOf(media)).toEqual({ duration: 3 });
    expect(voiceOf({ url: media.url, mimetype: 'audio/webm', filename: 'a.weba' })).toBeNull();
    expect(voiceOf(null)).toBeNull();
    expect(() => voiceOf({ ...media, duration: 0.2 })).toThrow(/voice_too_short/);
    // Por la API pública puede venir sin duración: queda en 0 (no se sabe).
    expect(voiceOf({ url: media.url, mimetype: 'audio/ogg', filename: 'a.ogg', kind: 'voice' })).toEqual({ duration: 0 });
    // Otro tipo de archivo (kind de la API) no es una nota de voz.
    expect(voiceOf({ url: media.url, mimetype: 'application/pdf', filename: 'a.pdf', kind: 'document' })).toBeNull();
    expect(() => voiceOf({ ...media, mimetype: 'image/png' })).toThrow(/invalid_media/);
    expect(() => voiceOf(media, true)).toThrow(/invalid_media/);
  });

  it('queda en la tira como nota de voz con su duración y la cita; "Enviar ahora" la manda como nota de voz', async () => {
    const { user, numberId, chat, inboundId } = await linesChat('voice-later-lines');
    const { media } = await linesVoice();
    const b = await createBroadcast(user.id, user.id, { body: 'no va', chatIds: [chat.id], kind: 'scheduled', scheduledAt: inHours(4), media, replyToId: inboundId });
    expect(b).toMatchObject({ body: '', replyToId: inboundId, media: { type: 'audio/webm', kind: 'voice', duration: 7 } });
    const [listed] = await listScheduledMessages(user.id, user.id, { chatId: chat.id });
    expect(listed.media).toMatchObject({ kind: 'voice', duration: 7, url: media.url });

    // Cambiar la hora no toca el audio.
    expect((await updateBroadcast(user.id, b.id, { scheduledAt: inHours(6) })).media).toMatchObject({ kind: 'voice', duration: 7 });

    await sendBroadcastNow(user.id, b.id);
    expect(await processBroadcasts({ broadcastId: b.id, gapMs: 0 })).toMatchObject({ sent: 1, failed: 0 });
    const out = fakeSent(numberId).filter((m) => m.kind === 'media');
    expect(out).toHaveLength(1);
    expect(out[0].media).toMatchObject({ kind: 'voice', mimetype: 'audio/webm' });
    const msg = (await getDb().prepare("SELECT body, media_type, reply_to_id, status, meta FROM groups_messages WHERE chat_id = ? AND direction = 'out'").get(chat.id)) as Record<string, string>;
    expect(msg).toMatchObject({ body: '', media_type: 'audio/webm', reply_to_id: inboundId, status: 'sent' });
    expect(JSON.parse(msg.meta).media).toMatchObject({ kind: 'voice', ptt: true, duration: 7 });
    expect(await listScheduledMessages(user.id, user.id, { chatId: chat.id })).toEqual([]);
  });

  it('cancelar (o deshacer) borra el audio guardado; el de un archivo común no se toca', async () => {
    const { user, chat } = await linesChat('voice-later-cancel');
    const a = await linesVoice();
    const cancelled = await createBroadcast(user.id, user.id, { body: '', chatIds: [chat.id], kind: 'scheduled', scheduledAt: inHours(4), media: a.media });
    expect(existsSync(localUploadPath(a.local, 'chat')!)).toBe(true);
    await cancelBroadcast(user.id, cancelled.id);
    expect(existsSync(localUploadPath(a.local, 'chat')!)).toBe(false);

    const b = await linesVoice();
    const undone = await createBroadcast(user.id, user.id, { body: '', chatIds: [chat.id], kind: 'scheduled', scheduledAt: inHours(4), media: b.media });
    expect(await deleteBroadcast(user.id, undone.id)).toBe(true);
    expect(existsSync(localUploadPath(b.local, 'chat')!)).toBe(false);

    const file = await saveUpload('chat', 'lista.pdf', 'application/pdf', Buffer.from('pdf'));
    const plain = await createBroadcast(user.id, user.id, { body: 'la lista', chatIds: [chat.id], kind: 'scheduled', scheduledAt: inHours(4), media: { url: `https://app.example${file}`, mimetype: 'application/pdf', filename: 'lista.pdf' } });
    await cancelBroadcast(user.id, plain.id);
    expect(existsSync(localUploadPath(file, 'chat')!)).toBe(true);
  });

  it('con la línea desconectada el envío queda como fallido', async () => {
    const { user, numberId, chat } = await linesChat('voice-later-off');
    const { media } = await linesVoice();
    const b = await createBroadcast(user.id, user.id, { body: '', chatIds: [chat.id], kind: 'scheduled', scheduledAt: inHours(4), media });
    const s = (globalThis as unknown as { __groupsFake: Map<string, { connectedAt: number | null }> }).__groupsFake.get(numberId)!;
    s.connectedAt = null;
    await sendBroadcastNow(user.id, b.id);
    expect(await processBroadcasts({ broadcastId: b.id, gapMs: 0 })).toMatchObject({ sent: 0, failed: 1 });
    const msg = (await getDb().prepare("SELECT status FROM groups_messages WHERE chat_id = ? AND direction = 'out'").get(chat.id)) as { status: string };
    expect(msg.status).toBe('failed');
  });
});
