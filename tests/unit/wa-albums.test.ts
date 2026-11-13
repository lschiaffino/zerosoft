import { describe, expect, it } from 'vitest';
import { ALBUM_GAP_MS, albumLayout, groupAlbums, type AlbumInfo } from '@/lib/wa-albums';

interface M {
  id: string;
  from: string;
  sec: number;
  kind?: 'image' | 'video' | 'text' | 'sticker';
  caption?: boolean;
  start?: boolean;
}

const info = (m: M): AlbumInfo => ({
  media: m.kind === 'image' || m.kind === 'video',
  key: m.from,
  at: m.sec * 1000,
  caption: Boolean(m.caption),
  start: m.start,
});
const ids = (runs: M[][]) => runs.map((r) => r.map((m) => m.id).join(','));
const img = (id: string, from: string, sec: number, over: Partial<M> = {}): M => ({ id, from, sec, kind: 'image', ...over });

describe('groupAlbums', () => {
  it('junta fotos y videos seguidos del mismo remitente', () => {
    const list = [img('a', 'ana', 0), img('b', 'ana', 2, { kind: 'video' }), img('c', 'ana', 3)];
    expect(ids(groupAlbums(list, info))).toEqual(['a,b,c']);
  });

  it('una foto sola queda sola; el texto corta', () => {
    const list = [img('a', 'ana', 0), { id: 't', from: 'ana', sec: 1, kind: 'text' as const }, img('b', 'ana', 2)];
    expect(ids(groupAlbums(list, info))).toEqual(['a', 't', 'b']);
  });

  it('otro remitente o más de un minuto entre fotos corta el álbum', () => {
    const gap = ALBUM_GAP_MS / 1000;
    const list = [img('a', 'ana', 0), img('b', 'ana', gap), img('c', 'ana', gap * 2 + 1), img('d', 'beto', gap * 2 + 2), img('e', 'beto', gap * 2 + 3)];
    expect(ids(groupAlbums(list, info))).toEqual(['a,b', 'c', 'd,e']);
  });

  it('el texto solo puede ir en la última del álbum', () => {
    const list = [img('a', 'ana', 0), img('b', 'ana', 1, { caption: true }), img('c', 'ana', 2), img('d', 'ana', 3)];
    expect(ids(groupAlbums(list, info))).toEqual(['a,b', 'c,d']);
  });

  it('stickers y lo marcado como inicio (no leídos) no se pegan', () => {
    const list = [img('a', 'ana', 0), img('s', 'ana', 1, { kind: 'sticker' }), img('b', 'ana', 2), img('c', 'ana', 3, { start: true }), img('d', 'ana', 4)];
    expect(ids(groupAlbums(list, info))).toEqual(['a', 's', 'b', 'c,d']);
  });

  it('no cambia el orden ni pierde mensajes', () => {
    const list: M[] = Array.from({ length: 30 }, (_, i) => img(`m${i}`, i % 7 === 0 ? 'beto' : 'ana', i * 20, { kind: i % 5 === 0 ? 'text' : 'image' }));
    expect(groupAlbums(list, info).flat()).toEqual(list);
  });
});

describe('albumLayout', () => {
  it('2 lado a lado, 3 una alta y dos apiladas, 4 en 2×2', () => {
    expect(albumLayout(2)).toEqual({ shape: 'two', shown: 2, more: 0 });
    expect(albumLayout(3)).toEqual({ shape: 'three', shown: 3, more: 0 });
    expect(albumLayout(4)).toEqual({ shape: 'grid', shown: 4, more: 0 });
  });

  it('más de 4: la cuarta lleva "+N" contándose a sí misma, como WhatsApp', () => {
    expect(albumLayout(5)).toEqual({ shape: 'grid', shown: 4, more: 2 });
    expect(albumLayout(9)).toEqual({ shape: 'grid', shown: 4, more: 6 });
  });
});
