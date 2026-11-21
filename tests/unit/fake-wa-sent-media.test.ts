import { describe, expect, it } from 'vitest';
import { fakeProvider } from '@/lib/groups-provider-fake';

/** El WhatsApp falso, como el de verdad: bajar un archivo que se mandó devuelve ese mismo archivo. */
describe('WhatsApp falso: archivos mandados', () => {
  it('devuelve los bytes que se mandaron y uno inventado para lo que no se mandó', async () => {
    const p = fakeProvider(`sent-media-${Date.now()}`, { instantConnect: true });
    await p.connect('http://localhost/webhook');
    const bytes = Buffer.from('foto editada');
    const { id } = await p.sendMedia('120363000000009999@g.us', { url: '', mimetype: 'image/jpeg', filename: 'image.jpg', caption: 'Editada', kind: 'image', base64: bytes.toString('base64') });
    const got = await p.fetchMedia!({ providerMessageId: id, chatId: '120363000000009999@g.us', fromMe: true }, 1024 * 1024);
    expect(got).toMatchObject({ mimetype: 'image/jpeg', filename: 'image.jpg' });
    expect(Buffer.compare(got.data, bytes)).toBe(0);

    const other = await p.fetchMedia!({ providerMessageId: 'img-no-mandado', chatId: '120363000000009999@g.us', fromMe: false }, 1024 * 1024);
    expect(other.mimetype).toBe('image/png');
    expect(Buffer.compare(other.data, bytes)).not.toBe(0);
  });

  it('un sticker mandado se baja por su id con prefijo', async () => {
    const p = fakeProvider(`sent-sticker-${Date.now()}`, { instantConnect: true });
    await p.connect('http://localhost/webhook');
    const bytes = Buffer.from('RIFF0000WEBP');
    const { id } = await p.sendMedia('5491100000001@s.whatsapp.net', { url: '', mimetype: 'image/webp', filename: 'sticker.webp', kind: 'sticker', base64: bytes.toString('base64') });
    expect(id.startsWith('stk-')).toBe(true);
    const got = await p.fetchMedia!({ providerMessageId: id, chatId: '5491100000001@s.whatsapp.net', fromMe: true }, 1024 * 1024);
    expect(Buffer.compare(got.data, bytes)).toBe(0);
  });
});
