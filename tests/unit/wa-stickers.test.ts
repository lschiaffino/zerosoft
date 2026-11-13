/**
 * Stickers de WhatsApp en Lines e Inbox: qué es sticker y qué es GIF en lo que
 * manda Evolution (payloads como los del webhook messages.upsert), cómo lo
 * guarda Inbox (antes un sticker quedaba "image" y se dibujaba como una foto
 * grande), la colección de cada persona (sin repetir, favoritos, recientes,
 * importar de los chats que ve) y lo que sale al mandar uno.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { getDb } from '@/lib/db';
import { evolutionProvider, parseEvolutionWebhook } from '@/lib/groups-provider-bridge';
import { createNumber, connectNumber, getNumberRowById, ingestEvents, listChats, listMessages, sendMessage } from '@/lib/groups';
import { planOutboundKind } from '@/lib/groups-media';
import { messageMeta } from '@/lib/inbox/wa-meta';
import { connectWhatsapp, inboxMediaType, ingestWhatsappEvents } from '@/lib/inbox/whatsapp';
import { listMessages as listInboxMessages, listThreads } from '@/lib/inbox/core';
import { fakeSent, resetFakeProvider } from '@/lib/groups-provider-fake';
import { FAKE_ANIMATED_STICKER_WEBP, FAKE_STICKER_WEBP } from '@/lib/wa-sticker-fixtures';
import { addSticker, imageToSticker, listStickers, markUsed, removeSticker, setFavorite, stickerBytes, stickerHash, syncStickers, webpInfo, type StickerOwner } from '@/lib/wa-stickers';
import { favoriteLinesMessage, linesStickerOwner, linesStickerSource } from '@/lib/groups-stickers';
import { inboxStickerOwner, inboxStickerSource, sendInboxSticker } from '@/lib/inbox/wa-stickers';
import { groupsViewer, updatePlatformSettings } from '@/lib/groups-access';
import type { FetchLike, InboundEvent } from '@/lib/groups-provider';
import { makeUser } from './helpers';

type MessageEvent = Extract<InboundEvent, { type: 'message' }>;

/** Un messages.upsert de Evolution v2 como llega al webhook. */
function upsert(message: Record<string, unknown>, id = 'STK1', remoteJid = '120363041234567890@g.us'): MessageEvent {
  return parseEvolutionWebhook({
    event: 'messages.upsert',
    instance: 'zerosoft',
    data: {
      key: { remoteJid, fromMe: false, id, participant: '5491155550001@s.whatsapp.net' },
      pushName: 'Beto',
      messageType: Object.keys(message)[0],
      messageTimestamp: 1762900000,
      message,
    },
  })[0] as MessageEvent;
}

// fileSha256 como lo manda Evolution (base64 de 32 bytes).
const SHA_B64 = Buffer.alloc(32, 7).toString('base64');
const SHA_HEX = Buffer.alloc(32, 7).toString('hex');
const common = {
  url: 'https://mmg.whatsapp.net/v/t62.15575-24/abc.enc?ccb=11-4',
  fileSha256: SHA_B64,
  fileEncSha256: Buffer.alloc(32, 9).toString('base64'),
  mediaKey: Buffer.alloc(32, 3).toString('base64'),
  directPath: '/v/t62.15575-24/abc.enc?ccb=11-4',
  mediaKeyTimestamp: '1762899990',
};

describe('qué es sticker y qué es GIF (payloads de Evolution)', () => {
  it('sticker quieto: kind sticker, image/webp, se baja, con su SHA-256', () => {
    const ev = upsert({ stickerMessage: { ...common, mimetype: 'image/webp', height: 64, width: 64, fileLength: '18234', isAnimated: false, isAvatar: false, isAiSticker: false, isLottie: false } });
    expect(ev.media).toMatchObject({ type: 'image/webp', url: 'evo:STK1', fetchRef: { providerMessageId: 'STK1' } });
    expect(ev.media?.info).toMatchObject({ kind: 'sticker', sha: SHA_HEX, size: 18234 });
    expect(ev.media?.info?.animated).toBeUndefined();
  });

  it('sticker animado: sigue siendo sticker (no video), animado', () => {
    const ev = upsert({ stickerMessage: { ...common, mimetype: 'image/webp', height: 512, width: 512, fileLength: { low: 152_000, high: 0 }, isAnimated: true, isLottie: false } });
    expect(ev.media?.type).toBe('image/webp');
    expect(ev.media?.info).toMatchObject({ kind: 'sticker', animated: true });
    // Inbox: se guarda como sticker (antes 'image': una foto grande con la hora encima).
    expect(inboxMediaType(ev.media!.type, ev.media!.info?.kind)).toBe('sticker');
    const meta = messageMeta(ev);
    expect(meta.kind).toBe('sticker');
    expect(JSON.parse(meta.meta)).toMatchObject({ animated: true, mime: 'image/webp', sha: SHA_HEX });
  });

  it('sticker Lottie (envuelto en lottieStickerMessage): sticker, sin bajar el archivo', () => {
    const ev = upsert({ lottieStickerMessage: { message: { stickerMessage: { ...common, mimetype: 'application/was', isAnimated: true, isLottie: true } } } });
    expect(ev.media?.info).toMatchObject({ kind: 'sticker', lottie: true });
    expect(ev.media?.url).toBe('');
    expect(ev.media?.fetchRef).toBeUndefined();
    expect(inboxMediaType(ev.media!.type, ev.media!.info?.kind)).toBe('sticker');
  });

  it('sticker en un mensaje temporal (ephemeralMessage)', () => {
    const ev = upsert({ ephemeralMessage: { message: { stickerMessage: { ...common, mimetype: 'image/webp', isAnimated: true } } } });
    expect(ev.media?.info).toMatchObject({ kind: 'sticker', animated: true });
  });

  it('GIF: un videoMessage con gifPlayback es video animado (burbuja con GIF), no sticker', () => {
    const ev = upsert({ videoMessage: { ...common, mimetype: 'video/mp4', seconds: 3, gifPlayback: true, gifAttribution: 'TENOR', height: 270, width: 480, fileLength: '220000' } });
    expect(ev.media?.info).toMatchObject({ kind: 'video', animated: true, width: 480, height: 270 });
    expect(ev.media?.info?.sha).toBeUndefined();
    expect(inboxMediaType(ev.media!.type, ev.media!.info?.kind)).toBe('video');
    expect(JSON.parse(messageMeta(ev).meta)).toMatchObject({ animated: true });
  });

  it('un video normal no es GIF', () => {
    const ev = upsert({ videoMessage: { ...common, mimetype: 'video/mp4', seconds: 12 } });
    expect(ev.media?.info?.animated).toBeUndefined();
  });

  it('una foto webp (imageMessage) sigue siendo foto', () => {
    const ev = upsert({ imageMessage: { ...common, mimetype: 'image/webp', width: 800, height: 600 } });
    expect(inboxMediaType(ev.media!.type, ev.media!.info?.kind)).toBe('image');
  });
});

describe('WebP', () => {
  it('lee si es animado y sus medidas', () => {
    expect(webpInfo(FAKE_STICKER_WEBP)).toMatchObject({ animated: false, width: 96, height: 96 });
    expect(webpInfo(FAKE_ANIMATED_STICKER_WEBP)).toMatchObject({ animated: true, width: 96, height: 96 });
    expect(webpInfo(Buffer.from('not a webp at all, just some bytes'))).toBeNull();
  });

  it('crear un sticker desde una imagen: WebP de 512×512 (un GIF queda animado)', async () => {
    const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==', 'base64');
    const out = await imageToSticker(png, 'image/png');
    expect(webpInfo(out)).toMatchObject({ width: 512, height: 512, animated: false });
    expect(out.length).toBeLessThanOrEqual(100 * 1024);
    const again = await imageToSticker(FAKE_ANIMATED_STICKER_WEBP, 'image/webp');
    expect(webpInfo(again)).toMatchObject({ width: 512, height: 512, animated: true });
    await expect(imageToSticker(Buffer.from('%PDF'), 'application/pdf')).rejects.toMatchObject({ code: 'invalid_sticker' });
  });
});

describe('colección', () => {
  let owner: StickerOwner;
  beforeEach(async () => {
    const u = await makeUser('stk');
    owner = { userId: u.id, app: 'inbox', scope: '' };
  });

  it('no repite el mismo archivo; favorito y recientes; quitar', async () => {
    const a = await addSticker(owner, FAKE_STICKER_WEBP);
    expect(a.added).toBe(true);
    expect(a.sticker).toMatchObject({ animated: false, favorite: false, usedAt: null });
    const again = await addSticker(owner, Buffer.from(FAKE_STICKER_WEBP), { favorite: true });
    expect(again.added).toBe(false);
    expect(again.sticker.id).toBe(a.sticker.id);
    expect(again.sticker.favorite).toBe(true);
    // Dos a la vez: uno solo.
    const [x, y] = await Promise.all([addSticker(owner, FAKE_ANIMATED_STICKER_WEBP), addSticker(owner, FAKE_ANIMATED_STICKER_WEBP)]);
    expect(x.sticker.id).toBe(y.sticker.id);
    expect([x.added, y.added].filter(Boolean)).toHaveLength(1);
    expect(x.sticker.animated).toBe(true);
    let list = await listStickers(owner);
    expect(list).toHaveLength(2);
    await markUsed(owner, x.sticker.id);
    await setFavorite(owner, a.sticker.id, false);
    list = await listStickers(owner);
    expect(list.find((s) => s.id === x.sticker.id)?.usedAt).toBeTruthy();
    expect(list.find((s) => s.id === a.sticker.id)?.favorite).toBe(false);
    // El archivo vuelve igual (se guarda cifrado).
    expect((await stickerBytes(owner, a.sticker.id)).data.equals(FAKE_STICKER_WEBP)).toBe(true);
    expect(list[0].url).toMatch(/^\/api\/inbox\/stickers\?img=/);
    await removeSticker(owner, a.sticker.id);
    expect((await listStickers(owner)).map((s) => s.id)).toEqual([x.sticker.id]);
  });

  it('es de cada persona: otra no ve ni usa el sticker', async () => {
    const other = await makeUser('stk-other');
    const mine = await addSticker(owner, FAKE_STICKER_WEBP);
    const theirs: StickerOwner = { userId: other.id, app: 'inbox', scope: '' };
    expect(await listStickers(theirs)).toEqual([]);
    await expect(stickerBytes(theirs, mine.sticker.id)).rejects.toMatchObject({ code: 'not_found' });
    // Lines e Inbox son colecciones distintas.
    expect(await listStickers({ ...owner, app: 'lines' })).toEqual([]);
  });

  it('no acepta algo que no es WebP', async () => {
    await expect(addSticker(owner, Buffer.from('%PDF-1.4'))).rejects.toMatchObject({ code: 'invalid_sticker' });
  });

  it('importar: sin repetir, y con el SHA-256 de WhatsApp ni lo baja', async () => {
    const fetched: number[] = [];
    const rows = [
      { rowid: 1, bytes: FAKE_STICKER_WEBP },
      { rowid: 2, bytes: FAKE_STICKER_WEBP },
      { rowid: 3, bytes: FAKE_ANIMATED_STICKER_WEBP, sha: stickerHash(FAKE_ANIMATED_STICKER_WEBP) },
      { rowid: 4, bytes: null },
    ];
    const source = {
      async next(after: number, limit: number) {
        return rows
          .filter((r) => r.rowid > after)
          .slice(0, limit)
          .map((r) => ({
            rowid: r.rowid,
            sha: r.sha,
            fetch: async () => {
              fetched.push(r.rowid);
              return r.bytes;
            },
          }));
      },
    };
    const first = await syncStickers(owner, source, { limit: 2 });
    expect(first).toMatchObject({ added: 1, scanned: 2, more: true });
    const second = await syncStickers(owner, source, { limit: 10 });
    expect(second).toMatchObject({ added: 1, more: false });
    expect(await listStickers(owner)).toHaveLength(2);
    // El 3 ya estaba (mismo SHA-256): la segunda vuelta lo saltea sin bajarlo.
    await addSticker(owner, FAKE_ANIMATED_STICKER_WEBP);
    fetched.length = 0;
    await getDb().prepare('UPDATE wa_sticker_sync SET cursor = 2 WHERE user_id = ?').run(owner.userId);
    await syncStickers(owner, source, { limit: 10 });
    expect(fetched).toEqual([4]);
  });
});

describe('Lines: de los chats que la persona ve', () => {
  beforeEach(() => {
    vi.stubEnv('GROUPS_FAKE', '1');
    vi.stubEnv('RATE_LIMIT_DISABLED', 'true');
    resetFakeProvider();
  });
  afterEach(() => vi.unstubAllEnvs());

  it('el sticker recibido se ve como sticker, se importa, se marca favorito y se manda como sticker', async () => {
    const u = await makeUser('stk-lines');
    const n = await createNumber(u.id, u.id, { provider: 'fake' });
    await connectNumber(u.id, n.id);
    const fake = (globalThis as unknown as { __groupsFake: Map<string, { connectedAt: number | null }> }).__groupsFake.get(n.id);
    if (fake) fake.connectedAt = Date.now() - 5000;
    await getDb().prepare("UPDATE groups_numbers SET status = 'connected' WHERE id = ?").run(n.id);
    const number = (await getNumberRowById(n.id))!;
    const chatId = '120363041234567890@g.us';
    const base = { type: 'message' as const, chatId, isGroup: true, fromMe: false, senderPhone: '5491155550001', senderName: 'Beto', body: '', timestamp: new Date().toISOString() };
    const ref = (id: string) => ({ providerMessageId: id, chatId, fromMe: false });
    await ingestEvents(number, [
      { ...base, providerMessageId: 'astk-1', media: { url: 'evo:astk-1', type: 'image/webp', name: '', fetchRef: ref('astk-1'), info: { kind: 'sticker', animated: true } } },
      { ...base, providerMessageId: 'stk-1', media: { url: 'evo:stk-1', type: 'image/webp', name: '', fetchRef: ref('stk-1'), info: { kind: 'sticker' } } },
      { ...base, providerMessageId: 'stk-2', media: { url: 'evo:stk-2', type: 'image/webp', name: '', fetchRef: ref('stk-2'), info: { kind: 'sticker' } } },
    ]);
    // Los archivos se bajan después de guardar los mensajes.
    await vi.waitFor(async () => {
      const rows = (await getDb().prepare("SELECT media_url FROM groups_messages WHERE user_id = ? AND media_url LIKE 'evo:%'").all(u.id)) as unknown[];
      expect(rows).toHaveLength(0);
    });
    const [chat] = (await listChats(u.id, u.id, {})).rows;
    const msgs = await listMessages(u.id, chat.id, { limit: 20 });
    expect(msgs.filter((m) => m.media?.kind === 'sticker')).toHaveLength(3);
    expect(chat.lastMessagePreview).toBe('[sticker]');

    const viewer = await groupsViewer(u.id, u.id, 'owner');
    const owner = linesStickerOwner(viewer);
    const r = await syncStickers(owner, linesStickerSource(viewer), { limit: 50 });
    // Dos archivos distintos (stk-1 y stk-2 son el mismo).
    expect(r.added).toBe(2);
    const list = await listStickers(owner);
    expect(list.map((s) => s.animated).sort()).toEqual([false, true]);
    expect(list[0].url).toMatch(/^\/api\/groups\/stickers\?img=/);

    const fav = await favoriteLinesMessage(viewer, msgs.find((m) => m.media?.kind === 'sticker')!.id);
    expect(fav.favorite).toBe(true);
    expect((await listStickers(owner)).filter((s) => s.favorite)).toHaveLength(1);

    // Un miembro que no ve la línea no importa nada de ahí.
    const member = await makeUser('stk-member');
    await getDb().prepare("UPDATE groups_numbers SET visibility = 'private' WHERE id = ?").run(n.id);
    const memberViewer = await groupsViewer(u.id, member.id, 'member');
    await updatePlatformSettings(u.id, {});
    const none = await syncStickers(linesStickerOwner(memberViewer), linesStickerSource(memberViewer), { limit: 50 });
    expect(none.added).toBe(0);
    await expect(favoriteLinesMessage(memberViewer, msgs[0].id)).rejects.toMatchObject({ code: 'not_found' });

    // Mandar: sale como sticker (sendSticker en Evolution).
    expect(planOutboundKind('image/webp', 1514, 'sticker')).toBe('sticker');
    const sent = await sendMessage(u.id, u.id, chat.id, { body: '', media: { url: 'https://store.public.blob.vercel-storage.com/chat/s.webp', mimetype: 'image/webp', filename: 'sticker.webp', kind: 'sticker' } });
    expect(sent.media?.kind).toBe('sticker');
    expect(sent.status).toBe('sent');
    expect(fakeSent(n.id).at(-1)).toMatchObject({ kind: 'media' });
  });
});

describe('Inbox: guardar, importar y mandar', () => {
  beforeEach(() => {
    vi.stubEnv('GROUPS_FAKE', '1');
    vi.stubEnv('INBOX_FAKE', '1');
    vi.stubEnv('RATE_LIMIT_DISABLED', 'true');
    resetFakeProvider();
  });
  afterEach(() => vi.unstubAllEnvs());

  it('un sticker recibido queda "sticker"; se importa y se manda como sticker', async () => {
    const u = await makeUser('stk-inbox');
    const { account } = await connectWhatsapp(u.id);
    await getDb().prepare("UPDATE inbox_accounts SET status = 'connected' WHERE id = ?").run(account.id);
    const fake = (globalThis as unknown as { __groupsFake: Map<string, { connectedAt: number | null }> }).__groupsFake.get(`inbox-${account.id}`);
    if (fake) fake.connectedAt = Date.now() - 5000;
    const live = { ...account, status: 'connected' as const };
    const chatId = '5491155550002@s.whatsapp.net';
    const ref = { providerMessageId: 'astk-9', chatId, fromMe: false };
    await ingestWhatsappEvents(live, [
      { type: 'message', chatId, isGroup: false, fromMe: false, senderPhone: '5491155550002', senderName: 'Ana', providerMessageId: 'astk-9', body: '', timestamp: new Date().toISOString(), media: { url: '', type: 'image/webp', name: '', fetchRef: ref, info: { kind: 'sticker', animated: true } } },
    ]);
    const [t] = await listThreads(u.id);
    expect(t.lastKind).toBe('sticker');
    const page = await listInboxMessages(u.id, t.id);
    expect(page.messages[0]).toMatchObject({ mediaType: 'sticker', hasMedia: true });
    expect(page.messages[0].meta).toMatchObject({ animated: true });

    const owner = inboxStickerOwner(u.id);
    const r = await syncStickers(owner, inboxStickerSource(u.id), { limit: 10 });
    expect(r.added).toBe(1);
    const [s] = await listStickers(owner);
    expect(s.animated).toBe(true);

    const key = `inbox-${account.id}`;
    const before = fakeSent(key).length;
    await sendInboxSticker(u.id, t.id, s.id, { clientId: 'cid-stk-1' });
    expect(fakeSent(key).length).toBe(before + 1);
    expect(fakeSent(key).at(-1)).toMatchObject({ kind: 'media', text: 'sticker.webp' });
    const after = await listInboxMessages(u.id, t.id);
    expect(after.messages.at(-1)).toMatchObject({ fromMe: true, mediaType: 'sticker' });
    expect((await listStickers(owner))[0].usedAt).toBeTruthy();
  });

  it('Evolution: un sticker de la colección sale por sendSticker con los bytes', async () => {
    const calls: Array<{ url: string; body: Record<string, unknown> }> = [];
    const f: FetchLike = async (url, init) => {
      calls.push({ url, body: JSON.parse(String(init?.body ?? '{}')) });
      return new Response(JSON.stringify({ key: { id: 'BAE1' } }), { status: 201 });
    };
    const p = evolutionProvider({ baseUrl: 'https://evo.example.com', apiKey: 'k', session: 'acme' }, { fetch: f });
    const b64 = FAKE_STICKER_WEBP.toString('base64');
    await p.sendMedia('549@s.whatsapp.net', { url: '', mimetype: 'image/webp', filename: 'sticker.webp', kind: 'sticker', base64: b64, replyTo: 'Q1' });
    expect(calls[0].url).toBe('https://evo.example.com/message/sendSticker/acme');
    expect(calls[0].body).toEqual({ number: '549@s.whatsapp.net', sticker: b64, quoted: { key: { id: 'Q1' } } });
  });
});
