import { mkdirSync, mkdtempSync, writeFileSync } from 'fs';
import os from 'os';
import path from 'path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { getDb } from '@/lib/db';
import { createNumber, getNumberRowById, ingestEvents, listChats, listMessages, sendMessage, upsertChat } from '@/lib/groups';
import { evolutionProvider, parseEvolutionWebhook } from '@/lib/groups-provider-bridge';
import { loadSampleData } from '@/lib/groups-sample';
import {
  evolutionFileName,
  imageSize,
  infoFromBaileys,
  jsonBytes,
  parseVcard,
  planOutboundKind,
  thumbnailFrom,
  WA_MEDIA_LIMITS,
} from '@/lib/groups-media';
import { mediaFromBody } from '@/lib/groups-media-input';
import { previewToken } from '@/lib/groups-rules';
import type { FetchLike, InboundEvent } from '@/lib/groups-provider';
import { makeUser } from './helpers';

/**
 * Media de WhatsApp en Groups contra Evolution API 2.3.7: qué endpoint y qué
 * cuerpo sale por cada tipo (sendMedia, sendWhatsAppAudio, sendSticker), los
 * topes, y lo que se lee de cada mensaje recibido (imagen, video, audio, nota
 * de voz, documento, sticker, ubicación, contacto, "ver una vez"), también lo
 * que se manda desde el teléfono (fromMe).
 */

const MB = 1024 * 1024;
// 1x1 PNG.
const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==', 'base64');
// JPEG mínimo con un SOF0 de 640x480.
const JPEG = Buffer.from([
  0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46, 0x00, 0x01, 0x01, 0x00, 0x00, 0x01, 0x00, 0x01, 0x00, 0x00,
  0xff, 0xc0, 0x00, 0x11, 0x08, 0x01, 0xe0, 0x02, 0x80, 0x03, 0x01, 0x22, 0x00, 0x02, 0x11, 0x01, 0x03, 0x11, 0x01, 0xff, 0xd9,
]);

describe('qué tipo de mensaje sale de cada archivo', () => {
  it('imagen, video, audio y documento según el mimetype', () => {
    expect(planOutboundKind('image/png', 1000)).toBe('image');
    expect(planOutboundKind('image/jpeg', undefined)).toBe('image');
    expect(planOutboundKind('video/mp4', 10 * MB)).toBe('video');
    expect(planOutboundKind('audio/mpeg', 3 * MB)).toBe('audio');
    expect(planOutboundKind('audio/ogg; codecs=opus', 1000)).toBe('audio');
    expect(planOutboundKind('application/pdf', 50 * MB)).toBe('document');
  });

  it('lo que WhatsApp no reproduce va como documento', () => {
    expect(planOutboundKind('image/heic', 1000)).toBe('document');
    expect(planOutboundKind('video/quicktime', 1000)).toBe('document');
    expect(planOutboundKind('video/webm', 1000)).toBe('document');
    expect(planOutboundKind('audio/webm', 1000)).toBe('document');
    expect(planOutboundKind('audio/wav', 1000)).toBe('document');
  });

  it('pasar el tope del tipo lo baja a documento; pasar 100 MB es un error', () => {
    expect(planOutboundKind('image/jpeg', WA_MEDIA_LIMITS.image + 1)).toBe('document');
    expect(planOutboundKind('video/mp4', 17 * MB)).toBe('document');
    expect(() => planOutboundKind('application/pdf', 101 * MB)).toThrow('media_too_large');
    expect(() => planOutboundKind('video/mp4', 101 * MB)).toThrow('media_too_large');
  });

  it('nota de voz: cualquier audio (Evolution convierte), hasta 16 MB', () => {
    expect(planOutboundKind('audio/webm;codecs=opus', 200_000, 'voice')).toBe('voice');
    expect(planOutboundKind('audio/mp4', 200_000, 'voice')).toBe('voice');
    expect(planOutboundKind('video/webm', 200_000, 'voice')).toBe('voice');
    expect(() => planOutboundKind('audio/webm', 17 * MB, 'voice')).toThrow('media_too_large');
    expect(() => planOutboundKind('application/pdf', 100, 'voice')).toThrow('invalid_media');
  });

  it('sticker hasta 500 KB (si no, imagen); "document" fuerza archivo', () => {
    expect(planOutboundKind('image/webp', 30_000, 'sticker')).toBe('sticker');
    expect(planOutboundKind('image/webp', 600_000, 'sticker')).toBe('image');
    expect(planOutboundKind('image/png', 1000, 'document')).toBe('document');
  });

  it('el nombre que va a Evolution tiene la extensión que coincide (Evolution saca el mimetype del nombre)', () => {
    expect(evolutionFileName('foto.png', 'image/png', 'image')).toBe('foto.jpg');
    expect(evolutionFileName('clip', 'video/mp4', 'video')).toBe('clip.mp4');
    expect(evolutionFileName('Factura marzo.pdf', 'application/pdf', 'document')).toBe('Factura marzo.pdf');
    expect(evolutionFileName('notas', 'text/plain', 'document')).toBe('notas.txt');
    expect(evolutionFileName('a/b\\c.pdf', 'application/pdf', 'document')).toBe('a_b_c.pdf');
  });
});

describe('cuerpo de cada envío a Evolution (2.3.7)', () => {
  function evo() {
    const calls: Array<{ url: string; body: Record<string, unknown> }> = [];
    const f: FetchLike = async (url, init) => {
      calls.push({ url, body: JSON.parse(String(init?.body ?? '{}')) });
      return new Response(JSON.stringify({ key: { id: `BAE${calls.length}` } }), { status: 201 });
    };
    return { p: evolutionProvider({ baseUrl: 'https://evo.example.com', apiKey: 'k', session: 'acme' }, { fetch: f }), calls };
  }
  const url = 'https://store.public.blob.vercel-storage.com/chat/x.png';

  it('imagen con texto: sendMedia, mediatype image, JPEG (Evolution la convierte)', async () => {
    const { p, calls } = evo();
    expect((await p.sendMedia('123@g.us', { url, mimetype: 'image/png', filename: 'x.png', caption: 'mirá', kind: 'image' })).id).toBe('BAE1');
    expect(calls[0].url).toBe('https://evo.example.com/message/sendMedia/acme');
    expect(calls[0].body).toEqual({ number: '123@g.us', mediatype: 'image', mimetype: 'image/jpeg', media: url, fileName: 'x.jpg', caption: 'mirá' });
  });

  it('video con texto y respuesta citada', async () => {
    const { p, calls } = evo();
    await p.sendMedia('549@s.whatsapp.net', { url, mimetype: 'video/mp4', filename: 'demo.mp4', caption: 'el demo', kind: 'video', replyTo: 'ABC' });
    expect(calls[0].body).toEqual({
      number: '549@s.whatsapp.net',
      mediatype: 'video',
      mimetype: 'video/mp4',
      media: url,
      fileName: 'demo.mp4',
      caption: 'el demo',
      quoted: { key: { id: 'ABC' } },
    });
  });

  it('documento: nombre original y texto', async () => {
    const { p, calls } = evo();
    await p.sendMedia('549@s.whatsapp.net', { url, mimetype: 'application/pdf', filename: 'Contrato 2026.pdf', caption: 'firmado', kind: 'document' });
    expect(calls[0].body).toMatchObject({ mediatype: 'document', mimetype: 'application/pdf', fileName: 'Contrato 2026.pdf', caption: 'firmado' });
  });

  it('audio: sendMedia sin texto (WhatsApp no lo muestra)', async () => {
    const { p, calls } = evo();
    await p.sendMedia('549@s.whatsapp.net', { url, mimetype: 'audio/mpeg', filename: 'tema.mp3', caption: 'x', kind: 'audio' });
    expect(calls[0].body).toEqual({ number: '549@s.whatsapp.net', mediatype: 'audio', mimetype: 'audio/mpeg', media: url, fileName: 'tema.mp3' });
  });

  it('nota de voz: sendWhatsAppAudio con encoding (OGG/Opus convertido por Evolution, sirve el webm del navegador)', async () => {
    const { p, calls } = evo();
    await p.sendMedia('549@s.whatsapp.net', { url, mimetype: 'audio/webm;codecs=opus', filename: 'voice.weba', kind: 'voice' });
    expect(calls[0].url).toBe('https://evo.example.com/message/sendWhatsAppAudio/acme');
    expect(calls[0].body).toEqual({ number: '549@s.whatsapp.net', audio: url, encoding: true });
  });

  it('sticker: sendSticker', async () => {
    const { p, calls } = evo();
    await p.sendMedia('549@s.whatsapp.net', { url, mimetype: 'image/webp', filename: 's.webp', kind: 'sticker' });
    expect(calls[0].url).toBe('https://evo.example.com/message/sendSticker/acme');
    expect(calls[0].body).toEqual({ number: '549@s.whatsapp.net', sticker: url });
  });

  it('base64 en vez de URL cuando viene (subidas locales)', async () => {
    const { p, calls } = evo();
    await p.sendMedia('549@s.whatsapp.net', { url: 'http://localhost:3000/uploads/chat/a.pdf', mimetype: 'application/pdf', filename: 'a.pdf', base64: 'QUJD', kind: 'document' });
    await p.sendMedia('549@s.whatsapp.net', { url: 'http://localhost:3000/uploads/chat/v.weba', mimetype: 'audio/webm', filename: 'v.weba', base64: 'QUJD', kind: 'voice' });
    expect(calls[0].body.media).toBe('QUJD');
    expect(calls[1].body.audio).toBe('QUJD');
  });

  it('sin kind sale del mimetype; sin id en la respuesta es un error', async () => {
    const { p, calls } = evo();
    await p.sendMedia('549@s.whatsapp.net', { url, mimetype: 'application/pdf', filename: 'a.pdf' });
    expect(calls[0].body.mediatype).toBe('document');
    const bad = evolutionProvider({ baseUrl: 'https://evo.example.com', apiKey: 'k', session: 'acme' }, { fetch: async () => new Response('{}', { status: 201 }) });
    await expect(bad.sendMedia('549@s.whatsapp.net', { url, mimetype: 'image/png', filename: 'x.png' })).rejects.toMatchObject({ code: 'provider_error' });
  });
});

describe('mensajes recibidos de Evolution, por tipo', () => {
  const upsert = (message: Record<string, unknown>, extra: Record<string, unknown> = {}) =>
    parseEvolutionWebhook({
      event: 'messages.upsert',
      instance: 's',
      data: { key: { remoteJid: '5491155550000@s.whatsapp.net', fromMe: false, id: 'M1', ...extra }, pushName: 'Ana', message },
    })[0] as Extract<InboundEvent, { type: 'message' }>;
  const thumb = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 1, 2, 3, 4]);

  it('imagen: medidas, tamaño y miniatura (base64, Buffer o Uint8Array serializado)', () => {
    const ev = upsert({ imageMessage: { mimetype: 'image/jpeg', caption: 'foto', fileLength: '2048', width: 1280, height: 960, jpegThumbnail: thumb.toString('base64') } });
    expect(ev.body).toBe('foto');
    expect(ev.media).toMatchObject({ url: 'evo:M1', type: 'image/jpeg', fetchRef: { providerMessageId: 'M1', fromMe: false } });
    expect(ev.media?.info).toEqual({ kind: 'image', size: 2048, mimetype: 'image/jpeg', width: 1280, height: 960, thumbnail: `data:image/jpeg;base64,${thumb.toString('base64')}` });
    const asObject = Object.fromEntries([...thumb].map((b, i) => [String(i), b]));
    expect(thumbnailFrom(asObject)).toBe(`data:image/jpeg;base64,${thumb.toString('base64')}`);
    expect(thumbnailFrom({ type: 'Buffer', data: [...thumb] })).toBe(`data:image/jpeg;base64,${thumb.toString('base64')}`);
    // Algo que no es un JPEG no se guarda como miniatura.
    expect(thumbnailFrom(Buffer.from('<svg/>').toString('base64'))).toBeUndefined();
    expect(jsonBytes('x'.repeat(100_000), 16 * 1024)).toBeNull();
  });

  it('video con duración', () => {
    const ev = upsert({ videoMessage: { mimetype: 'video/mp4', seconds: 42, fileLength: { low: 5000, high: 0 }, width: 720, height: 1280 } });
    expect(ev.media?.info).toMatchObject({ kind: 'video', duration: 42, size: 5000, width: 720, height: 1280 });
  });

  it('nota de voz (ptt) vs audio', () => {
    const voice = upsert({ audioMessage: { mimetype: 'audio/ogg; codecs=opus', ptt: true, seconds: 7, fileLength: 12000 } });
    expect(voice.media).toMatchObject({ url: 'evo:M1', type: 'audio/ogg; codecs=opus' });
    expect(voice.media?.info).toEqual({ kind: 'voice', ptt: true, duration: 7, size: 12000, mimetype: 'audio/ogg; codecs=opus' });
    const song = upsert({ audioMessage: { mimetype: 'audio/mpeg', seconds: 180 } });
    expect(song.media?.info).toMatchObject({ kind: 'audio', duration: 180 });
    expect(song.media?.info?.ptt).toBeUndefined();
  });

  it('documento: nombre, tamaño y páginas; también con texto (documentWithCaptionMessage)', () => {
    const doc = upsert({ documentMessage: { mimetype: 'application/pdf', fileName: 'Factura.pdf', fileLength: 34567, pageCount: 3, jpegThumbnail: [...thumb] } });
    expect(doc.media).toMatchObject({ type: 'application/pdf', name: 'Factura.pdf' });
    expect(doc.media?.info).toMatchObject({ kind: 'document', size: 34567, pages: 3, thumbnail: expect.stringMatching(/^data:image\/jpeg;base64,/) });
    const withCaption = upsert({ documentWithCaptionMessage: { message: { documentMessage: { mimetype: 'application/pdf', fileName: 'Plan.pdf', caption: 'el plan' } } } });
    expect(withCaption).toMatchObject({ body: 'el plan', media: { name: 'Plan.pdf', type: 'application/pdf', url: 'evo:M1' } });
  });

  it('sticker (webp, animado)', () => {
    const ev = upsert({ stickerMessage: { mimetype: 'image/webp', isAnimated: true, width: 512, height: 512 } });
    expect(ev.media).toMatchObject({ type: 'image/webp', url: 'evo:M1' });
    expect(ev.media?.info).toMatchObject({ kind: 'sticker', animated: true, width: 512 });
  });

  it('ubicación y ubicación en tiempo real como datos', () => {
    const loc = upsert({ locationMessage: { degreesLatitude: -34.6037, degreesLongitude: -58.3816, name: 'Obelisco', address: 'Av. 9 de Julio', url: 'https://maps.example.com/x' } });
    expect(loc.media).toBeUndefined();
    expect(loc.location).toEqual({ lat: -34.6037, lng: -58.3816, name: 'Obelisco', address: 'Av. 9 de Julio', url: 'https://maps.example.com/x' });
    const live = upsert({ liveLocationMessage: { degreesLatitude: 1.5, degreesLongitude: 2.5, caption: 'voy llegando' } });
    expect(live.location).toEqual({ lat: 1.5, lng: 2.5, address: 'voy llegando', live: true });
    // Una ubicación sin coordenadas válidas no deja un mensaje vacío en el chat.
    expect(upsert({ locationMessage: { degreesLatitude: 'x', degreesLongitude: 1 } })?.location).toBeUndefined();
  });

  it('contactos como datos (vCard con waid)', () => {
    const vcard = 'BEGIN:VCARD\nVERSION:3.0\nFN:Juan Pérez\nORG:Acme;\nTEL;type=CELL;type=VOICE;waid=5491155551234:+54 9 11 5555-1234\nEMAIL:juan@acme.com\nEND:VCARD';
    const one = upsert({ contactMessage: { displayName: 'Juan', vcard } });
    expect(one.contacts).toEqual([{ name: 'Juan', phones: ['5491155551234'], email: 'juan@acme.com', org: 'Acme' }]);
    const many = upsert({ contactsArrayMessage: { displayName: '2 contactos', contacts: [{ displayName: 'Juan', vcard }, { displayName: 'Sin tel', vcard: 'BEGIN:VCARD\nFN:Sin tel\nEND:VCARD' }] } });
    expect(many.contacts).toHaveLength(2);
    expect(parseVcard('BEGIN:VCARD\nitem1.TEL:+1 (555) 000-1234\nEND:VCARD', 'X')).toEqual({ name: 'X', phones: ['15550001234'] });
  });

  it('"ver una vez": aviso, sin bajar el archivo', () => {
    const ev = upsert({ viewOnceMessageV2: { message: { imageMessage: { mimetype: 'image/jpeg', viewOnce: true, fileLength: 100 } } } });
    expect(ev.media).toMatchObject({ url: '', type: 'image/jpeg' });
    expect(ev.media?.fetchRef).toBeUndefined();
    expect(ev.media?.info).toMatchObject({ kind: 'image', viewOnce: true });
    const empty = upsert({ viewOnceMessageV2: { message: {} } });
    expect(empty.media?.info).toEqual({ kind: 'image', viewOnce: true });
  });

  it('mensajes temporales (ephemeralMessage) se desenvuelven', () => {
    const text = upsert({ ephemeralMessage: { message: { extendedTextMessage: { text: 'se borra en 7 días' } } } });
    expect(text.body).toBe('se borra en 7 días');
    const voice = upsert({ ephemeralMessage: { message: { audioMessage: { mimetype: 'audio/ogg; codecs=opus', ptt: true, seconds: 3 } } } });
    expect(voice.media?.info).toMatchObject({ kind: 'voice', duration: 3 });
  });

  it('lo mandado desde el teléfono (fromMe) también se baja, con fromMe en la key', () => {
    const ev = upsert({ imageMessage: { mimetype: 'image/jpeg' } }, { fromMe: true });
    expect(ev.fromMe).toBe(true);
    expect(ev.media).toMatchObject({ url: 'evo:M1', fetchRef: { providerMessageId: 'M1', chatId: '5491155550000@s.whatsapp.net', fromMe: true } });
  });

  it('más grande que 16 MB: queda el aviso con nombre y tamaño, sin bajar', () => {
    const ev = upsert({ documentMessage: { mimetype: 'application/zip', fileName: 'backup.zip', fileLength: 40 * MB } });
    expect(ev.media).toMatchObject({ url: '', name: 'backup.zip' });
    expect(ev.media?.info?.size).toBe(40 * MB);
  });

  it('infoFromBaileys ignora números raros', () => {
    expect(infoFromBaileys('imageMessage', { width: -1, height: 'x', fileLength: Infinity })).toEqual({ kind: 'image' });
  });
});

describe('medidas de imagen', () => {
  it('PNG, JPEG, GIF y WebP', () => {
    expect(imageSize(PNG)).toEqual({ width: 1, height: 1 });
    expect(imageSize(JPEG)).toEqual({ width: 640, height: 480 });
    const gif = Buffer.from('GIF89a\x20\x00\x10\x00', 'latin1');
    expect(imageSize(gif)).toEqual({ width: 32, height: 16 });
    const webp = Buffer.alloc(30);
    webp.write('RIFF', 0, 'ascii');
    webp.write('WEBPVP8X', 8, 'ascii');
    webp.writeUIntLE(511, 24, 3);
    webp.writeUIntLE(255, 27, 3);
    expect(imageSize(webp)).toEqual({ width: 512, height: 256 });
    expect(imageSize(Buffer.from('hola'))).toBeNull();
  });
});

describe('cuerpo de la ruta y vista previa', () => {
  it('mediaFromBody: tipo pedido, tamaño y medidas; voice: true es nota de voz', () => {
    const req = new Request('http://localhost:3000/api/groups/chats/x/messages');
    vi.stubEnv('NEXTAUTH_URL', '');
    expect(mediaFromBody({ url: '/uploads/chat/a.weba', mimetype: 'audio/webm', filename: 'a.weba', voice: true, size: 1234, duration: 4.4 }, req)).toEqual({
      url: 'http://localhost:3000/uploads/chat/a.weba',
      mimetype: 'audio/webm',
      filename: 'a.weba',
      kind: 'voice',
      size: 1234,
      duration: 4,
    });
    expect(mediaFromBody({ url: 'https://store1.public.blob.vercel-storage.com/chat/a.png', mimetype: 'image/png', filename: 'a.png', kind: 'nope', width: 10, height: 20 }, req)).toEqual({
      url: 'https://store1.public.blob.vercel-storage.com/chat/a.png',
      mimetype: 'image/png',
      filename: 'a.png',
      width: 10,
      height: 20,
    });
    // Una media que vino y no sirve es un 400 (no se manda el texto solo).
    expect(() => mediaFromBody({ url: 'javascript:alert(1)' }, req)).toThrow(expect.objectContaining({ code: 'invalid_media', status: 400 }));
    expect(mediaFromBody(null, req)).toBeNull();
    expect(mediaFromBody(undefined, req)).toBeNull();
    // El proveedor baja la URL desde su red: solo hosts propios, Blob o GROUPS_MEDIA_HOSTS.
    for (const bad of ['https://x.com/a.png', 'https://169.254.169.254/latest/meta-data', 'https://10.0.0.5/a.png', 'https://metadata.google.internal/a', 'https://u:p@localhost/a.png']) {
      expect(() => mediaFromBody({ url: bad, mimetype: 'image/png', filename: 'a.png' }, req), bad).toThrow(expect.objectContaining({ code: 'invalid_media' }));
    }
    expect(mediaFromBody({ url: 'https://localhost:3000/uploads/chat/a.png', mimetype: 'image/png', filename: 'a.png' }, req)?.url).toBe('https://localhost:3000/uploads/chat/a.png');
    vi.stubEnv('GROUPS_MEDIA_HOSTS', 'cdn.example.com');
    expect(mediaFromBody({ url: 'https://cdn.example.com/a.pdf', mimetype: 'application/pdf', filename: 'a.pdf' }, req)?.url).toBe('https://cdn.example.com/a.pdf');
    vi.unstubAllEnvs();
  });

  it('la interfaz traduce los marcadores nuevos', () => {
    for (const t of ['voice', 'sticker', 'location', 'contact', 'viewOnce']) expect(previewToken(`[${t}]`)).toBe(t);
  });
});

describe('mandar y recibir de punta a punta (Evolution)', () => {
  let dir: string;
  beforeEach(() => {
    dir = mkdtempSync(path.join(os.tmpdir(), 'zs-groups-media-'));
    vi.stubEnv('UPLOADS_DIR', dir);
    vi.stubEnv('BLOB_READ_WRITE_TOKEN', '');
    vi.stubEnv('VERCEL', '');
    vi.stubEnv('ALLOW_PRIVATE_WEBHOOKS', 'true');
    vi.stubEnv('NEXTAUTH_URL', 'http://localhost:3000');
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
  });

  async function setup(label: string, respond: (url: string, body: Record<string, unknown>) => Response | null = () => null) {
    const calls: Array<{ url: string; body: Record<string, unknown> }> = [];
    let n = 0;
    vi.stubGlobal('fetch', async (input: string | URL, init: RequestInit = {}) => {
      const url = String(input);
      const body = typeof init.body === 'string' ? (JSON.parse(init.body) as Record<string, unknown>) : {};
      calls.push({ url, body });
      return respond(url, body) ?? new Response(JSON.stringify({ key: { id: `OUT${++n}` } }), { status: 201 });
    });
    const user = await makeUser(label);
    const num = await createNumber(user.id, user.id, { provider: 'evolution', config: { baseUrl: 'https://evo.example.com', apiKey: 'k', session: 's' } });
    const number = (await getNumberRowById(num.id))!;
    const chat = await upsertChat(number, { providerChatId: '5491155550000@s.whatsapp.net', kind: 'dm', name: 'Ana', phone: '5491155550000' });
    return { user, number, chat, calls };
  }

  function localUpload(name: string, data: Buffer): string {
    mkdirSync(path.join(dir, 'chat'), { recursive: true });
    writeFileSync(path.join(dir, 'chat', name), data);
    return `http://localhost:3000/uploads/chat/${name}`;
  }

  it('imagen subida local: va en base64, queda guardada con tipo, nombre, tamaño y medidas, y toma el id', async () => {
    const { user, chat, calls } = await setup('media-img');
    const url = localUpload('11111111-1111-1111-1111-111111111111-foto.png', PNG);
    const msg = await sendMessage(user.id, user.id, chat.id, { body: 'la foto', media: { url, mimetype: 'image/png', filename: 'foto.png', width: 1, height: 1 } });
    const call = calls.find((c) => c.url.endsWith('/message/sendMedia/s'))!;
    expect(call.body).toMatchObject({ mediatype: 'image', media: PNG.toString('base64'), fileName: 'foto.jpg', caption: 'la foto' });
    expect(msg).toMatchObject({ status: 'sent', body: 'la foto', media: { url, type: 'image/png', name: 'foto.png', kind: 'image', size: PNG.length, width: 1, height: 1 } });
    const row = (await getDb().prepare('SELECT provider_message_id FROM groups_messages WHERE id = ?').get(msg.id)) as { provider_message_id: string };
    expect(row.provider_message_id).toBe('OUT1');
    // Las tildes llegan por webhook y se aplican al mensaje.
    const number = (await getNumberRowById(chat.number_id))!;
    await ingestEvents(number, parseEvolutionWebhook({ event: 'messages.update', data: { keyId: 'OUT1', status: 'READ' } }));
    expect((await listMessages(user.id, chat.id))[0].status).toBe('read');
  });

  it('URL de Blob: va la URL (Evolution la baja), no base64', async () => {
    const { user, chat, calls } = await setup('media-blob');
    const url = 'https://store.public.blob.vercel-storage.com/chat/abc-Contrato.pdf';
    const msg = await sendMessage(user.id, user.id, chat.id, { body: 'firmalo', media: { url, mimetype: 'application/pdf', filename: 'Contrato.pdf', size: 2 * MB } });
    expect(calls[0].body).toMatchObject({ mediatype: 'document', media: url, fileName: 'Contrato.pdf', caption: 'firmalo' });
    expect(msg.media).toMatchObject({ kind: 'document', size: 2 * MB, name: 'Contrato.pdf' });
  });

  it('nota de voz con texto: el audio por sendWhatsAppAudio y el texto aparte', async () => {
    const { user, chat, calls } = await setup('media-voice');
    const url = localUpload('22222222-2222-2222-2222-222222222222-voz.weba', Buffer.from('webm-opus'));
    const msg = await sendMessage(user.id, user.id, chat.id, { body: 'te mandé un audio', media: { url, mimetype: 'audio/webm', filename: 'voz.weba', kind: 'voice', duration: 5 } });
    expect(calls[0].url).toBe('https://evo.example.com/message/sendWhatsAppAudio/s');
    expect(calls[0].body).toEqual({ number: '5491155550000@s.whatsapp.net', audio: Buffer.from('webm-opus').toString('base64'), encoding: true });
    expect(calls[1].url).toBe('https://evo.example.com/message/sendText/s');
    expect(msg).toMatchObject({ body: '', media: { kind: 'voice', ptt: true, duration: 5 } });
    const all = await listMessages(user.id, chat.id);
    expect(all.map((m) => m.body)).toEqual(['', 'te mandé un audio']);
    expect((await listChats(user.id, user.id)).rows[0].lastMessagePreview).toBe('te mandé un audio');
  });

  it('si Evolution falla queda failed con el código, y una nota de voz de más de 16 MB no sale', async () => {
    const { user, chat } = await setup('media-fail', (u) => (u.includes('/sendMedia/') ? new Response('{}', { status: 500 }) : null));
    const msg = await sendMessage(user.id, user.id, chat.id, { body: '', media: { url: 'https://cdn.example.com/a.pdf', mimetype: 'application/pdf', filename: 'a.pdf' } });
    expect(msg).toMatchObject({ status: 'failed', error: 'provider_error', media: { name: 'a.pdf' } });
    await expect(
      sendMessage(user.id, user.id, chat.id, { body: '', media: { url: 'https://cdn.example.com/v.weba', mimetype: 'audio/webm', filename: 'v.weba', kind: 'voice', size: 17 * MB } }),
    ).rejects.toMatchObject({ code: 'media_too_large', status: 413 });
  });

  it('número de ejemplo: la media queda como enviada, sin salir a la red', async () => {
    const fetchSpy = vi.fn();
    vi.stubGlobal('fetch', fetchSpy);
    const user = await makeUser('media-sample');
    await loadSampleData(user.id, user.id, 'en');
    const chat = (await listChats(user.id, user.id)).rows[0];
    const voice = await sendMessage(user.id, user.id, chat.id, {
      body: '',
      media: { url: 'http://localhost:3000/uploads/chat/x-voz.weba', mimetype: 'audio/webm', filename: 'voz.weba', kind: 'voice', duration: 3 },
    });
    expect(voice).toMatchObject({ status: 'sent', media: { kind: 'voice', ptt: true, duration: 3 } });
    const doc = await sendMessage(user.id, user.id, chat.id, { body: 'acá va', media: { url: 'https://cdn.example.com/a.pdf', mimetype: 'application/pdf', filename: 'a.pdf' } });
    expect(doc).toMatchObject({ status: 'sent', body: 'acá va', media: { kind: 'document', name: 'a.pdf' } });
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('recibir: nota de voz, documento y foto mandada desde el teléfono, bajadas a nuestro storage', async () => {
    const files: Record<string, { b64: string; mimetype: string; fileName?: string }> = {
      V1: { b64: Buffer.from('OggS-voice').toString('base64'), mimetype: 'audio/ogg; codecs=opus' },
      D1: { b64: Buffer.from('%PDF-1.4').toString('base64'), mimetype: 'application/pdf', fileName: 'Factura.pdf' },
      P1: { b64: JPEG.toString('base64'), mimetype: 'image/jpeg' },
    };
    const { user, number, chat, calls } = await setup('media-in', (u, body) => {
      if (!u.includes('/chat/getBase64FromMediaMessage/')) return null;
      const id = String(((body.message as { key: { id: string } }).key).id);
      const f = files[id];
      return new Response(JSON.stringify({ base64: f.b64, mimetype: f.mimetype, fileName: f.fileName }), { status: 201 });
    });
    const key = (id: string, fromMe = false) => ({ remoteJid: '5491155550000@s.whatsapp.net', fromMe, id });
    await ingestEvents(
      number,
      parseEvolutionWebhook({
        event: 'messages.upsert',
        data: [
          { key: key('V1'), pushName: 'Ana', message: { audioMessage: { mimetype: 'audio/ogg; codecs=opus', ptt: true, seconds: 9, fileLength: 10 } } },
          { key: key('D1'), pushName: 'Ana', message: { documentMessage: { mimetype: 'application/pdf', fileName: 'Factura.pdf', pageCount: 2, fileLength: 8 } } },
          { key: key('P1', true), message: { imageMessage: { mimetype: 'image/jpeg', caption: 'desde el teléfono' } } },
          { key: key('L1'), pushName: 'Ana', message: { locationMessage: { degreesLatitude: 10, degreesLongitude: 20, name: 'Oficina' } } },
        ],
      }),
    );
    const fromMeCall = calls.find((c) => (c.body.message as { key?: { id?: string } } | undefined)?.key?.id === 'P1')!;
    expect(fromMeCall.body).toEqual({ message: { key: { id: 'P1', remoteJid: '5491155550000@s.whatsapp.net', fromMe: true } }, convertToMp4: false });
    const msgs = await listMessages(user.id, chat.id);
    const [voice, doc, photo, loc] = msgs;
    expect(voice).toMatchObject({ direction: 'in', media: { kind: 'voice', ptt: true, duration: 9, url: expect.stringMatching(/^\/uploads\/chat\/.+\.ogg$/) } });
    expect(voice.media?.size).toBe(Buffer.from('OggS-voice').length);
    expect(doc).toMatchObject({ media: { kind: 'document', name: 'Factura.pdf', pages: 2, url: expect.stringMatching(/^\/uploads\/chat\/.+Factura\.pdf$/) } });
    expect(photo).toMatchObject({ direction: 'out', authorKind: 'phone', body: 'desde el teléfono', media: { kind: 'image', width: 640, height: 480, url: expect.stringMatching(/^\/uploads\/chat\//) } });
    expect(photo.media?.pending).toBeUndefined();
    expect(loc).toMatchObject({ media: null, location: { lat: 10, lng: 20, name: 'Oficina' } });
    // meta no repite lo que ya está en media/location.
    expect(loc.meta).toEqual({});
    expect((await listChats(user.id, user.id)).rows[0].lastMessagePreview).toBe('[location]');
  });
});
