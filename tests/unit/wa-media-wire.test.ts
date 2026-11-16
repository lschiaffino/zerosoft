import { afterEach, describe, expect, it, vi } from 'vitest';
import { evolutionProvider, parseEvolutionWebhook } from '@/lib/groups-provider-bridge';
import { inboundMeta } from '@/lib/groups';
import { ProviderError } from '@/lib/groups-provider';
import { bytesToBase64, mediaErrorKind, mediaWireOf, parseMediaWire, wireMessage } from '@/lib/wa-media-wire';

/**
 * Volver a bajar un archivo que el gateway no guardó (llegó por la
 * sincronización del historial al volver a vincular): con la clave del archivo
 * se le pasa el mensaje a Evolution, que lo baja de WhatsApp o le pide al
 * teléfono que lo vuelva a subir. Datos inventados.
 */

const KEY = Buffer.alloc(32, 7).toString('base64');
const SHA = Buffer.alloc(32, 9).toString('base64');
const IMAGE = {
  mimetype: 'image/jpeg',
  caption: 'la foto',
  fileLength: '52345',
  mediaKey: KEY,
  directPath: '/v/t62.7118-24/12345_67890.enc?ccb=11-4&oh=abc&oe=def&_nc_sid=5e03e0',
  url: 'https://mmg.whatsapp.net/v/t62.7118-24/12345_67890.enc?ccb=11-4',
  fileEncSha256: SHA,
  fileSha256: SHA,
};

describe('bytesToBase64', () => {
  it('acepta las formas en que llegan los bytes por JSON', () => {
    const bytes = [1, 2, 3, 250];
    const b64 = Buffer.from(bytes).toString('base64');
    expect(bytesToBase64(b64)).toBe(b64);
    expect(bytesToBase64({ type: 'Buffer', data: bytes })).toBe(b64);
    expect(bytesToBase64({ 0: 1, 1: 2, 2: 3, 3: 250 })).toBe(b64);
    expect(bytesToBase64(bytes)).toBe(b64);
  });

  it('rechaza lo que no son bytes', () => {
    expect(bytesToBase64('no es base64!')).toBe('');
    expect(bytesToBase64([1, 999])).toBe('');
    expect(bytesToBase64({ a: 1 })).toBe('');
    expect(bytesToBase64(null)).toBe('');
  });
});

describe('mediaWireOf', () => {
  it('toma la clave, la ruta, los hashes y el tamaño', () => {
    expect(mediaWireOf('imageMessage', IMAGE)).toEqual({
      type: 'imageMessage',
      mediaKey: KEY,
      directPath: IMAGE.directPath,
      url: IMAGE.url,
      mimetype: 'image/jpeg',
      fileEncSha256: SHA,
      fileSha256: SHA,
      fileLength: 52345,
    });
  });

  it('solo URLs de los servidores de WhatsApp; sin clave o sin ruta, nada', () => {
    expect(mediaWireOf('imageMessage', { ...IMAGE, url: 'https://evil.example/x' })?.url).toBeUndefined();
    expect(mediaWireOf('imageMessage', { ...IMAGE, directPath: 'https://evil.example/x' })).toBeUndefined();
    expect(mediaWireOf('imageMessage', { ...IMAGE, mediaKey: undefined })).toBeUndefined();
    expect(mediaWireOf('conversation', IMAGE)).toBeUndefined();
  });

  it('lo guardado se vuelve a validar y se arma el mensaje para Evolution', () => {
    const wire = mediaWireOf('videoMessage', IMAGE)!;
    expect(parseMediaWire(JSON.parse(JSON.stringify(wire)))).toEqual(wire);
    expect(parseMediaWire({ ...wire, type: 'evil' })).toBeUndefined();
    expect(Object.keys(wireMessage(wire))).toEqual(['videoMessage']);
  });
});

describe('mediaErrorKind', () => {
  it('distingue lo que ya no está de lo pasajero', () => {
    expect(mediaErrorKind(new ProviderError('not_found'))).toBe('gone');
    expect(mediaErrorKind(new ProviderError('provider_error', 400))).toBe('gone');
    expect(mediaErrorKind(new ProviderError('provider_error', 413))).toBe('too_big');
    expect(mediaErrorKind(new ProviderError('unreachable'))).toBe('unreachable');
    expect(mediaErrorKind(new Error('x'))).toBe('provider_error');
  });
});

const webhook = (id: string) => ({
  event: 'messages.upsert',
  instance: 's',
  data: { key: { remoteJid: '15550001111@s.whatsapp.net', fromMe: false, id }, pushName: 'Ana', message: { imageMessage: IMAGE } },
});

describe('webhook de Evolution', () => {
  it('la referencia del archivo lleva la clave; Lines la guarda en meta', () => {
    const [ev] = parseEvolutionWebhook(webhook('W1'));
    const media = (ev as { media: { fetchRef: { wire?: unknown } } }).media;
    expect(media.fetchRef.wire).toMatchObject({ type: 'imageMessage', mediaKey: KEY });
    const meta = inboundMeta(ev as Parameters<typeof inboundMeta>[0]);
    expect(meta?.mediaWire).toMatchObject({ directPath: IMAGE.directPath });
  });
});

describe('evolutionProvider.fetchMedia', () => {
  afterEach(() => vi.unstubAllGlobals());

  function provider(replies: Array<(body: Record<string, unknown>) => Response>) {
    const bodies: Array<Record<string, unknown>> = [];
    const fetch = vi.fn(async (_url: string | URL, init: RequestInit = {}) => {
      const body = JSON.parse(String(init.body)) as Record<string, unknown>;
      bodies.push(body);
      return replies[bodies.length - 1](body);
    });
    const p = evolutionProvider({ baseUrl: 'https://evo.example.com', apiKey: 'k', session: 's' }, { fetch: fetch as never });
    return { p, bodies };
  }
  const ok = () => new Response(JSON.stringify({ base64: Buffer.from('jpeg').toString('base64'), mimetype: 'image/jpeg' }), { status: 201 });
  const notFound = () => new Response(JSON.stringify({ message: 'Message not found' }), { status: 400 });
  const ref = { providerMessageId: 'W2', chatId: '15550001111@s.whatsapp.net', fromMe: false };

  it('primero solo la key; si el gateway no tiene el mensaje, le pasa el archivo de WhatsApp', async () => {
    const { p, bodies } = provider([notFound, ok]);
    const wire = mediaWireOf('imageMessage', IMAGE)!;
    const file = await p.fetchMedia!({ ...ref, wire }, 1024 * 1024);
    expect(file.data.toString()).toBe('jpeg');
    expect(bodies[0]).toEqual({ message: { key: { id: 'W2', remoteJid: ref.chatId, fromMe: false } }, convertToMp4: false });
    expect(bodies[1]).toEqual({ message: { key: { id: 'W2', remoteJid: ref.chatId, fromMe: false }, message: wireMessage(wire) }, convertToMp4: false });
  });

  it('sin clave no hay segundo intento', async () => {
    const { p, bodies } = provider([notFound, ok]);
    await expect(p.fetchMedia!(ref, 1024 * 1024)).rejects.toBeInstanceOf(ProviderError);
    expect(bodies).toHaveLength(1);
  });
});
