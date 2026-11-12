/**
 * Chats de WhatsApp (Inbox y Lines): la tarjeta de un link (grande con la
 * imagen arriba, compacta con la miniatura al costado, solo texto), lo que
 * guarda el lector de vistas previas (medidas, segunda imagen, ícono) y la
 * "Visualización" de cada persona. Datos inventados.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { getDb } from '@/lib/db';
import { imageSize } from '@/lib/image-size';
import { cleanDisplay, DEFAULT_DISPLAY, displayCss, isDefaultDisplay, linkImageRatio, linkLayout, patchDisplay } from '@/lib/chat-display';
import { getChatDisplay, setChatDisplay } from '@/lib/chat-style';
import { linkPreview, linkPreviewImage } from '@/lib/wa-extras';
import { parseImageHints } from '@/lib/docs-unfurl';
import { dataUrlSize, fromGiven, needsFetch, pickPreview, safeHref, safeImage } from '@/components/groups/wa/link-preview-data';
import { makeUser } from './helpers';

beforeEach(() => {
  vi.stubEnv('DOCS_UNFURL_FAKE', '1');
});
afterEach(() => vi.unstubAllEnvs());

/** PNG mínimo de w×h (una sola fila negra repetida, con CRC en cero: imageSize solo lee la cabecera). */
function pngHeader(w: number, h: number): Uint8Array {
  const b = Buffer.alloc(33);
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]).copy(b, 0);
  b.writeUInt32BE(13, 8);
  b.write('IHDR', 12, 'ascii');
  b.writeUInt32BE(w, 16);
  b.writeUInt32BE(h, 20);
  return b;
}

describe('medidas de una imagen por su cabecera', () => {
  it('PNG, GIF, JPEG, WebP e ICO; null con basura o cortado', () => {
    expect(imageSize(pngHeader(1200, 630))).toEqual({ width: 1200, height: 630 });
    const gif = Buffer.from('GIF89a\x40\x01\xf0\x00', 'latin1');
    expect(imageSize(gif)).toEqual({ width: 320, height: 240 });
    // JPEG: SOI, un APP0 de 16 bytes y un SOF0 con alto 480 y ancho 640.
    const jpeg = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, ...Array(14).fill(0), 0xff, 0xc0, 0x00, 0x11, 0x08, 0x01, 0xe0, 0x02, 0x80, 0x03, 0, 0, 0, 0, 0, 0]);
    expect(imageSize(jpeg)).toEqual({ width: 640, height: 480 });
    // WebP VP8X: ancho-1 y alto-1 en 24 bits.
    const webp = Buffer.alloc(30);
    webp.write('RIFF', 0, 'ascii');
    webp.write('WEBPVP8X', 8, 'ascii');
    webp.writeUIntLE(999, 24, 3);
    webp.writeUIntLE(499, 27, 3);
    expect(imageSize(webp)).toEqual({ width: 1000, height: 500 });
    expect(imageSize(Buffer.from([0, 0, 1, 0, 1, 0, 32, 32]))).toEqual({ width: 32, height: 32 });
    expect(imageSize(Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"/>'))).toBeNull();
    expect(imageSize(pngHeader(1200, 630).subarray(0, 20))).toBeNull();
    expect(imageSize(Buffer.from([0xff, 0xd8, 0x00]))).toBeNull();
  });
});

describe('tarjeta grande o compacta', () => {
  it('grande con una imagen grande; compacta con logos, imágenes chicas o sin medidas; texto sin imagen', () => {
    const img = 'x';
    expect(linkLayout({ image: img, imageWidth: 1200, imageHeight: 630 })).toBe('large');
    expect(linkLayout({ image: img, imageWidth: 1080, imageHeight: 1080 })).toBe('large');
    expect(linkLayout({ image: img, imageWidth: 600, imageHeight: 1500 })).toBe('large');
    expect(linkLayout({ image: img, imageWidth: 96, imageHeight: 96 })).toBe('compact');
    expect(linkLayout({ image: img, imageWidth: 400, imageHeight: 400 })).toBe('compact');
    expect(linkLayout({ image: img, imageWidth: 800, imageHeight: 120 })).toBe('compact');
    expect(linkLayout({ image: img })).toBe('compact');
    expect(linkLayout({})).toBe('text');
    // Lo que eligió la persona manda.
    expect(linkLayout({ image: img, imageWidth: 1200, imageHeight: 630 }, 'compact')).toBe('compact');
    expect(linkLayout({ image: img, imageWidth: 1200, imageHeight: 630 }, 'off')).toBe('none');
    expect(linkLayout({}, 'off')).toBe('none');
  });

  it('la imagen grande va entre 4:5 y 2.4:1', () => {
    expect(linkImageRatio(1200, 630)).toBeCloseTo(1.905, 2);
    expect(linkImageRatio(600, 1500)).toBe(0.8);
    expect(linkImageRatio(3000, 300)).toBe(2.4);
    expect(linkImageRatio()).toBeCloseTo(1.91, 2);
  });

  it('WhatsApp manda una miniatura chica: se pide la grande al servidor solo si hace falta', () => {
    const thumb = `data:image/png;base64,${Buffer.from(pngHeader(140, 74)).toString('base64')}`;
    expect(dataUrlSize(thumb)).toEqual({ width: 140, height: 74 });
    const given = fromGiven({ url: 'https://example.test/a', title: 'A', image: thumb })!;
    expect(given.imageWidth).toBe(140);
    expect(needsFetch(given, 'large')).toBe(true);
    expect(needsFetch(given, 'compact')).toBe(false);
    expect(needsFetch(null, 'compact')).toBe(true);
    expect(needsFetch(null, 'off')).toBe(false);
    const big = { url: 'https://example.test/a', title: 'A grande', image: '/api/wa/link-preview/image?url=x', imageWidth: 1200, imageHeight: 630 };
    expect(pickPreview(given, big)?.title).toBe('A grande');
    expect(pickPreview(given, { ...big, imageWidth: 90, imageHeight: 90 })?.title).toBe('A');
    expect(pickPreview(null, { url: 'x', title: '' })).toBeNull();
  });

  it('solo imágenes propias o data URL de imagen, y solo links http(s)', () => {
    expect(safeImage('/api/wa/link-preview/image?url=https%3A%2F%2Fa.test')).toMatch(/^\/api\/wa/);
    expect(safeImage('data:image/png;base64,AAAA')).toBe('data:image/png;base64,AAAA');
    expect(safeImage('data:image/svg+xml;base64,PHN2Zz4=')).toBe('');
    expect(safeImage('https://tracker.test/pixel.gif')).toBe('');
    expect(safeImage('javascript:alert(1)')).toBe('');
    expect(safeHref('javascript:alert(1)')).toBe('');
    expect(safeHref('data:text/html,<script>')).toBe('');
    expect(safeHref('https://example.test/a?b=1')).toBe('https://example.test/a?b=1');
  });
});

describe('lector de vistas previas', () => {
  it('lee las og:image de la página y las medidas que declara', () => {
    const html = `<meta property="og:image" content="/a.png"><meta property="og:image:width" content="1200"><meta property="og:image:height" content="630"><meta property="og:image" content="https://cdn.test/b.jpg"><meta property="og:image" content="/a.png">`;
    expect(parseImageHints(html, 'https://site.test/page')).toEqual({ images: ['https://site.test/a.png', 'https://cdn.test/b.jpg'], width: 1200, height: 630 });
    expect(parseImageHints('<meta property="og:image" content="javascript:alert(1)">', 'https://site.test/')).toEqual({ images: [], width: 0, height: 0 });
  });

  it('guarda las medidas, el ícono y la segunda imagen; la imagen sale de nuestro dominio', async () => {
    const id = Math.random().toString(36).slice(2);
    const big = (await linkPreview(`https://example.test/p/${id}`))!;
    expect(big).toMatchObject({ title: 'example.test page', imageWidth: 1200, imageHeight: 630, image2: '' });
    expect(big.image).toBe(`/api/wa/link-preview/image?url=${encodeURIComponent(`https://example.test/p/${id}`)}`);
    expect(big.favicon).toMatch(/^data:image\/png;base64,/);
    expect(linkLayout(big)).toBe('large');
    const img = (await linkPreviewImage(`https://example.test/p/${id}`, 0))!;
    expect(img.type).toBe('image/png');
    expect(imageSize(img.bytes)).toEqual({ width: 1200, height: 630 });

    const logo = (await linkPreview(`https://example.test/logo/${id}`))!;
    expect([logo.imageWidth, logo.imageHeight]).toEqual([96, 96]);
    expect(linkLayout(logo)).toBe('compact');

    const none = (await linkPreview(`https://example.test/no-image/${id}`))!;
    expect(none.image).toBe('');
    expect(linkLayout(none)).toBe('text');
    expect(await linkPreviewImage(`https://example.test/no-image/${id}`, 0)).toBeNull();

    const gallery = (await linkPreview(`https://example.test/gallery/${id}`))!;
    expect(gallery.image2).toContain('&n=1');
    expect((await linkPreviewImage(`https://example.test/gallery/${id}`, 1))?.type).toBe('image/png');

    expect(await linkPreviewImage('javascript:alert(1)', 0)).toBeNull();
    // La ruta de la imagen nunca sale a la red: un link que nadie pidió no tiene imagen.
    expect(await linkPreviewImage(`https://example.test/never/${id}`, 0)).toBeNull();
  });

  it('una fila guardada por la versión anterior (sin medidas) se vuelve a leer', async () => {
    const url = `https://example.test/old/${Math.random().toString(36).slice(2)}`;
    await getDb()
      .prepare("INSERT INTO wa_link_previews (url, title, description, site, image, fetched_at) VALUES (?, 'Viejo', '', 'example.test', 'data:image/png;base64,AAAA', ?)")
      .run(url, new Date().toISOString());
    const p = (await linkPreview(url))!;
    expect(p.title).toBe('example.test page');
    expect(p.imageWidth).toBe(1200);
  });
});

describe('visualización por persona', () => {
  it('por defecto lo de siempre; se guarda por persona y descarta lo que no es válido', async () => {
    const a = await makeUser('display-a');
    const b = await makeUser('display-b');
    expect(await getChatDisplay(a.id)).toEqual(DEFAULT_DISPLAY);
    const next = patchDisplay(DEFAULT_DISPLAY, { textSize: 'large', linkPreviews: 'compact', groupAvatars: false, density: 'huge', evil: '}body{display:none' });
    expect(next).toEqual({ ...DEFAULT_DISPLAY, textSize: 'large', linkPreviews: 'compact', groupAvatars: false });
    await setChatDisplay(a.id, next);
    expect(await getChatDisplay(a.id)).toEqual(next);
    expect(await getChatDisplay(b.id)).toEqual(DEFAULT_DISPLAY);
    expect(cleanDisplay('{not json')).toEqual(DEFAULT_DISPLAY);
    expect(cleanDisplay(['large'])).toEqual(DEFAULT_DISPLAY);
    expect(patchDisplay(next, null)).toEqual(next);
    expect(isDefaultDisplay(DEFAULT_DISPLAY)).toBe(true);
    expect(isDefaultDisplay(next)).toBe(false);
  });

  it('el CSS sale solo de la tabla: vacío por defecto, cada opción cambia lo suyo', () => {
    expect(displayCss(DEFAULT_DISPLAY)).toBe('');
    const big = displayCss({ ...DEFAULT_DISPLAY, textSize: 'large' });
    expect(big).toContain('--wa-fs-body:0.9787rem');
    expect(big).toContain('--wa-lh-body:21px');
    expect(displayCss({ ...DEFAULT_DISPLAY, mediaSize: 'large' })).toContain('--wa-media-w:400px');
    expect(displayCss({ ...DEFAULT_DISPLAY, density: 'compact' })).toContain('--wa-row-h:52px');
    expect(displayCss({ ...DEFAULT_DISPLAY, groupAvatars: false })).toContain('.wa-sender-avatar{display:none}');
    expect(displayCss({ ...DEFAULT_DISPLAY, wallpaper: 'plain' })).toContain('background-image:none');
    expect(displayCss({ ...DEFAULT_DISPLAY, bubbleWidth: 'wide' })).toContain('max-width:82%');
    // Un valor que no está en la tabla nunca llega al CSS.
    expect(displayCss(cleanDisplay({ textSize: '}</style><script>' }))).toBe('');
  });
});
