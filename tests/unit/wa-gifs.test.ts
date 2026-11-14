import { mkdirSync, mkdtempSync, writeFileSync } from 'fs';
import os from 'os';
import path from 'path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createNumber, getNumberRowById, retryMessage, sendMessage, upsertChat } from '@/lib/groups';
import { evolutionProvider } from '@/lib/groups-provider-bridge';
import { mediaFromBody } from '@/lib/groups-media-input';
import type { FetchLike } from '@/lib/groups-provider';
import { getDb } from '@/lib/db';
import {
  clearGifCache,
  downloadGif,
  gifChoice,
  gifProvider,
  isGifMediaUrl,
  listGifs,
  looksLikeMp4,
  parseGiphy,
  parseTenor,
  providerLocale,
  providerUrl,
  GIF_MAX_BYTES,
} from '@/lib/wa-gifs';
import { FAKE_GIF_MP4 } from '@/lib/wa-gif-fixtures';
import { makeUser } from './helpers';

/** Lo esencial de una respuesta de GIPHY (/v1/gifs/search), recortada de una real. */
const GIPHY_SEARCH = {
  data: [
    {
      type: 'gif',
      id: 'l0MYt5jPR6QX5pnqM',
      title: 'Happy Dance GIF by Studio',
      images: {
        original: { width: '480', height: '270', size: '2345678', url: 'https://media2.giphy.com/media/v1.Y2lk/l0MYt5jPR6QX5pnqM/giphy.gif?cid=1&rid=giphy.gif', mp4_size: '612345', mp4: 'https://media2.giphy.com/media/v1.Y2lk/l0MYt5jPR6QX5pnqM/giphy.mp4?cid=1&rid=giphy.mp4', webp: 'https://media2.giphy.com/media/x/giphy.webp' },
        original_mp4: { width: '480', height: '270', mp4_size: '612345', mp4: 'https://media2.giphy.com/media/v1.Y2lk/l0MYt5jPR6QX5pnqM/giphy.mp4?cid=1&rid=giphy.mp4' },
        fixed_width_downsampled: { width: '200', height: '113', size: '98765', url: 'https://media2.giphy.com/media/x/200w_d.gif', webp: 'https://media2.giphy.com/media/x/200w_d.webp' },
        fixed_width: { width: '200', height: '113', url: 'https://media2.giphy.com/media/x/200w.gif', mp4: 'https://media2.giphy.com/media/x/200w.mp4' },
      },
    },
    {
      type: 'gif',
      id: 'bigOne',
      title: '',
      images: {
        original_mp4: { width: '1080', height: '1080', mp4_size: String(9 * 1024 * 1024), mp4: 'https://media1.giphy.com/media/big/giphy.mp4' },
        downsized_small: { width: '320', height: '320', mp4_size: '180000', mp4: 'https://media1.giphy.com/media/big/giphy-downsized-small.mp4' },
        fixed_width_downsampled: { width: '200', height: '200', url: 'https://media1.giphy.com/media/big/200w_d.gif' },
      },
    },
    // Sin vista previa ni MP4: no entra.
    { type: 'gif', id: 'broken', title: 'x', images: { original: { url: 'http://insecure.example.com/a.gif' } } },
  ],
  pagination: { total_count: 120, count: 3, offset: 0 },
  meta: { status: 200, msg: 'OK' },
};

/** Lo esencial de una respuesta de Tenor v2 (/v2/search). */
const TENOR_SEARCH = {
  results: [
    {
      id: '1234567890123456789',
      title: '',
      content_description: 'Cat Typing GIF',
      media_formats: {
        tinygif: { url: 'https://media.tenor.com/abc/AAAAM/cat-typing.gif', duration: 0, preview: '', dims: [220, 165], size: 210000 },
        mp4: { url: 'https://media.tenor.com/abc/AAAPo/cat-typing.mp4', duration: 2.1, preview: '', dims: [498, 374], size: 330000 },
        tinymp4: { url: 'https://media.tenor.com/abc/AAAA1/cat-typing.mp4', duration: 2.1, preview: '', dims: [320, 240], size: 90000 },
      },
      itemurl: 'https://tenor.com/view/cat-typing-gif-1234567890123456789',
    },
    {
      id: '42',
      title: 'Huge',
      content_description: '',
      media_formats: {
        nanogif: { url: 'https://media.tenor.com/h/AAAAN/huge.gif', dims: [90, 120], size: 40000 },
        mp4: { url: 'https://media.tenor.com/h/AAAPo/huge.mp4', dims: [1080, 1440], size: 8 * 1024 * 1024 },
        tinymp4: { url: 'https://media.tenor.com/h/AAAA1/huge.mp4', dims: [240, 320], size: 120000 },
      },
    },
    { id: '', media_formats: {} },
  ],
  next: 'CAgQ8sqaxfrp8QIaHgoKAD',
};

describe('GIPHY', () => {
  it('lee vista previa chica (WebP si hay), medidas, título y el MP4 que entra', () => {
    const { items, next } = parseGiphy(GIPHY_SEARCH);
    expect(items).toEqual([
      {
        id: 'l0MYt5jPR6QX5pnqM',
        title: 'Happy Dance GIF by Studio',
        preview: 'https://media2.giphy.com/media/x/200w_d.webp',
        width: 200,
        height: 113,
        mp4: 'https://media2.giphy.com/media/v1.Y2lk/l0MYt5jPR6QX5pnqM/giphy.mp4?cid=1&rid=giphy.mp4',
        size: 612345,
      },
      // El original pasa de 4 MB: va el chico.
      { id: 'bigOne', title: '', preview: 'https://media1.giphy.com/media/big/200w_d.gif', width: 200, height: 200, mp4: 'https://media1.giphy.com/media/big/giphy-downsized-small.mp4', size: 180000 },
    ]);
    expect(next).toBe('3');
  });

  it('sin más páginas no hay next; basura no rompe', () => {
    expect(parseGiphy({ data: [], pagination: { total_count: 0, count: 0, offset: 0 } })).toEqual({ items: [], next: '' });
    expect(parseGiphy({ ...GIPHY_SEARCH, pagination: { total_count: 3, count: 3, offset: 0 } }).next).toBe('');
    expect(parseGiphy(null)).toEqual({ items: [], next: '' });
    expect(parseGiphy({ data: 'x' })).toEqual({ items: [], next: '' });
  });

  it('el pedido: búsqueda o tendencias, pg-13, idioma, con la clave del servidor', () => {
    vi.stubEnv('GIPHY_API_KEY', 'gk');
    const search = new URL(providerUrl('giphy', 'hola', 'es', '24'));
    expect(search.origin + search.pathname).toBe('https://api.giphy.com/v1/gifs/search');
    expect(Object.fromEntries(search.searchParams)).toMatchObject({ api_key: 'gk', q: 'hola', offset: '24', rating: 'pg-13', lang: 'es' });
    const trending = new URL(providerUrl('giphy', '', 'pt', ''));
    expect(trending.pathname).toBe('/v1/gifs/trending');
    expect(trending.searchParams.get('q')).toBeNull();
    expect(trending.searchParams.get('lang')).toBe('pt');
    vi.unstubAllEnvs();
  });
});

describe('Tenor v2', () => {
  it('lee tinygif (o nanogif), dims, descripción y el MP4 que entra', () => {
    const { items, next } = parseTenor(TENOR_SEARCH);
    expect(items).toEqual([
      { id: '1234567890123456789', title: 'Cat Typing GIF', preview: 'https://media.tenor.com/abc/AAAAM/cat-typing.gif', width: 220, height: 165, mp4: 'https://media.tenor.com/abc/AAAPo/cat-typing.mp4', size: 330000 },
      { id: '42', title: 'Huge', preview: 'https://media.tenor.com/h/AAAAN/huge.gif', width: 90, height: 120, mp4: 'https://media.tenor.com/h/AAAA1/huge.mp4', size: 120000 },
    ]);
    expect(next).toBe('CAgQ8sqaxfrp8QIaHgoKAD');
    expect(parseTenor({ results: [], next: '' })).toEqual({ items: [], next: '' });
    expect(parseTenor(undefined)).toEqual({ items: [], next: '' });
  });

  it('el pedido: search o featured, contentfilter medium, locale', () => {
    vi.stubEnv('TENOR_API_KEY', 'tk');
    const u = new URL(providerUrl('tenor', 'jaja', 'es', 'CAgQ'));
    expect(u.origin + u.pathname).toBe('https://tenor.googleapis.com/v2/search');
    expect(Object.fromEntries(u.searchParams)).toMatchObject({ key: 'tk', q: 'jaja', pos: 'CAgQ', locale: 'es', contentfilter: 'medium' });
    expect(new URL(providerUrl('tenor', '', 'en', '')).pathname).toBe('/v2/featured');
    expect(providerLocale('tenor', 'pt')).toBe('pt_BR');
    expect(providerLocale('giphy', 'xx-YY')).toBe('xx');
    expect(providerLocale('giphy', '../')).toBe('en');
    vi.unstubAllEnvs();
  });
});

describe('qué proveedor y sin clave', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
    clearGifCache();
  });

  it('sin claves: null, y la lista dice provider null sin salir a la red', async () => {
    vi.stubEnv('GIPHY_API_KEY', '');
    vi.stubEnv('TENOR_API_KEY', '');
    vi.stubEnv('GROUPS_GIFS_FAKE', '');
    const f = vi.fn();
    expect(gifProvider()).toBeNull();
    expect(await listGifs({ q: 'hola', fetcher: f as unknown as typeof fetch })).toEqual({ provider: null, items: [], next: '' });
    expect(f).not.toHaveBeenCalled();
    await expect(downloadGif('https://media.tenor.com/a/b.mp4')).rejects.toMatchObject({ code: 'gifs_not_configured', status: 409 });
  });

  it('GIPHY si está su clave, si no Tenor; con las dos, GIF_PROVIDER=tenor elige Tenor', () => {
    vi.stubEnv('GROUPS_GIFS_FAKE', '');
    vi.stubEnv('GIPHY_API_KEY', '');
    vi.stubEnv('TENOR_API_KEY', 'tk');
    expect(gifProvider()).toBe('tenor');
    vi.stubEnv('GIPHY_API_KEY', 'gk');
    expect(gifProvider()).toBe('giphy');
    vi.stubEnv('GIF_PROVIDER', 'tenor');
    expect(gifProvider()).toBe('tenor');
  });

  it('el falso: solo con la bandera y fuera de producción; la cookie lo apaga', () => {
    vi.stubEnv('GIPHY_API_KEY', '');
    vi.stubEnv('TENOR_API_KEY', '');
    vi.stubEnv('GROUPS_GIFS_FAKE', '1');
    expect(gifProvider()).toBe('fake');
    expect(gifProvider({ fakeOff: true })).toBeNull();
    vi.stubEnv('VERCEL_ENV', 'production');
    expect(gifProvider()).toBeNull();
  });

  it('la caché: la misma búsqueda no vuelve a salir', async () => {
    vi.stubEnv('GROUPS_GIFS_FAKE', '');
    vi.stubEnv('TENOR_API_KEY', 'tk');
    vi.stubEnv('GIPHY_API_KEY', '');
    const f = vi.fn(async () => new Response(JSON.stringify(TENOR_SEARCH), { status: 200 }));
    const a = await listGifs({ q: 'Gato', locale: 'es', fetcher: f as unknown as typeof fetch });
    const b = await listGifs({ q: 'gato ', locale: 'es', fetcher: f as unknown as typeof fetch });
    expect(a).toEqual(b);
    expect(a.provider).toBe('tenor');
    expect(f).toHaveBeenCalledTimes(1);
    await listGifs({ q: 'gato', locale: 'pt', fetcher: f as unknown as typeof fetch });
    expect(f).toHaveBeenCalledTimes(2);
  });

  it('un 429 del proveedor se devuelve como rate_limited; otro error como gif_provider_error', async () => {
    vi.stubEnv('GROUPS_GIFS_FAKE', '');
    vi.stubEnv('GIPHY_API_KEY', 'gk');
    await expect(listGifs({ q: 'a', fetcher: (async () => new Response('', { status: 429 })) as unknown as typeof fetch })).rejects.toMatchObject({ code: 'rate_limited', status: 429 });
    await expect(listGifs({ q: 'b', fetcher: (async () => new Response('', { status: 500 })) as unknown as typeof fetch })).rejects.toMatchObject({ code: 'gif_provider_error' });
  });
});

describe('bajar el elegido', () => {
  afterEach(() => vi.unstubAllEnvs());

  it('solo del CDN del proveedor configurado, por https', () => {
    expect(isGifMediaUrl('giphy', 'https://media2.giphy.com/media/x/giphy.mp4?cid=1')).toBe(true);
    expect(isGifMediaUrl('giphy', 'https://i.giphy.com/x.mp4')).toBe(true);
    expect(isGifMediaUrl('giphy', 'http://media2.giphy.com/x.mp4')).toBe(false);
    expect(isGifMediaUrl('giphy', 'https://media.tenor.com/x.mp4')).toBe(false);
    expect(isGifMediaUrl('giphy', 'https://media2.giphy.com.evil.com/x.mp4')).toBe(false);
    expect(isGifMediaUrl('giphy', 'https://user@media2.giphy.com/x.mp4')).toBe(false);
    expect(isGifMediaUrl('giphy', 'https://media2.giphy.com:8443/x.mp4')).toBe(false);
    expect(isGifMediaUrl('tenor', 'https://media.tenor.com/abc/AAAPo/a.mp4')).toBe(true);
    expect(isGifMediaUrl('tenor', 'https://169.254.169.254/latest')).toBe(false);
    expect(isGifMediaUrl('fake', 'fake:3')).toBe(true);
    expect(isGifMediaUrl('fake', 'https://media.tenor.com/a.mp4')).toBe(false);
  });

  it('URL de otro host: invalid_gif sin bajar nada', async () => {
    vi.stubEnv('GROUPS_GIFS_FAKE', '');
    vi.stubEnv('TENOR_API_KEY', 'tk');
    await expect(downloadGif('https://evil.example.com/a.mp4')).rejects.toMatchObject({ code: 'invalid_gif', status: 400 });
  });

  it('el falso devuelve el MP4 de prueba (un MP4 de verdad)', async () => {
    vi.stubEnv('GROUPS_GIFS_FAKE', '1');
    const buf = await downloadGif('fake:0');
    expect(looksLikeMp4(buf)).toBe(true);
    expect(buf.length).toBeLessThan(GIF_MAX_BYTES);
    expect(looksLikeMp4(Buffer.from('<html>no</html>'))).toBe(false);
  });

  it('lo que manda el navegador: URL y medidas razonables', () => {
    expect(gifChoice({ url: 'fake:1', width: 200, height: 150 })).toEqual({ url: 'fake:1', width: 200, height: 150 });
    expect(gifChoice({ url: 'fake:1', width: 99999, height: 1 })).toEqual({ url: 'fake:1' });
    expect(() => gifChoice({})).toThrow('invalid_gif');
  });
});

describe('mandar un GIF: video con gifPlayback', () => {
  function evo() {
    const calls: Array<{ url: string; body: Record<string, unknown> }> = [];
    const f: FetchLike = async (url, init) => {
      calls.push({ url, body: JSON.parse(String(init?.body ?? '{}')) });
      return new Response(JSON.stringify({ key: { id: `BAE${calls.length}` } }), { status: 201 });
    };
    return { p: evolutionProvider({ baseUrl: 'https://evo.example.com', apiKey: 'k', session: 'acme' }, { fetch: f }), calls };
  }

  it('Evolution: sendMedia, mediatype video, gifPlayback true (un video común no lo lleva)', async () => {
    const { p, calls } = evo();
    await p.sendMedia('549@s.whatsapp.net', { url: '', base64: 'AAAA', mimetype: 'video/mp4', filename: 'gif.mp4', caption: '', kind: 'video', gifPlayback: true });
    expect(calls[0].url).toBe('https://evo.example.com/message/sendMedia/acme');
    expect(calls[0].body).toEqual({ number: '549@s.whatsapp.net', mediatype: 'video', mimetype: 'video/mp4', media: 'AAAA', fileName: 'gif.mp4', caption: '', gifPlayback: true });
    await p.sendMedia('549@s.whatsapp.net', { url: '', base64: 'AAAA', mimetype: 'video/mp4', filename: 'v.mp4', kind: 'video' });
    expect(calls[1].body.gifPlayback).toBeUndefined();
  });

  it('mediaFromBody: gif solo en un video', () => {
    const req = new Request('http://localhost:3000/api/groups/chats/x/messages');
    vi.stubEnv('NEXTAUTH_URL', 'http://localhost:3000');
    expect(mediaFromBody({ url: '/uploads/chat/a-gif.mp4', mimetype: 'video/mp4', filename: 'gif.mp4', kind: 'video', gif: true }, req)?.gif).toBe(true);
    expect(mediaFromBody({ url: '/uploads/chat/a.png', mimetype: 'image/png', filename: 'a.png', gif: true }, req)?.gif).toBeUndefined();
    vi.unstubAllEnvs();
  });

  describe('Lines de punta a punta', () => {
    let dir: string;
    beforeEach(() => {
      dir = mkdtempSync(path.join(os.tmpdir(), 'zs-wa-gifs-'));
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

    it('sale con gifPlayback, queda guardado como animado (la burbuja lo muestra como GIF) y el reintento también lo lleva', async () => {
      const calls: Array<{ url: string; body: Record<string, unknown> }> = [];
      let fail = true;
      vi.stubGlobal('fetch', async (input: string | URL, init: RequestInit = {}) => {
        calls.push({ url: String(input), body: typeof init.body === 'string' ? (JSON.parse(init.body) as Record<string, unknown>) : {} });
        if (fail) return new Response('{}', { status: 500 });
        return new Response(JSON.stringify({ key: { id: `OUT${calls.length}` } }), { status: 201 });
      });
      const user = await makeUser('wa-gif-send');
      const num = await createNumber(user.id, user.id, { provider: 'evolution', config: { baseUrl: 'https://evo.example.com', apiKey: 'k', session: 's' } });
      const number = (await getNumberRowById(num.id))!;
      const chat = await upsertChat(number, { providerChatId: '5491155550000@s.whatsapp.net', kind: 'dm', name: 'Ana', phone: '5491155550000' });
      mkdirSync(path.join(dir, 'chat'), { recursive: true });
      const name = '33333333-3333-3333-3333-333333333333-gif.mp4';
      writeFileSync(path.join(dir, 'chat', name), FAKE_GIF_MP4);
      const url = `http://localhost:3000/uploads/chat/${name}`;
      const msg = await sendMessage(user.id, user.id, chat.id, { body: '', media: { url, mimetype: 'video/mp4', filename: 'gif.mp4', kind: 'video', gif: true, width: 200, height: 150, size: FAKE_GIF_MP4.length } });
      expect(calls[0].body).toMatchObject({ mediatype: 'video', gifPlayback: true, media: FAKE_GIF_MP4.toString('base64') });
      expect(msg).toMatchObject({ status: 'failed', media: { kind: 'video', animated: true, width: 200, height: 150 } });
      fail = false;
      const again = await retryMessage(user.id, user.id, msg.id);
      expect(again.status).toBe('sent');
      expect(calls[1].body).toMatchObject({ mediatype: 'video', gifPlayback: true });
      const row = (await getDb().prepare('SELECT media_type FROM groups_messages WHERE id = ?').get(msg.id)) as { media_type: string };
      expect(row.media_type).toBe('video/mp4');
    });
  });
});
