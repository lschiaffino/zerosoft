/**
 * El WhatsApp falso devuelve la foto que se mandó (como Evolution), no una inventada: Inbox muestra lo que
 * mandó bajándolo del servidor, y los e2e del editor de fotos miran esos bytes.
 */
import { beforeEach, describe, expect, it } from 'vitest';
import { fakeProvider, resetFakeProvider } from '@/lib/groups-provider-fake';

beforeEach(() => resetFakeProvider());

describe('proveedor falso: fotos mandadas', () => {
  it('fetchMedia devuelve los mismos bytes de una foto mandada en base64, también con menciones', async () => {
    const p = fakeProvider('fake-sent-media', { instantConnect: true });
    await p.connect('http://localhost/webhook');
    const bytes = Buffer.from('foto editada');
    const chat = '120363000000000001@g.us';
    const plain = await p.sendMedia(chat, { url: '', mimetype: 'image/jpeg', filename: 'a.jpg', kind: 'image', base64: bytes.toString('base64') });
    const got = await p.fetchMedia!({ providerMessageId: plain.id, chatId: chat, fromMe: true }, 1e7);
    expect(got.data.equals(bytes)).toBe(true);
    expect(got.mimetype).toBe('image/jpeg');

    const mentioned = await p.sendMedia(chat, { url: '', mimetype: 'image/jpeg', filename: 'b.jpg', kind: 'image', caption: '@15550001001 hola', mentions: ['15550001001'], base64: bytes.toString('base64') });
    expect((await p.fetchMedia!({ providerMessageId: mentioned.id, chatId: chat, fromMe: true }, 1e7)).data.equals(bytes)).toBe(true);
  });

  it('lo que no se mandó sigue siendo la foto inventada', async () => {
    const p = fakeProvider('fake-sent-media-2', { instantConnect: true });
    const got = await p.fetchMedia!({ providerMessageId: 'img-x', chatId: 'c@g.us', fromMe: false }, 1e7);
    expect(got.mimetype).toBe('image/png');
  });
});
