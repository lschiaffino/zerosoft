import { describe, expect, it } from 'vitest';
import { linkPreviewOf } from '@/lib/groups-provider-bridge';
import { fakePng } from '@/lib/groups-provider-fake';
import { linkLayout } from '@/lib/chat-display';
import { decryptWaMedia, downloadLinkHq, encryptWaMedia, linkHqBytes, linkHqOf, publicLink, type StoredLink } from '@/lib/wa-link-thumb';
import { fromGiven, linkFromMeta, pickPreview, safeImage } from '@/components/groups/wa/link-preview-data';

/**
 * La imagen grande de la vista previa de un link que manda WhatsApp (lugares
 * de Maps, notas con foto): referencia en el mensaje, descifrado, guardado y
 * qué tarjeta se dibuja. Datos inventados.
 */

const KEY = Buffer.alloc(32, 5).toString('base64');
const EXT = {
  text: 'Nos vemos acá https://maps.example/place/salon',
  matchedText: 'https://maps.example/place/salon',
  title: 'Salón de prueba',
  description: '★★★★★ · Salón de eventos',
  jpegThumbnail: Buffer.from([0xff, 0xd8, 0xff, 0xd9]).toString('base64'),
  thumbnailDirectPath: '/o1/v/t24/f2/m233/AQ_prueba?ccb=9-4&oh=01_x&oe=6800&_nc_sid=e6ed6c',
  thumbnailWidth: 1200,
  thumbnailHeight: 630,
  mediaKey: KEY,
};

describe('linkHqOf', () => {
  it('toma la ruta, la clave y las medidas de la imagen grande', () => {
    expect(linkHqOf(EXT)).toEqual({ directPath: EXT.thumbnailDirectPath, mediaKey: KEY, width: 1200, height: 630 });
    expect(linkPreviewOf(EXT)?.hq?.width).toBe(1200);
  });

  it('sin clave de 32 bytes o con una ruta que no es de WhatsApp, nada', () => {
    expect(linkHqOf({ ...EXT, mediaKey: Buffer.alloc(8).toString('base64') })).toBeUndefined();
    expect(linkHqOf({ ...EXT, thumbnailDirectPath: 'https://evil.example/x' })).toBeUndefined();
    expect(linkHqOf({ ...EXT, thumbnailDirectPath: undefined })).toBeUndefined();
  });
});

describe('descifrado como WhatsApp', () => {
  it('ida y vuelta, y una firma que no da devuelve null', () => {
    const png = fakePng(64, 40, 1);
    const enc = encryptWaMedia(png, KEY);
    expect(decryptWaMedia(enc, KEY)).toEqual(png);
    const bad = Buffer.from(enc);
    bad[3] ^= 1;
    expect(decryptWaMedia(bad, KEY)).toBeNull();
    expect(decryptWaMedia(enc, Buffer.alloc(32, 6).toString('base64'))).toBeNull();
  });

  it('baja solo de mmg.whatsapp.net, descifra y verifica que sea una imagen', async () => {
    const png = fakePng(1200, 630, 1);
    const asked: string[] = [];
    const hq = await downloadLinkHq(linkHqOf(EXT)!, async (url) => {
      asked.push(url);
      return new Response(new Uint8Array(encryptWaMedia(png, KEY)));
    });
    expect(asked).toEqual([`https://mmg.whatsapp.net${EXT.thumbnailDirectPath}`]);
    expect(hq).toMatchObject({ width: 1200, height: 630 });
    expect(hq!.image.startsWith('data:image/png;base64,')).toBe(true);
    // Algo que no es imagen, o que no responde: null.
    expect(await downloadLinkHq(linkHqOf(EXT)!, async () => new Response(new Uint8Array(encryptWaMedia(Buffer.from('<html>'), KEY))))).toBeNull();
    expect(await downloadLinkHq(linkHqOf(EXT)!, async () => new Response('', { status: 404 }))).toBeNull();
  });
});

describe('lo que va al navegador', () => {
  const stored: StoredLink = {
    url: EXT.matchedText,
    title: EXT.title,
    description: EXT.description,
    thumb: 'data:image/jpeg;base64,/9j/',
    hqRef: linkHqOf(EXT),
    hq: { image: `data:image/png;base64,${fakePng(1200, 630, 1).toString('base64')}`, width: 1200, height: 630 },
  };

  it('sin la clave ni los bytes; la imagen grande por la ruta del mensaje', () => {
    const pub = publicLink(stored, '/api/inbox/media/ibm_1?link=1')!;
    expect(pub).not.toHaveProperty('hq');
    expect(pub).not.toHaveProperty('hqRef');
    expect(pub).toMatchObject({ image: '/api/inbox/media/ibm_1?link=1', imageWidth: 1200, imageHeight: 630 });
    expect(linkHqBytes(stored)?.type).toBe('image/png');
    expect(publicLink({ ...stored, hq: undefined }, '/x')).not.toHaveProperty('image');
  });

  it('la ruta del mensaje es una imagen permitida; otros hosts no', () => {
    expect(safeImage('/api/inbox/media/ibm_1?link=1')).toBe('/api/inbox/media/ibm_1?link=1');
    expect(safeImage('/api/groups/media/abc-1?link=1')).toBe('/api/groups/media/abc-1?link=1');
    expect(safeImage('/api/inbox/media/ibm_1')).toBe('');
    expect(safeImage('https://maps.example/x.jpg')).toBe('');
  });
});

describe('qué tarjeta se dibuja', () => {
  it('imagen grande de WhatsApp: la grande, sin pedirle nada al servidor', () => {
    const given = linkFromMeta({ link: publicLink({ url: EXT.matchedText, title: EXT.title, hq: { image: 'data:', width: 1200, height: 630 } }, '/api/groups/media/m1?link=1') });
    expect(given).toMatchObject({ image: '/api/groups/media/m1?link=1', imageWidth: 1200, imageHeight: 630 });
    expect(linkLayout(fromGiven(given)!)).toBe('large');
    // Aunque el servidor traiga otra grande, se queda la de WhatsApp.
    expect(pickPreview(fromGiven(given), { url: EXT.matchedText, title: 'otra', image: '/api/wa/link-preview/image?url=x', imageWidth: 1200, imageHeight: 630 })?.title).toBe(EXT.title);
  });

  it('miniatura chica o cuadrada: la compacta', () => {
    expect(linkLayout({ image: 'x', imageWidth: 96, imageHeight: 96 })).toBe('compact');
    expect(linkLayout({ image: 'x', imageWidth: 400, imageHeight: 400 })).toBe('compact');
    expect(linkLayout({ image: 'x', imageWidth: 1200, imageHeight: 630 })).toBe('large');
    expect(linkFromMeta({ link: { url: 'https://a.example', title: 'A', thumb: 'data:image/jpeg;base64,/9j/' } })).toMatchObject({ image: 'data:image/jpeg;base64,/9j/' });
    expect(linkFromMeta({})).toBeNull();
  });
});
