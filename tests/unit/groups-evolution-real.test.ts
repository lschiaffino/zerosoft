import { mkdtempSync, readFileSync } from 'fs';
import os from 'os';
import path from 'path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { getDb } from '@/lib/db';
import { createNumber, getNumberRowById, ingestEvents, listChats, listMessages, readConfig, storeInboundMedia } from '@/lib/groups';
import { evolutionProvider, parseEvolutionWebhook, pnJid } from '@/lib/groups-provider-bridge';
import { isValidPhone, phoneDigits, type FetchLike } from '@/lib/groups-provider';
import { makeUser } from './helpers';

/**
 * Evolution con WhatsApp real: ids "@lid" (sin teléfono a la vista) y archivos
 * recibidos que hay que bajar por el gateway y guardar en nuestro storage.
 */

const JPEG = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46, 0x00, 0x01]);

describe('ids @lid', () => {
  it('un lid nunca es un teléfono', () => {
    expect(phoneDigits('123456789012345@lid')).toBe('');
    expect(isValidPhone('123456789012345@lid')).toBe(false);
    expect(phoneDigits('5491155550000@s.whatsapp.net')).toBe('5491155550000');
  });

  it('usa el id con teléfono cuando Evolution lo manda (Alt en v2.3, Pn antes)', () => {
    expect(pnJid('111@lid', '5491155550000@s.whatsapp.net')).toBe('5491155550000@s.whatsapp.net');
    expect(pnJid('111@lid', undefined, '222@lid', '5491155550001@s.whatsapp.net')).toBe('5491155550001@s.whatsapp.net');
    expect(pnJid('111@lid')).toBe('111@lid');
    expect(pnJid('5491155550000@s.whatsapp.net', 'x@s.whatsapp.net')).toBe('5491155550000@s.whatsapp.net');
  });

  it('1:1 y grupo con lid: chat y remitente con teléfono si viene, vacío si no', () => {
    const dm = parseEvolutionWebhook({
      event: 'messages.upsert',
      data: { key: { remoteJid: '98765432109876@lid', remoteJidAlt: '5491155550000@s.whatsapp.net', fromMe: false, id: 'L1' }, pushName: 'Ana', message: { conversation: 'hola' } },
    });
    expect(dm[0]).toMatchObject({ chatId: '5491155550000@s.whatsapp.net', senderPhone: '5491155550000' });
    const old = parseEvolutionWebhook({
      event: 'messages.upsert',
      data: { key: { remoteJid: '98765432109876@lid', senderPn: '5491155550002@s.whatsapp.net', fromMe: false, id: 'L2' }, message: { conversation: 'hola' } },
    });
    expect(old[0]).toMatchObject({ chatId: '5491155550002@s.whatsapp.net', senderPhone: '5491155550002' });
    const group = parseEvolutionWebhook({
      event: 'messages.upsert',
      data: {
        key: { remoteJid: '120363000000000001@g.us', participant: '55555555555555@lid', participantAlt: '5491155550003@s.whatsapp.net', fromMe: false, id: 'L3' },
        pushName: 'Beto',
        message: { conversation: 'buenas' },
      },
    });
    expect(group[0]).toMatchObject({ chatId: '120363000000000001@g.us', senderPhone: '5491155550003' });
    const anon = parseEvolutionWebhook({
      event: 'messages.upsert',
      data: { key: { remoteJid: '120363000000000001@g.us', participant: '55555555555555@lid', fromMe: false, id: 'L4' }, pushName: 'Caro', message: { conversation: 'hola' } },
    });
    expect(anon[0]).toMatchObject({ senderPhone: '', senderName: 'Caro' });
    const parts = parseEvolutionWebhook({
      event: 'group-participants.update',
      data: { id: '120363000000000001@g.us', action: 'add', participants: ['1@lid', { id: '2@lid', phoneNumber: '5491155550004@s.whatsapp.net' }, '5491155550005@s.whatsapp.net'] },
    });
    expect(parts[0]).toMatchObject({ phones: ['5491155550004', '5491155550005'] });
  });

  it('miembros del grupo: teléfono del participante y sin lids sueltos', async () => {
    const f: FetchLike = async () =>
      new Response(
        JSON.stringify({
          participants: [
            { id: '1@lid', phoneNumber: '5491155550006@s.whatsapp.net', admin: 'superadmin' },
            { id: '2@lid', admin: null },
            { id: '5491155550007@s.whatsapp.net', admin: 'admin' },
          ],
        }),
      );
    const p = evolutionProvider({ baseUrl: 'https://evo.example.com', apiKey: 'k', session: 's' }, { fetch: f });
    expect(await p.participants('120363000000000001@g.us')).toEqual([
      { phone: '5491155550006', role: 'superadmin', name: undefined },
      { phone: '5491155550007', role: 'admin', name: undefined },
    ]);
  });

  it('un 1:1 que solo trae lid no muestra el lid como nombre ni teléfono', async () => {
    const user = await makeUser('lid-dm');
    const n = await createNumber(user.id, user.id, { provider: 'evolution', config: { baseUrl: 'https://evo.example.com', apiKey: 'k', session: 's' } });
    const row = (await getNumberRowById(n.id))!;
    await ingestEvents(row, parseEvolutionWebhook({ event: 'messages.upsert', data: { key: { remoteJid: '98765432109876@lid', fromMe: false, id: 'L9' }, message: { conversation: 'hola' } } }));
    const chat = (await listChats(user.id, user.id)).rows[0];
    expect(chat.phone).toBe('');
    expect(chat.name).not.toContain('98765432109876');
  });
});

describe('archivos recibidos por Evolution', () => {
  let dir: string;
  beforeEach(() => {
    dir = mkdtempSync(path.join(os.tmpdir(), 'zs-evo-media-'));
    vi.stubEnv('UPLOADS_DIR', dir);
    vi.stubEnv('BLOB_READ_WRITE_TOKEN', '');
    vi.stubEnv('VERCEL', '');
    vi.stubEnv('ALLOW_PRIVATE_WEBHOOKS', 'true');
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
  });

  const imageEvent = (id: string, fileLength: unknown = 12) => ({
    event: 'messages.upsert',
    instance: 's',
    data: {
      key: { remoteJid: '5491155550000@s.whatsapp.net', fromMe: false, id },
      pushName: 'Ana',
      message: { imageMessage: { mimetype: 'image/jpeg', caption: 'el comprobante', fileLength, mediaKey: 'abc' } },
    },
  });

  it('marca el archivo para bajarlo y no baja los que pasan el tope', () => {
    const ev = parseEvolutionWebhook(imageEvent('IMG1'));
    expect(ev[0]).toMatchObject({ type: 'message', body: 'el comprobante', media: { url: 'evo:IMG1', type: 'image/jpeg' } });
    const big = parseEvolutionWebhook(imageEvent('IMG2', { low: 0, high: 1 }));
    expect(big[0]).toMatchObject({ media: { url: '', type: 'image/jpeg' } });
    expect((big[0] as { media: { fetchRef?: unknown } }).media.fetchRef).toBeUndefined();
  });

  it('al llegar se baja con getBase64FromMediaMessage y queda en nuestro storage', async () => {
    const calls: Array<{ url: string; body: unknown }> = [];
    vi.stubGlobal('fetch', async (input: string | URL, init: RequestInit = {}) => {
      const url = String(input);
      calls.push({ url, body: typeof init.body === 'string' ? JSON.parse(init.body) : undefined });
      return new Response(JSON.stringify({ base64: JPEG.toString('base64'), mimetype: 'image/jpeg', fileName: 'IMG3.jpeg' }), { status: 201 });
    });
    const user = await makeUser('evo-media');
    const n = await createNumber(user.id, user.id, { provider: 'evolution', config: { baseUrl: 'https://evo.example.com', apiKey: 'k', session: 's' } });
    const row = (await getNumberRowById(n.id))!;
    await ingestEvents(row, parseEvolutionWebhook(imageEvent('IMG3')));
    const call = calls.find((c) => c.url === 'https://evo.example.com/chat/getBase64FromMediaMessage/s')!;
    expect(call.body).toMatchObject({ message: { key: { id: 'IMG3' }, message: { imageMessage: { mimetype: 'image/jpeg' } } }, convertToMp4: false });
    const chat = (await listChats(user.id, user.id)).rows[0];
    const msg = (await listMessages(user.id, chat.id))[0];
    expect(msg.media?.url).toMatch(/^\/uploads\/chat\/.+\.jpeg$/);
    expect(msg.media?.type).toBe('image/jpeg');
    expect(readFileSync(path.join(dir, 'chat', msg.media!.url.split('/').pop()!))).toEqual(JPEG);
    expect(readConfig(row).apiKey).toBe('k');
  });

  it('si el gateway falla queda pendiente y se baja al abrirlo; lo que pasa el tope no se guarda', async () => {
    let fail = true;
    let huge = false;
    vi.stubGlobal('fetch', async () => {
      if (fail) return new Response('{}', { status: 500 });
      const data = huge ? Buffer.alloc(11 * 1024 * 1024) : JPEG;
      return new Response(JSON.stringify({ base64: data.toString('base64'), mimetype: 'image/jpeg' }), { status: 201 });
    });
    const user = await makeUser('evo-media-lazy');
    const n = await createNumber(user.id, user.id, { provider: 'evolution', config: { baseUrl: 'https://evo.example.com', apiKey: 'k', session: 's' } });
    const row = (await getNumberRowById(n.id))!;
    await ingestEvents(row, parseEvolutionWebhook(imageEvent('IMG4')));
    await ingestEvents(row, parseEvolutionWebhook(imageEvent('IMG5')));
    const raw = (id: string) => getDb().prepare('SELECT id, media_url FROM groups_messages WHERE number_id = ? AND provider_message_id = ?').get(row.id, id) as Promise<{ id: string; media_url: string }>;
    const pending = await raw('IMG4');
    expect(pending.media_url).toBe('evo:IMG4');
    const chat = (await listChats(user.id, user.id)).rows[0];
    expect((await listMessages(user.id, chat.id)).find((m) => m.id === pending.id)?.media?.url).toBe(`/api/groups/media/${pending.id}`);

    fail = false;
    // Lo mismo que hace la ruta de media al abrir el archivo.
    expect(await storeInboundMedia(row, pending.id, { providerMessageId: 'IMG4', chatId: '5491155550000@s.whatsapp.net', fromMe: false })).toMatch(/^\/uploads\/chat\//);
    expect((await raw('IMG4')).media_url).toMatch(/^\/uploads\/chat\//);

    huge = true;
    const big = await raw('IMG5');
    await expect(storeInboundMedia(row, big.id, { providerMessageId: 'IMG5', chatId: '5491155550000@s.whatsapp.net', fromMe: false })).rejects.toMatchObject({ httpStatus: 413 });
    expect((await raw('IMG5')).media_url).toBe('evo:IMG5');
  });
});
