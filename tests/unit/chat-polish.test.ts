import { describe, expect, it } from 'vitest';
import { evolutionStickerBody } from '@/lib/groups-media';
import { LEAVE_MS, commitAt, leaveDuration, rowSwipeLayout, swipeActionKey, swipeRelease } from '@/lib/chat-gestures';
import { MEDIA_W, mediaBox, mediaFit } from '@/components/groups/wa/media-box';
import { newsLocale, versionNews } from '@/lib/app-version-news';
import { contactPhone, visiblePhone } from '@/lib/wa-contact-phone';
import type { ChangelogEntry } from '@/content/changelog';

/** Un WebP mínimo: "RIFF", tamaño, "WEBP" y un chunk VP8X con la marca de animación. */
function webp(animated: boolean): Buffer {
  const b = Buffer.alloc(40);
  b.write('RIFF', 0, 'ascii');
  b.writeUInt32LE(32, 4);
  b.write('WEBP', 8, 'ascii');
  b.write('VP8X', 12, 'ascii');
  b[20] = animated ? 0x02 : 0;
  b.write('ANIM', 30, 'ascii');
  return b;
}

describe('evolutionStickerBody: un sticker sale tal cual (animado si lo es)', () => {
  it('un WebP en base64 va sin la conversión de Evolution', () => {
    const b64 = webp(true).toString('base64');
    expect(evolutionStickerBody('549@s.whatsapp.net', b64, 'image/webp')).toEqual({ number: '549@s.whatsapp.net', sticker: b64, notConvertSticker: true });
  });

  it('también con el prefijo data: (se saca, Evolution espera base64 pelado)', () => {
    const b64 = webp(false).toString('base64');
    expect(evolutionStickerBody('x', `data:image/webp;base64,${b64}`, 'image/webp; charset=binary')).toMatchObject({ sticker: b64, notConvertSticker: true });
  });

  it('una URL u otra imagen sigue pasando por la conversión', () => {
    expect(evolutionStickerBody('x', 'https://blob.example/sticker.webp', 'image/webp')).toEqual({ number: 'x', sticker: 'https://blob.example/sticker.webp' });
    const png = Buffer.from('\x89PNG\r\n\x1a\n0000000000', 'latin1').toString('base64');
    expect(evolutionStickerBody('x', png, 'image/png')).not.toHaveProperty('notConvertSticker');
    // Dice WebP pero los bytes no lo son: no se manda sin convertir.
    expect(evolutionStickerBody('x', png, 'image/webp')).not.toHaveProperty('notConvertSticker');
  });
});

describe('deslizar una fila: acciones y la fila que se va', () => {
  it('a la derecha, leído o no leído, fijar y posponer; a la izquierda, archivar y más', () => {
    expect(rowSwipeLayout({ unread: true, pinned: false, archived: false, snoozed: false })).toEqual({ right: ['read', 'pin', 'snooze'], left: ['archive', 'more'] });
    expect(rowSwipeLayout({ unread: false, pinned: true, archived: true, snoozed: true })).toEqual({ right: ['unread', 'unpin', 'unsnooze'], left: ['unarchive', 'more'] });
  });

  it('cada botón tiene una clave fija (la de los tests y los atajos), aunque cambie el texto', () => {
    expect(['read', 'unread', 'pin', 'unpin', 'snooze', 'unsnooze', 'archive', 'unarchive', 'more'].map((k) => swipeActionKey(k as never))).toEqual(['unread', 'unread', 'pin', 'pin', 'snooze', 'snooze', 'archive', 'archive', 'more']);
  });

  it('con tres acciones, a mitad de camino quedan abiertas y hasta el fondo ejecuta la principal', () => {
    expect(swipeRelease({ x: 180, width: 390, count: 3 })).toBe('open');
    expect(swipeRelease({ x: commitAt(390, 3), width: 390, count: 3 })).toBe('commit');
    expect(swipeRelease({ x: 60, width: 390, count: 3 })).toBe('close');
  });

  it('la fila que se va tarda lo de WhatsApp (~200 ms) y nada con movimiento reducido', () => {
    expect(LEAVE_MS).toBeLessThanOrEqual(250);
    expect(leaveDuration(false)).toBe(LEAVE_MS);
    expect(leaveDuration(true)).toBe(0);
  });
});

describe('mediaBox con texto: la burbuja no queda angosta', () => {
  it('sin texto, una foto chica queda de su tamaño', () => {
    expect(mediaBox(140, 700)).toEqual({ width: 140, height: 187 });
  });

  it('con texto ocupa el ancho entero, recortada a 3:4 como mucho de alto', () => {
    expect(mediaBox(140, 700, { caption: true })).toEqual({ width: MEDIA_W, height: 400 });
    expect(mediaBox(200, 150, { caption: true })).toEqual({ width: MEDIA_W, height: 225 });
    expect(mediaBox(1080, 1920, { caption: true })).toEqual({ width: MEDIA_W, height: 400 });
  });

  it('una muy chica con texto se centra sin agrandarse; las demás se recortan', () => {
    expect(mediaFit(140, 700, true)).toBe('contain');
    expect(mediaFit(140, 700, false)).toBe('cover');
    expect(mediaFit(1080, 1920, true)).toBe('cover');
    expect(mediaFit(undefined, undefined, true)).toBe('cover');
  });
});

describe('versionNews: qué trae la versión nueva', () => {
  const entry = (id: string, date: string, en: string, es = ''): ChangelogEntry => ({ id, date, title: { en, es, pt: '' }, items: [] });
  const entries = [entry('a', '2026-11-14', 'Older'), entry('b', '2026-11-16', 'Stickers move', 'Los stickers se mueven'), entry('c', '2026-11-16', 'Snooze from a swipe'), entry('d', '2026-11-16', 'Third')];

  it('los títulos del último día, hasta dos, en el idioma (o en inglés si falta)', () => {
    expect(versionNews(entries, 'es')).toEqual({ id: 'b', titles: ['Los stickers se mueven', 'Snooze from a swipe'] });
    expect(versionNews(entries, 'en', 1)).toEqual({ id: 'b', titles: ['Stickers move'] });
  });

  it('sin entradas, nada', () => {
    expect(versionNews([], 'en')).toBeNull();
  });

  it('el idioma se limita a los tres de la app', () => {
    expect(newsLocale('pt')).toBe('pt');
    expect(newsLocale('fr')).toBe('en');
    expect(newsLocale(null)).toBe('en');
  });
});

describe('contactPhone: el teléfono de la ficha', () => {
  it('el teléfono guardado o el del id del chat', () => {
    expect(contactPhone({ phone: '5491155550000', chatId: '5491155550000@s.whatsapp.net' })).toBe('5491155550000');
    expect(contactPhone({ phone: '', chatId: '5491155550000@s.whatsapp.net' })).toBe('5491155550000');
  });

  it('un chat por lid: el teléfono que la libreta conoce, y si no, nada (nunca el lid)', () => {
    expect(contactPhone({ phone: '', chatId: '123456789012345@lid', lidPhone: '5491155550000' })).toBe('5491155550000');
    expect(contactPhone({ phone: '', chatId: '123456789012345@lid' })).toBe('');
    expect(contactPhone({ phone: '123456789012345', chatId: '123456789012345@lid' })).toBe('');
  });

  it('un grupo no tiene teléfono', () => {
    expect(contactPhone({ phone: '5491155550000', chatId: '120363000000000000@g.us' })).toBe('');
  });

  it('enmascarado (quien no ve los números) no se muestra', () => {
    expect(visiblePhone('54 ••• 00')).toBe('');
    expect(visiblePhone('+5491155550000')).toBe('5491155550000');
    expect(visiblePhone('')).toBe('');
  });
});
