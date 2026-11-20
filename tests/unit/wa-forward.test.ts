/**
 * Reenvíos con la marca de WhatsApp ("Reenviado", y "Reenviado muchas veces" desde score 5): el pedido a Evolution
 * lleva `forward` solo al reenviar (texto, archivo, nota de voz y sticker), el score es el del original + 1, y la
 * copia queda guardada como reenviada con su score, en Lines y en Inbox. Con el WhatsApp falso; datos inventados.
 */
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { getDb } from '@/lib/db';
import { PROVIDER_CAPS, type FetchLike } from '@/lib/groups-provider';
import { evolutionMessageEvents, evolutionProvider } from '@/lib/groups-provider-bridge';
import { fakeSent, resetFakeProvider } from '@/lib/groups-provider-fake';
import { connectNumber, createNumber, getNumberRowById, ingestEvents, listChats, listMessages, sendMessage } from '@/lib/groups';
import { forwardMessage as linesForward } from '@/lib/groups-inbox';
import { listMessages as inboxMessages, listThreads, type AccountRow } from '@/lib/inbox/core';
import { connectWhatsapp, ingestWhatsappEvents } from '@/lib/inbox/whatsapp';
import { forwardMessage as inboxForward, sendWaMessage } from '@/lib/inbox/wa-actions';
import { evolutionForward, forwardedMany, nextForwardScore, storedForwardScore } from '@/lib/wa-forward';
import { makeUser } from './helpers';

function mockFetch() {
  const calls: Array<{ url: string; body: Record<string, unknown> }> = [];
  const f: FetchLike = async (url, init = {}) => {
    calls.push({ url, body: typeof init.body === 'string' ? (JSON.parse(init.body) as Record<string, unknown>) : {} });
    return new Response(JSON.stringify({ key: { id: 'EVO-1' } }), { status: 200, headers: { 'content-type': 'application/json' } });
  };
  return { f, calls };
}

describe('score y marca', () => {
  it('la copia suma uno al original; un original sin marca da 1; "muchas veces" desde 5', () => {
    expect(nextForwardScore({ forwarded: false })).toBe(1);
    expect(nextForwardScore({ forwarded: false, meta: { fwd: 9 } })).toBe(1);
    expect(nextForwardScore({ forwarded: true })).toBe(2);
    expect(nextForwardScore({ forwarded: true, meta: { fwd: 4 } })).toBe(5);
    expect(storedForwardScore({ fwd: 'x' })).toBe(0);
    expect(storedForwardScore(null)).toBe(0);
    expect(forwardedMany(true, { fwd: 5 })).toBe(true);
    expect(forwardedMany(true, { fwd: 4 })).toBe(false);
    expect(forwardedMany(false, { fwd: 9 })).toBe(false);
    expect(evolutionForward(undefined)).toEqual({});
    expect(evolutionForward({ score: 0 })).toEqual({ forward: { score: 1 } });
    expect(evolutionForward({ score: 3, key: { id: 'A1', remoteJid: 'x@s.whatsapp.net', fromMe: false } })).toEqual({
      forward: { score: 3, key: { id: 'A1', remoteJid: 'x@s.whatsapp.net', fromMe: false } },
    });
  });

  it('lo que llega de Evolution trae el score (contextInfo.forwardingScore)', () => {
    const [ev] = evolutionMessageEvents({
      key: { id: 'IN-1', remoteJid: '5491100000000@s.whatsapp.net', fromMe: false },
      pushName: 'Ana',
      messageTimestamp: 1_700_000_000,
      message: { extendedTextMessage: { text: 'cadena', contextInfo: { isForwarded: true, forwardingScore: 7 } } },
    });
    expect(ev).toMatchObject({ type: 'message', forwarded: true, forwardingScore: 7 });
    const [plain] = evolutionMessageEvents({
      key: { id: 'IN-2', remoteJid: '5491100000000@s.whatsapp.net', fromMe: false },
      messageTimestamp: 1_700_000_000,
      message: { conversation: 'hola' },
    });
    expect(plain).not.toHaveProperty('forwarded');
    expect(plain).not.toHaveProperty('forwardingScore');
  });
});

describe('Evolution: el pedido lleva `forward` solo al reenviar', () => {
  it('texto, foto, nota de voz y sticker', async () => {
    const { f, calls } = mockFetch();
    const p = evolutionProvider({ baseUrl: 'https://evo.example.com', apiKey: 'k', session: 'inst' }, { fetch: f });
    const key = { id: 'ORIG-1', remoteJid: '5491100000001@s.whatsapp.net', fromMe: false };
    await p.sendText('5491100000002@s.whatsapp.net', 'hola');
    await p.sendText('5491100000002@s.whatsapp.net', 'hola', { forward: { score: 2, key } });
    const media = { url: 'https://cdn.example.com/a', mimetype: 'image/jpeg', filename: 'a.jpg', caption: 'foto' };
    await p.sendMedia('5491100000002@s.whatsapp.net', { ...media, kind: 'image' });
    await p.sendMedia('5491100000002@s.whatsapp.net', { ...media, kind: 'image', forward: { score: 1, key } });
    await p.sendMedia('5491100000002@s.whatsapp.net', { ...media, mimetype: 'audio/ogg', kind: 'voice', forward: { score: 5 } });
    await p.sendMedia('5491100000002@s.whatsapp.net', { ...media, mimetype: 'image/webp', kind: 'sticker', forward: { score: 1 } });
    const [text, textFwd, img, imgFwd, voice, sticker] = calls.filter((c) => c.url.includes('/message/'));
    expect(text.url).toContain('/message/sendText/inst');
    expect(text.body).not.toHaveProperty('forward');
    expect(textFwd.body).toMatchObject({ text: 'hola', forward: { score: 2, key } });
    expect(img.url).toContain('/message/sendMedia/inst');
    expect(img.body).not.toHaveProperty('forward');
    expect(imgFwd.body).toMatchObject({ mediatype: 'image', caption: 'foto', forward: { score: 1, key } });
    expect(voice.url).toContain('/message/sendWhatsAppAudio/inst');
    expect(voice.body).toMatchObject({ forward: { score: 5 } });
    expect(sticker.url).toContain('/message/sendSticker/inst');
    expect(sticker.body).toMatchObject({ forward: { score: 1 } });
  });
});

describe('Lines', () => {
  beforeEach(() => {
    vi.stubEnv('GROUPS_FAKE', '1');
    vi.stubEnv('RATE_LIMIT_DISABLED', 'true');
    resetFakeProvider();
  });

  async function setup(label: string) {
    const user = await makeUser(label);
    const n = await createNumber(user.id, user.id, { provider: 'fake' });
    await connectNumber(user.id, n.id);
    const s = (globalThis as unknown as { __groupsFake: Map<string, { connectedAt: number | null }> }).__groupsFake.get(n.id);
    if (s) s.connectedAt = Date.now() - 5000;
    return { user, row: (await getNumberRowById(n.id))! };
  }

  const inbound = (chatId: string, id: string, body: string) => ({
    type: 'message' as const,
    chatId,
    isGroup: false,
    fromMe: false,
    senderPhone: chatId.replace(/@.*/, ''),
    senderName: 'Ana',
    providerMessageId: id,
    body,
  });

  /** Como Evolution: sin reenvío nativo, sale por sendText/sendMedia. */
  async function withoutNativeForward<T>(fn: () => Promise<T>): Promise<T> {
    const caps = PROVIDER_CAPS.fake;
    const prev = caps.forward;
    caps.forward = false;
    try {
      return await fn();
    } finally {
      caps.forward = prev;
    }
  }

  it('texto: sale con la marca y el original; la copia queda reenviada con su score; un envío normal no la lleva', async () => {
    const { user, row } = await setup('lines-fwd-flag');
    await ingestEvents(row, [
      inbound('5491100000101@c.us', 'LF-1', 'Pasalo'),
      { ...inbound('5491100000101@c.us', 'LF-2', 'Cadena'), forwarded: true, forwardingScore: 4 },
      inbound('5491100000102@c.us', 'LF-3', 'hola'),
    ]);
    const chats = (await listChats(user.id, user.id)).rows;
    const from = chats.find((c) => c.phone === '5491100000101')!;
    const to = chats.find((c) => c.phone === '5491100000102')!;
    const msgs = await listMessages(user.id, from.id);
    const plain = msgs.find((m) => m.body === 'Pasalo')!;
    const chain = msgs.find((m) => m.body === 'Cadena')!;
    expect(chain.meta).toMatchObject({ fwd: 4 });

    await sendMessage(user.id, user.id, to.id, { body: 'normal' });
    expect(fakeSent(row.id).at(-1)).toMatchObject({ kind: 'text', text: 'normal' });
    expect(fakeSent(row.id).at(-1)).not.toHaveProperty('forward');

    await withoutNativeForward(() => linesForward(user.id, user.id, plain.id, [to.id]));
    expect(fakeSent(row.id).at(-1)).toMatchObject({ kind: 'text', text: 'Pasalo', forward: { score: 1, key: { id: 'LF-1', remoteJid: '5491100000101@c.us', fromMe: false } } });
    await withoutNativeForward(() => linesForward(user.id, user.id, chain.id, [to.id]));
    expect(fakeSent(row.id).at(-1)).toMatchObject({ kind: 'text', text: 'Cadena', forward: { score: 5 } });

    const copies = (await listMessages(user.id, to.id)).filter((m) => m.direction === 'out' && m.forwarded);
    expect(copies.map((m) => [m.body, m.meta.fwd])).toEqual([
      ['Pasalo', 1],
      ['Cadena', 5],
    ]);
    expect(forwardedMany(copies[1].forwarded, copies[1].meta)).toBe(true);
  });

  it('archivo: la foto reenviada lleva la marca en sendMedia', async () => {
    const { user, row } = await setup('lines-fwd-media');
    await ingestEvents(row, [
      { ...inbound('5491100000111@c.us', 'LM-1', 'La terraza'), media: { url: 'https://cdn.example.com/foto.jpg', type: 'image/jpeg', name: '', info: { kind: 'image', width: 480, height: 320 } } },
      inbound('5491100000112@c.us', 'LM-2', 'hola'),
    ]);
    const chats = (await listChats(user.id, user.id)).rows;
    const from = chats.find((c) => c.phone === '5491100000111')!;
    const to = chats.find((c) => c.phone === '5491100000112')!;
    const photo = (await listMessages(user.id, from.id))[0];
    const fw = await withoutNativeForward(() => linesForward(user.id, user.id, photo.id, [to.id]));
    expect(fw[0]).toMatchObject({ ok: true });
    expect(fakeSent(row.id).at(-1)).toMatchObject({ kind: 'media', media: { kind: 'image' }, forward: { score: 1, key: { id: 'LM-1' } } });
    const copy = (await listMessages(user.id, to.id)).find((m) => m.direction === 'out')!;
    expect(copy).toMatchObject({ forwarded: true, meta: { fwd: 1 } });
  });
});

describe('Inbox', () => {
  let owner = '';
  let account: AccountRow;

  beforeAll(async () => {
    vi.stubEnv('GROUPS_FAKE', '1');
    const u = await makeUser('ibwa-fwd-flag');
    owner = u.id;
    account = (await connectWhatsapp(u.id)).account;
    await getDb().prepare("UPDATE inbox_accounts SET status = 'connected' WHERE id = ?").run(account.id);
    account = { ...account, status: 'connected' };
    // El proveedor falso tarda 1,5 s en "escanear".
    await new Promise((r) => setTimeout(r, 1600));
  });
  beforeEach(() => {
    vi.stubEnv('GROUPS_FAKE', '1');
  });
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  const sent = () => fakeSent(`inbox-${account.id}`);
  const base = (phone: string) => ({ type: 'message' as const, chatId: `${phone}@s.whatsapp.net`, isGroup: false, fromMe: false, senderPhone: phone, senderName: 'Ana Prueba', timestamp: new Date().toISOString() });

  async function thread(phone: string) {
    return (await listThreads(owner, { view: 'whatsapp' })).find((t) => t.handle === phone)!;
  }

  it('texto: la marca con el score del original + 1; un envío normal no la lleva', async () => {
    const tag = Math.random().toString(36).slice(2);
    await ingestWhatsappEvents(account, [
      { ...base('15550003001'), providerMessageId: `t1-${tag}`, body: 'Pasalo' },
      { ...base('15550003001'), providerMessageId: `t2-${tag}`, body: 'Cadena', forwarded: true, forwardingScore: 6 },
      { ...base('15550003002'), providerMessageId: `t3-${tag}`, body: 'hola' },
    ]);
    const from = await thread('15550003001');
    const to = await thread('15550003002');
    const msgs = (await inboxMessages(owner, from.id)).messages;
    const chain = msgs.find((m) => m.body === 'Cadena')!;
    expect(chain.meta).toMatchObject({ fwd: 6 });

    await sendWaMessage(owner, to.id, 'normal');
    expect(sent().at(-1)).toMatchObject({ kind: 'text', text: 'normal' });
    expect(sent().at(-1)).not.toHaveProperty('forward');

    await inboxForward(owner, msgs.find((m) => m.body === 'Pasalo')!.id, [to.id]);
    expect(sent().at(-1)).toMatchObject({ kind: 'text', forward: { score: 1, key: { id: `t1-${tag}`, remoteJid: '15550003001@s.whatsapp.net', fromMe: false } } });
    await inboxForward(owner, chain.id, [to.id]);
    expect(sent().at(-1)).toMatchObject({ kind: 'text', forward: { score: 7 } });

    const copies = (await inboxMessages(owner, to.id)).messages.filter((m) => m.fromMe && m.forwarded);
    expect(copies.map((m) => [m.body, m.meta?.fwd])).toEqual([
      ['Pasalo', 1],
      ['Cadena', 7],
    ]);
  });

  it('archivo: la foto reenviada lleva la marca y la copia queda con su score', async () => {
    const tag = Math.random().toString(36).slice(2);
    const ref = (id: string) => ({ providerMessageId: id, chatId: '15550003011@s.whatsapp.net', fromMe: false });
    await ingestWhatsappEvents(account, [
      { ...base('15550003011'), providerMessageId: `img-${tag}`, body: 'La terraza', media: { url: '', type: 'image/jpeg', name: '', fetchRef: ref(`img-${tag}`), info: { kind: 'image', width: 480, height: 320 } } },
      { ...base('15550003012'), providerMessageId: `h-${tag}`, body: 'hola' },
    ]);
    const from = await thread('15550003011');
    const to = await thread('15550003012');
    const photo = (await inboxMessages(owner, from.id)).messages.find((m) => m.body === 'La terraza')!;
    await inboxForward(owner, photo.id, [to.id]);
    expect(sent().at(-1)).toMatchObject({ kind: 'media', media: { kind: 'image' }, forward: { score: 1, key: { id: `img-${tag}` } } });
    const copy = (await inboxMessages(owner, to.id)).messages.at(-1)!;
    expect(copy).toMatchObject({ fromMe: true, forwarded: true, mediaType: 'image' });
    expect(copy.meta).toMatchObject({ fwd: 1, width: 480 });
  });
});
