import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { type FetchLike } from '@/lib/groups-provider';
import { evolutionProvider, wahaProvider } from '@/lib/groups-provider-bridge';
import { fakeSent, resetFakeProvider } from '@/lib/groups-provider-fake';
import { connectNumber, createNumber, getNumberRowById, ingestEvents, listChats, listMessages, retryMessage, sendMessage } from '@/lib/groups';
import { getDb } from '@/lib/db';
import { connectWhatsapp } from '@/lib/inbox/whatsapp';
import { listMessages as listInboxMessages, upsertThread } from '@/lib/inbox/core';
import { captionMentions, sendWhatsappMedia } from '@/lib/inbox/wa-media';
import { serializeWaMentions, waMentionables } from '@/lib/wa-compose-mentions';
import { makeUser } from './helpers';

/**
 * Menciones en el pie de un archivo (foto, video, documento) en un grupo, en
 * Lines e Inbox: el pie sale con "@<id>" y la lista de mencionados, igual que
 * un texto (sendMedia de Evolution con `mentioned`, WAHA con `mentions`).
 * Nombres y números inventados.
 */

const ANA = { phone: '5491155550101', lid: '118571178918101', name: 'Ana Prueba' };
const BETO = { phone: '5491155550102', lid: '118571178918102', name: 'Beto Prueba' };

function evoFetch(participants: unknown[]) {
  const calls: Array<{ url: string; body: Record<string, unknown> | undefined }> = [];
  const f: FetchLike = async (url, init = {}) => {
    calls.push({ url, body: typeof init.body === 'string' ? JSON.parse(init.body) : undefined });
    const out = url.includes('/group/findGroupInfos/') ? { id: 'g', participants } : { key: { id: 'X' } };
    return new Response(JSON.stringify(out), { status: 200, headers: { 'content-type': 'application/json' } });
  };
  return { f, calls, media: () => calls.filter((c) => c.url.includes('/message/sendMedia/')).map((c) => c.body!) };
}

function plainFetch() {
  const calls: Array<{ url: string; body: Record<string, unknown> | undefined }> = [];
  const f: FetchLike = async (url, init = {}) => {
    calls.push({ url, body: typeof init.body === 'string' ? JSON.parse(init.body) : undefined });
    return new Response(JSON.stringify({ id: 'X', key: { id: 'X' } }), { status: 200, headers: { 'content-type': 'application/json' } });
  };
  return { f, calls };
}

const typed = `Mirá @${ANA.name} y @${BETO.name}`;
const people = waMentionables([ANA, BETO]);

describe('Evolution: sendMedia con menciones en el pie', () => {
  const cfg = { baseUrl: 'https://evo.example.com', apiKey: 'k', session: 'caption-mentions' };

  it('grupo por teléfono: el pie con "@<teléfono>" y `mentioned` con los JIDs completos', async () => {
    const evo = evoFetch([{ id: `${ANA.phone}@s.whatsapp.net` }, { id: `${BETO.phone}@s.whatsapp.net` }]);
    const p = evolutionProvider(cfg, { fetch: evo.f });
    const out = serializeWaMentions(typed, people);
    await p.sendMedia('120363100000000101@g.us', { url: 'https://cdn.example.com/f.jpg', mimetype: 'image/jpeg', filename: 'f.jpg', caption: out.body, kind: 'image', mentions: out.mentions });
    expect(evo.media()[0]).toMatchObject({
      number: '120363100000000101@g.us',
      mediatype: 'image',
      caption: `Mirá @${ANA.phone} y @${BETO.phone}`,
      mentioned: [`${ANA.phone}@s.whatsapp.net`, `${BETO.phone}@s.whatsapp.net`],
    });
  });

  it('grupo por lid: el pie y la lista por lid, en video y documento también', async () => {
    const evo = evoFetch([
      { id: `${ANA.lid}@lid`, phoneNumber: `${ANA.phone}@s.whatsapp.net` },
      { id: `${BETO.lid}@lid`, phoneNumber: `${BETO.phone}@s.whatsapp.net` },
    ]);
    const p = evolutionProvider(cfg, { fetch: evo.f });
    const caption = `ojo @${ANA.phone}`;
    await p.sendMedia('120363100000000102@g.us', { url: 'https://cdn.example.com/v.mp4', mimetype: 'video/mp4', filename: 'v.mp4', caption, kind: 'video', mentions: [ANA.phone] });
    await p.sendMedia('120363100000000102@g.us', { url: 'https://cdn.example.com/a.pdf', mimetype: 'application/pdf', filename: 'a.pdf', caption, kind: 'document', mentions: [ANA.phone] });
    for (const body of evo.media()) expect(body).toMatchObject({ caption: `ojo @${ANA.lid}`, mentioned: [`${ANA.lid}@lid`] });
    // El grupo se pregunta una vez.
    expect(evo.calls.filter((c) => c.url.includes('/group/findGroupInfos/'))).toHaveLength(1);
  });

  it('sin menciones, sin pie o en un audio: no lleva `mentioned` ni pregunta por el grupo', async () => {
    const evo = evoFetch([]);
    const p = evolutionProvider(cfg, { fetch: evo.f });
    await p.sendMedia('120363100000000103@g.us', { url: 'https://cdn.example.com/f.jpg', mimetype: 'image/jpeg', filename: 'f.jpg', caption: `hola @${ANA.phone}`, kind: 'image' });
    await p.sendMedia('120363100000000103@g.us', { url: 'https://cdn.example.com/f.jpg', mimetype: 'image/jpeg', filename: 'f.jpg', caption: '', kind: 'image', mentions: [ANA.phone] });
    await p.sendMedia('120363100000000103@g.us', { url: 'https://cdn.example.com/t.mp3', mimetype: 'audio/mpeg', filename: 't.mp3', caption: `@${ANA.phone}`, kind: 'audio', mentions: [ANA.phone] });
    expect(evo.media()).toHaveLength(3);
    for (const body of evo.media()) expect(body).not.toHaveProperty('mentioned');
    expect(evo.calls.filter((c) => c.url.includes('/group/findGroupInfos/'))).toHaveLength(0);
  });
});

describe('WAHA: sendImage / sendFile con menciones en el pie', () => {
  it('"mentions" con ids de WhatsApp, como sendText', async () => {
    const waha = plainFetch();
    const p = wahaProvider({ baseUrl: 'https://waha.example.com', apiKey: 'k', session: 'acme' }, { fetch: waha.f });
    await p.sendMedia('123@g.us', { url: 'https://cdn.example.com/f.jpg', mimetype: 'image/jpeg', filename: 'f.jpg', caption: `hola @${ANA.phone}`, mentions: [ANA.phone, `${BETO.lid}@lid`] });
    await p.sendMedia('123@g.us', { url: 'https://cdn.example.com/a.pdf', mimetype: 'application/pdf', filename: 'a.pdf', caption: '', mentions: [ANA.phone] });
    expect(waha.calls[0]).toMatchObject({ url: 'https://waha.example.com/api/sendImage', body: { chatId: '123@g.us', caption: `hola @${ANA.phone}`, mentions: [`${ANA.phone}@c.us`, `${BETO.lid}@lid`] } });
    expect(waha.calls[1].url).toBe('https://waha.example.com/api/sendFile');
    expect(waha.calls[1].body).not.toHaveProperty('mentions');
  });
});

describe('Inbox: qué menciones del pie valen', () => {
  it('solo en grupos, en foto/video/documento y si el teléfono está escrito en el pie', () => {
    const caption = `listo @${ANA.phone}`;
    expect(captionMentions([ANA.phone, BETO.phone, ANA.phone, 'x'], caption, true, 'image')).toEqual([ANA.phone]);
    expect(captionMentions([ANA.phone], caption, true, 'document')).toEqual([ANA.phone]);
    expect(captionMentions([ANA.phone], caption, false, 'image')).toEqual([]);
    expect(captionMentions([ANA.phone], caption, true, 'voice')).toEqual([]);
    expect(captionMentions([ANA.phone], `listo @${ANA.phone}9`, true, 'image')).toEqual([]);
    expect(captionMentions('no', caption, true, 'image')).toEqual([]);
  });
});

describe('las apps mandan el pie con menciones y lo guardan', () => {
  beforeEach(() => {
    vi.stubEnv('GROUPS_FAKE', '1');
    vi.stubEnv('RATE_LIMIT_DISABLED', 'true');
    resetFakeProvider();
  });
  afterEach(() => vi.unstubAllEnvs());

  it('Lines: la foto sale con la mención, queda guardada y el reintento la vuelve a mencionar', async () => {
    const user = await makeUser('wa-caption-lines');
    const n = await createNumber(user.id, user.id, { provider: 'fake' });
    await connectNumber(user.id, n.id);
    const st = (globalThis as unknown as { __groupsFake: Map<string, { connectedAt: number | null }> }).__groupsFake.get(n.id);
    if (st) st.connectedAt = Date.now() - 5000;
    const row = (await getNumberRowById(n.id))!;
    await ingestEvents(row, [
      { type: 'message', chatId: '120363000000000201@g.us', isGroup: true, fromMe: false, senderPhone: ANA.phone, senderName: ANA.name, providerMessageId: 'CM-1', body: 'hola' },
    ]);
    const chat = (await listChats(user.id, user.id)).rows.find((c) => c.kind === 'group')!;
    const sent = await sendMessage(user.id, user.id, chat.id, {
      body: `la foto @${ANA.phone}`,
      media: { url: 'https://cdn.example.com/f.jpg', mimetype: 'image/jpeg', filename: 'f.jpg', width: 1, height: 1 },
      // Una que no está en el pie no se menciona.
      mentions: [ANA.phone, BETO.phone],
    });
    expect(sent.status).toBe('sent');
    expect(fakeSent(n.id).filter((s) => s.kind === 'media').at(-1)).toMatchObject({ text: `la foto @${ANA.phone}`, mentions: [ANA.phone], mentioned: [`${ANA.phone}@s.whatsapp.net`] });
    const saved = (await listMessages(user.id, chat.id)).find((m) => m.id === sent.id)!;
    expect(saved.meta).toMatchObject({ mentions: [ANA.phone] });
    expect(saved.mentionNames?.[ANA.phone]?.name).toBe(ANA.name);

    await getDb().prepare("UPDATE groups_messages SET status = 'failed' WHERE id = ?").run(sent.id);
    await retryMessage(user.id, user.id, sent.id);
    expect(fakeSent(n.id).filter((s) => s.kind === 'media').at(-1)).toMatchObject({ mentions: [ANA.phone] });
  });

  it('Inbox: el documento sale con la mención y queda guardada; en un 1 a 1 no menciona', async () => {
    const u = await makeUser('wa-caption-inbox');
    let account = (await connectWhatsapp(u.id)).account;
    await getDb().prepare("UPDATE inbox_accounts SET status = 'connected' WHERE id = ?").run(account.id);
    account = { ...account, status: 'connected' };
    const st = (globalThis as unknown as { __groupsFake: Map<string, { connectedAt: number | null }> }).__groupsFake.get(`inbox-${account.id}`);
    if (st) st.connectedAt = Date.now() - 5000;
    const g = await upsertThread(account, { externalId: '120363000000000202@g.us', kind: 'group', title: 'Obra' });
    await sendWhatsappMedia(u.id, g.id, { data: Buffer.from('%PDF-1.4'), mimetype: 'application/pdf', filename: 'plano.pdf', size: 8, caption: `@${ANA.phone} el plano`, mentions: [ANA.phone, BETO.phone] });
    const out = fakeSent(`inbox-${account.id}`).filter((s) => s.kind === 'media').at(-1)!;
    expect(out).toMatchObject({ text: `@${ANA.phone} el plano`, mentions: [ANA.phone], mentioned: [`${ANA.phone}@s.whatsapp.net`] });
    const saved = (await listInboxMessages(u.id, g.id)).messages.at(-1)!;
    expect(saved).toMatchObject({ fromMe: true, body: `@${ANA.phone} el plano` });
    expect(saved.meta).toMatchObject({ mentions: [ANA.phone] });

    const dm = await upsertThread(account, { externalId: `${BETO.phone}@s.whatsapp.net`, kind: 'dm', handle: BETO.phone });
    await sendWhatsappMedia(u.id, dm.id, { data: Buffer.from([0x89, 0x50]), mimetype: 'image/png', filename: 'a.png', size: 2, caption: `@${ANA.phone}`, mentions: [ANA.phone] });
    expect(fakeSent(`inbox-${account.id}`).filter((s) => s.kind === 'media').at(-1)).not.toHaveProperty('mentions');
  });
});
