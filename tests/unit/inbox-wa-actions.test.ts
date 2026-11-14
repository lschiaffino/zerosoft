/**
 * Inbox con la cara de WhatsApp: acciones sobre mensajes (responder citando,
 * reaccionar, editar, borrar, destacar, reenviar), archivos y notas de voz,
 * y las tildes azules al abrir. Con el WhatsApp falso; datos inventados.
 */
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { getDb } from '@/lib/db';
import { listMessages, listThreads, upsertThread, type AccountRow } from '@/lib/inbox/core';
import { connectWhatsapp, ingestWhatsappEvents } from '@/lib/inbox/whatsapp';
import { deleteForEveryone, editOwnMessage, forwardMessage, hideMessage, markChatReadOnWhatsapp, reactToMessage, sendWaMessage, sendWaReply, starMessage } from '@/lib/inbox/wa-actions';
import { linkPreviewOf } from '@/lib/groups-provider-bridge';
import { isInboxBlobUrl, sendWhatsappMedia } from '@/lib/inbox/wa-media';
import { fakeSent } from '@/lib/groups-provider-fake';
import { getThreadRow } from '@/lib/inbox/core';
import { setBlocked, sharedContent, waDetails } from '@/lib/inbox/wa-meta';
import { makeSummary, readSummary } from '@/lib/inbox/wa-summary';
import { swipeAndHold } from '@/components/inbox/wa/gestures';
import { withMentions } from '@/components/inbox/wa/util';
import { makeUser } from './helpers';

beforeEach(() => {
  vi.stubEnv('GROUPS_FAKE', '1');
});
afterEach(() => {
  vi.unstubAllEnvs();
});

let owner = '';
let account: AccountRow;

beforeAll(async () => {
  vi.stubEnv('GROUPS_FAKE', '1');
  const u = await makeUser('ibwa-act');
  owner = u.id;
  account = (await connectWhatsapp(u.id)).account;
  await getDb().prepare("UPDATE inbox_accounts SET status = 'connected' WHERE id = ?").run(account.id);
  account = { ...account, status: 'connected' };
  // El proveedor falso tarda 1,5 s en "escanear".
  await new Promise((r) => setTimeout(r, 1600));
});

async function chatWith(phone: string, body: string) {
  const id = `in-${Math.random().toString(36).slice(2)}`;
  await ingestWhatsappEvents(account, [
    { type: 'message', chatId: `${phone}@s.whatsapp.net`, isGroup: false, fromMe: false, senderPhone: phone, senderName: 'Ana Prueba', providerMessageId: id, body, timestamp: new Date().toISOString() },
  ]);
  const th = (await listThreads(owner, { view: 'whatsapp' })).find((t) => t.handle === phone)!;
  const msg = (await listMessages(owner, th.id)).messages.find((m) => m.body === body)!;
  return { th, msg };
}

const sent = () => fakeSent(`inbox-${account.id}`);

describe('acciones de mensaje', () => {
  it('responder citando: sale con la cita y queda guardada', async () => {
    const { th, msg } = await chatWith('15550002001', '¿Venís?');
    await sendWaReply(owner, th.id, 'Sí, a las 9', msg.id);
    const out = (await listMessages(owner, th.id)).messages.at(-1)!;
    expect(out).toMatchObject({ fromMe: true, body: 'Sí, a las 9' });
    expect(out.reply).toMatchObject({ id: msg.id, body: '¿Venís?' });
    expect(sent().at(-1)).toMatchObject({ kind: 'text', text: 'Sí, a las 9' });
    // No se puede citar un mensaje de otro chat.
    const other = await chatWith('15550002002', 'otro');
    await expect(sendWaReply(owner, other.th.id, 'x', msg.id)).rejects.toMatchObject({ code: 'not_found' });
  });

  it('reaccionar, cambiar y sacar la reacción propia', async () => {
    const { th, msg } = await chatWith('15550002003', 'Llegué');
    await reactToMessage(owner, msg.id, '👍');
    await reactToMessage(owner, msg.id, '❤️');
    let m = (await listMessages(owner, th.id)).messages.find((x) => x.id === msg.id)!;
    expect(m.reactions).toEqual([{ emoji: '❤️', by: 'me', name: '' }]);
    await reactToMessage(owner, msg.id, '');
    m = (await listMessages(owner, th.id)).messages.find((x) => x.id === msg.id)!;
    expect(m.reactions).toEqual([]);
    expect(sent().filter((s) => s.kind === 'reaction').map((s) => s.text).slice(-3)).toEqual(['👍', '❤️', '']);
  });

  it('editar solo lo propio y dentro de los 15 minutos; borrar para todos solo lo propio', async () => {
    const { th, msg } = await chatWith('15550002004', 'hola');
    await sendWaReply(owner, th.id, 'Te llamo mñn', msg.id);
    const mine = (await listMessages(owner, th.id)).messages.at(-1)!;
    await expect(editOwnMessage(owner, msg.id, 'cambio')).rejects.toMatchObject({ code: 'forbidden' });
    await editOwnMessage(owner, mine.id, 'Te llamo mañana');
    let page = await listMessages(owner, th.id);
    expect(page.messages.at(-1)).toMatchObject({ body: 'Te llamo mañana', edited: true });
    expect((await listThreads(owner, { view: 'whatsapp' })).find((t) => t.id === th.id)!.preview).toBe('Te llamo mañana');
    await expect(editOwnMessage(owner, mine.id, 'tarde', new Date(Date.now() + 20 * 60_000))).rejects.toMatchObject({ code: 'edit_window' });
    await expect(deleteForEveryone(owner, msg.id)).rejects.toMatchObject({ code: 'forbidden' });
    await deleteForEveryone(owner, mine.id);
    page = await listMessages(owner, th.id);
    expect(page.messages.at(-1)).toMatchObject({ revoked: true, body: 'Te llamo mañana' });
  });

  it('destacar, borrar para mí y reenviar (texto) a otros chats', async () => {
    const { th, msg } = await chatWith('15550002005', 'La clave del wifi es pruebas123');
    await starMessage(owner, msg.id, true);
    expect((await listMessages(owner, th.id)).messages.find((x) => x.id === msg.id)!.starred).toBe(true);
    const target = await chatWith('15550002006', 'hola');
    const done = await forwardMessage(owner, msg.id, [target.th.id, th.id]);
    expect(done).toEqual({ sent: [target.th.id, th.id], failed: [] });
    expect((await listMessages(owner, target.th.id)).messages.at(-1)).toMatchObject({ fromMe: true, body: 'La clave del wifi es pruebas123', forwarded: true });
    await hideMessage(owner, msg.id);
    expect((await listMessages(owner, th.id)).messages.some((x) => x.id === msg.id)).toBe(false);
    // Una persona no toca mensajes de otra.
    const stranger = await makeUser('ibwa-act-other');
    await expect(starMessage(stranger.id, target.msg.id, true)).rejects.toMatchObject({ code: 'not_found' });
    await expect(reactToMessage(stranger.id, target.msg.id, '👍')).rejects.toMatchObject({ code: 'not_found' });
  });

  it('reenviar una nota de voz: sale como nota de voz (base64), con su duración y su onda, marcada "Reenviado"', async () => {
    const phone = '15550002031';
    const src = `aud-fw-${Math.random().toString(36).slice(2)}`;
    const waveform = Array.from({ length: 64 }, (_, i) => (i * 7) % 100);
    await ingestWhatsappEvents(account, [
      {
        type: 'message',
        chatId: `${phone}@s.whatsapp.net`,
        isGroup: false,
        fromMe: false,
        senderPhone: phone,
        senderName: 'Ana Prueba',
        providerMessageId: src,
        body: '',
        media: { url: '', type: 'audio/ogg; codecs=opus', name: '', fetchRef: { providerMessageId: src, chatId: `${phone}@s.whatsapp.net`, fromMe: false }, info: { kind: 'voice', ptt: true, duration: 12, waveform } },
        timestamp: new Date().toISOString(),
      },
    ]);
    const th = (await listThreads(owner, { view: 'whatsapp' })).find((t) => t.handle === phone)!;
    const voice = (await listMessages(owner, th.id)).messages.find((m) => m.mediaType === 'audio')!;
    const a = await chatWith('15550002032', 'hola');
    const b = await chatWith('15550002033', 'hola');
    const before = sent().length;
    const done = await forwardMessage(owner, voice.id, [a.th.id, 'no-existe', b.th.id]);
    expect(done.sent).toEqual([a.th.id, b.th.id]);
    expect(done.failed).toEqual([{ id: 'no-existe', error: 'not_found' }]);
    const out = sent().slice(before);
    expect(out.map((s) => [s.chatId, s.kind, s.media?.kind, s.media?.base64])).toEqual([
      ['15550002032@s.whatsapp.net', 'media', 'voice', true],
      ['15550002033@s.whatsapp.net', 'media', 'voice', true],
    ]);
    const copy = (await listMessages(owner, a.th.id)).messages.at(-1)!;
    expect(copy).toMatchObject({ fromMe: true, forwarded: true, mediaType: 'audio', body: '' });
    expect(copy.meta).toMatchObject({ ptt: true, duration: 12, waveform });
  });

  it('reenviar una foto con comentario y un documento; "ver una vez" no se reenvía', async () => {
    const phone = '15550002034';
    const tag = Math.random().toString(36).slice(2);
    const ref = (id: string) => ({ providerMessageId: id, chatId: `${phone}@s.whatsapp.net`, fromMe: false });
    const base = { type: 'message' as const, chatId: `${phone}@s.whatsapp.net`, isGroup: false, fromMe: false, senderPhone: phone, senderName: 'Ana Prueba', timestamp: new Date().toISOString() };
    await ingestWhatsappEvents(account, [
      { ...base, providerMessageId: `img-${tag}`, body: 'La terraza', media: { url: '', type: 'image/jpeg', name: '', fetchRef: ref(`img-${tag}`), info: { kind: 'image', width: 480, height: 320 } } },
      { ...base, providerMessageId: `doc-${tag}`, body: '', media: { url: '', type: 'application/pdf', name: 'Factura.pdf', fetchRef: ref(`doc-${tag}`), info: { kind: 'document', pages: 2 } } },
      { ...base, providerMessageId: `vo-${tag}`, body: '', media: { url: '', type: 'image/jpeg', name: '', fetchRef: ref(`vo-${tag}`), info: { kind: 'image', viewOnce: true } } },
    ]);
    const th = (await listThreads(owner, { view: 'whatsapp' })).find((t) => t.handle === phone)!;
    const msgs = (await listMessages(owner, th.id)).messages;
    const target = await chatWith('15550002035', 'hola');
    const before = sent().length;
    await forwardMessage(owner, msgs.find((m) => m.body === 'La terraza')!.id, [target.th.id]);
    await forwardMessage(owner, msgs.find((m) => m.mediaName === 'Factura.pdf')!.id, [target.th.id]);
    expect(sent().slice(before).map((s) => [s.kind, s.text, s.media?.kind])).toEqual([
      ['media', 'La terraza', 'image'],
      ['media', 'Factura.pdf', 'document'],
    ]);
    const copies = (await listMessages(owner, target.th.id)).messages.slice(-2);
    expect(copies[0]).toMatchObject({ forwarded: true, mediaType: 'image', body: 'La terraza' });
    expect(copies[0].meta).toMatchObject({ width: 480, height: 320 });
    expect(copies[1]).toMatchObject({ forwarded: true, mediaType: 'document', mediaName: 'Factura.pdf' });
    const once = msgs.find((m) => m.meta?.viewOnce)!;
    await expect(forwardMessage(owner, once.id, [target.th.id])).rejects.toMatchObject({ code: 'unsupported' });
  });

  it('abrir el chat manda las tildes azules de lo recibido', async () => {
    const { th } = await chatWith('15550002007', 'Avisame');
    await markChatReadOnWhatsapp(owner, th.id);
    expect(sent().at(-1)).toMatchObject({ kind: 'read', chatId: '15550002007@s.whatsapp.net' });
  });
});

describe('archivos y notas de voz', () => {
  it('una foto con comentario y una nota de voz: salen y quedan para mostrar', async () => {
    const { th, msg } = await chatWith('15550002008', 'mandame la foto');
    await sendWhatsappMedia(owner, th.id, { data: Buffer.from([0x89, 0x50, 0x4e, 0x47]), mimetype: 'image/png', filename: 'casa.png', size: 4, caption: 'Así quedó', replyTo: msg.id });
    await sendWhatsappMedia(owner, th.id, { data: Buffer.from('OggS'), mimetype: 'audio/webm', filename: 'voice.webm', size: 4, kind: 'voice', duration: 7 });
    const page = await listMessages(owner, th.id);
    const [photo, voice] = page.messages.slice(-2);
    expect(photo).toMatchObject({ fromMe: true, mediaType: 'image', body: 'Así quedó', hasMedia: true });
    expect(photo.reply).toMatchObject({ id: msg.id });
    expect(voice).toMatchObject({ fromMe: true, mediaType: 'audio', body: '', hasMedia: true });
    expect(voice.meta).toMatchObject({ ptt: true, duration: 7 });
    const [th2] = (await listThreads(owner, { view: 'whatsapp' })).filter((t) => t.id === th.id);
    expect(th2.lastKind).toBe('voice');
    expect(sent().slice(-2).map((s) => s.kind)).toEqual(['media', 'media']);
  });

  it('solo URLs de Blob de Inbox; nada de otros hosts', async () => {
    expect(isInboxBlobUrl('https://abc.public.blob.vercel-storage.com/inbox/123e4567-e89b-12d3-a456-426614174000-foto.jpg')).toBe(true);
    expect(isInboxBlobUrl('https://abc.public.blob.vercel-storage.com/chat/123e4567-e89b-12d3-a456-426614174000-foto.jpg')).toBe(false);
    expect(isInboxBlobUrl('https://evil.example.test/inbox/123e4567-e89b-12d3-a456-426614174000-foto.jpg')).toBe(false);
    const t = await upsertThread(account, { externalId: '15550002009@s.whatsapp.net', kind: 'dm', handle: '15550002009' });
    await expect(sendWhatsappMedia(owner, t.id, { url: 'https://evil.example.test/x.jpg', mimetype: 'image/jpeg', filename: 'x.jpg', size: 10 })).rejects.toMatchObject({ code: 'invalid_input' });
    await expect(sendWhatsappMedia(owner, t.id, { data: Buffer.alloc(5 * 1024 * 1024), mimetype: 'image/jpeg', filename: 'big.jpg', size: 5 * 1024 * 1024 })).rejects.toMatchObject({ code: 'file_too_large' });
  });
});

describe('info del contacto y del grupo', () => {
  it('lo compartido (fotos, documentos, links, destacados), grupos en común, bloquear y el resumen', async () => {
    vi.stubEnv('INBOX_FAKE', '1');
    const phone = '15550002010';
    const { th, msg } = await chatWith(phone, 'Mirá https://example.test/receta y www.otra.test');
    await sendWhatsappMedia(owner, th.id, { data: Buffer.from([1, 2, 3]), mimetype: 'application/pdf', filename: 'menu.pdf', size: 3 });
    await sendWhatsappMedia(owner, th.id, { data: Buffer.from([0x89, 0x50]), mimetype: 'image/png', filename: 'a.png', size: 2 });
    await starMessage(owner, msg.id, true);
    const links = await sharedContent(owner, th.id, 'links');
    expect(links[0].urls).toEqual(['https://example.test/receta']);
    expect((await sharedContent(owner, th.id, 'docs')).map((d) => d.mediaName)).toEqual(['menu.pdf']);
    expect((await sharedContent(owner, th.id, 'media')).map((d) => d.mediaType)).toEqual(['image']);
    expect((await sharedContent(owner, th.id, 'starred')).map((d) => d.id)).toEqual([msg.id]);

    // Un grupo con esa persona entre los participantes: aparece en común.
    const g = await upsertThread(account, { externalId: '120363000000099001@g.us', kind: 'group', title: 'Cocina' });
    await getDb().prepare('UPDATE inbox_threads SET info = ? WHERE id = ?').run(JSON.stringify({ about: '', participants: [{ phone, role: 'member' }], size: 2 }), g.id);
    const row = await getThreadRow(owner, th.id);
    let wa = await waDetails(owner, row, account);
    expect(wa.commonGroups).toEqual([{ id: g.id, title: 'Cocina', avatar: '' }]);

    await setBlocked(owner, th.id, true);
    wa = await waDetails(owner, await getThreadRow(owner, th.id), account);
    expect(wa.blocked).toBe(true);
    expect(sent().at(-1)).toMatchObject({ kind: 'block', text: 'block' });
    await expect(setBlocked(owner, g.id, true)).rejects.toMatchObject({ code: 'unsupported' });

    const s = await makeSummary(owner, th.id);
    expect(s.text).toMatch(/mensajes/);
    expect(await readSummary(owner, th.id)).toMatchObject({ text: s.text, stale: false });
    // El mensaje siguiente tiene que ser de un milisegundo posterior: en el mismo, el resumen no se ve viejo.
    while (Date.now() <= Date.parse(s.at!)) await new Promise((done) => setTimeout(done, 1));
    await chatWith(phone, 'otro mensaje después');
    expect((await readSummary(owner, th.id)).stale).toBe(true);
    const stranger = await makeUser('ibwa-sum-other');
    await expect(makeSummary(stranger.id, th.id)).rejects.toMatchObject({ code: 'not_found' });
  });
});

describe('menciones y vista previa de links', () => {
  it('en un grupo, las menciones salen con los teléfonos escritos en el texto', async () => {
    const gid = '120363000000099002@g.us';
    await ingestWhatsappEvents(account, [
      { type: 'message', chatId: gid, isGroup: true, chatName: 'Club', fromMe: false, senderPhone: '15550002011', senderName: 'Eva', providerMessageId: 'mg-1', body: 'hola', timestamp: new Date().toISOString() },
    ]);
    const th = (await listThreads(owner, { view: 'groups' })).find((t) => t.title === 'Club')!;
    await sendWaMessage(owner, th.id, 'Hola @15550002011, ¿venís?', { mentions: ['15550002011', '15550009999'] });
    const out = (await listMessages(owner, th.id)).messages.at(-1)!;
    expect(out.body).toBe('Hola @15550002011, ¿venís?');
    // En un 1:1 no hay menciones (se ignoran).
    const { th: dm } = await chatWith('15550002012', 'hola');
    await sendWaMessage(owner, dm.id, 'Hola @15550002011', { mentions: ['15550002011'] });
    expect((await listMessages(owner, dm.id)).messages.at(-1)!.body).toBe('Hola @15550002011');
  });

  it('la vista previa del link que manda el teléfono queda en el mensaje', async () => {
    const ext = { text: 'Mirá https://example.test/nota', matchedText: 'https://example.test/nota', title: 'Una nota de prueba', description: 'Bajada', jpegThumbnail: 'AAAA' };
    expect(linkPreviewOf(ext)).toEqual({ url: 'https://example.test/nota', title: 'Una nota de prueba', description: 'Bajada', thumbnail: 'data:image/jpeg;base64,AAAA' });
    expect(linkPreviewOf({ ...ext, matchedText: 'javascript:alert(1)', canonicalUrl: undefined })).toBeUndefined();
    expect(linkPreviewOf({ text: 'sin título', matchedText: 'https://example.test' })).toBeUndefined();
    await ingestWhatsappEvents(account, [
      { type: 'message', chatId: '15550002013@s.whatsapp.net', isGroup: false, fromMe: false, senderPhone: '15550002013', senderName: 'Leo', providerMessageId: 'lk-1', body: ext.text, link: linkPreviewOf(ext), timestamp: new Date().toISOString() },
    ]);
    const th = (await listThreads(owner, { view: 'whatsapp' })).find((t) => t.handle === '15550002013')!;
    expect((await listMessages(owner, th.id)).messages.at(-1)!.meta?.link).toMatchObject({ url: 'https://example.test/nota', title: 'Una nota de prueba' });
  });
});

describe('detalles de la pantalla', () => {
  it('menciones: "@5491..." pasa a "@Nombre" cuando se conoce', () => {
    const names = new Map([['5491155550000', 'Ana']]);
    expect(withMentions('Hola @5491155550000 y @5491166660000', names)).toBe('Hola @Ana y @5491166660000');
  });

  it('deslizar a la derecha responde; con el mouse no hace nada', () => {
    const onSwipe = vi.fn();
    const g = swipeAndHold({ onSwipe });
    const el = { style: {} as Record<string, string>, setAttribute: vi.fn(), removeAttribute: vi.fn() } as unknown as HTMLElement;
    const ev = (x: number, type = 'touch') => ({ pointerType: type, clientX: x, clientY: 100, currentTarget: el }) as never;
    g.onPointerDown(ev(10, 'mouse'));
    g.onPointerMove(ev(120, 'mouse'));
    g.onPointerUp(ev(120, 'mouse'));
    expect(onSwipe).not.toHaveBeenCalled();
    g.onPointerDown(ev(10));
    g.onPointerMove(ev(30));
    g.onPointerMove(ev(100));
    g.onPointerUp(ev(100));
    expect(onSwipe).toHaveBeenCalledTimes(1);
  });
});
