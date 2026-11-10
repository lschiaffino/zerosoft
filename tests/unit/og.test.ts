import { describe, expect, it } from 'vitest';
import { artLayers } from '@/lib/og/art';
import { clampText, fitText, formatDuration, lineCount, textEm, titleTracking } from '@/lib/og/text';
import { OG_VERSION, isOgCard, ogHash, ogImages, ogMeta, ogMetaAbsolute, ogUrl } from '@/lib/og/url';
import { imageMime, visibleDurationMs } from '@/lib/og/shared-cards';
import { firstSentence } from '@/lib/og/cards';
import { pageMetadata } from '@/lib/seo';

describe('dibujo de las tarjetas', () => {
  const box = { cols: 118, rows: 31, cx: 98, cy: 15, size: 66, driftEnd: 56 };

  it('es determinístico por semilla y cambia entre semillas', () => {
    expect(artLayers('product:crm', box)).toEqual(artLayers('product:crm', box));
    expect(artLayers('product:crm', box)).not.toEqual(artLayers('product:docs', box));
  });

  it('una capa por nivel de luz, cada una dentro de la grilla', () => {
    const layers = artLayers('home', box);
    expect(layers).toHaveLength(5);
    for (const layer of layers) {
      const lines = layer.split('\n');
      expect(lines).toHaveLength(box.rows);
      for (const line of lines) expect(line.length).toBeLessThanOrEqual(box.cols);
    }
    // El cero está: la capa más brillante tiene caracteres.
    expect(layers[4].replace(/\s/g, '').length).toBeGreaterThan(20);
  });

  it('el polvo no invade la columna del texto', () => {
    const layers = artLayers('blog:x', box);
    for (const layer of layers) {
      for (const line of layer.split('\n')) expect(line.slice(0, box.driftEnd).trim()).toBe('');
    }
  });
});

describe('texto de las tarjetas', () => {
  it('mide con los anchos de Space Grotesk', () => {
    expect(textEm('i')).toBeLessThan(textEm('m'));
    expect(textEm('ñ')).toBeCloseTo(0.615, 2);
    // Fuera de la tabla (CJK, emoji): 0.6 em.
    expect(textEm('字')).toBe(0.6);
  });

  it('el título más grande que entra; los largos bajan de tamaño', () => {
    expect(fitText('CRM', 620, 3).size).toBe(104);
    const long = fitText('How we replaced Zapier with a 300-line workflow engine and stopped paying per task', 620, 3);
    expect(long.size).toBeLessThan(104);
    expect(lineCount(long.text, long.size, 620, titleTracking(long.size))).toBeLessThanOrEqual(3);
  });

  it('si no entra ni en el más chico, corta en palabra con …', () => {
    const r = fitText('palabra '.repeat(60), 620, 3);
    expect(r.text.endsWith('…')).toBe(true);
    expect(r.text).not.toMatch(/\s…$/);
    expect(lineCount(r.text, r.size, 620, titleTracking(r.size))).toBeLessThanOrEqual(3);
    expect(clampText('uno dos tres cuatro', 10)).toBe('uno dos…');
  });

  it('duración de un video', () => {
    expect(formatDuration(42_000)).toBe('0:42');
    expect(formatDuration(725_000)).toBe('12:05');
    expect(formatDuration(3_729_000)).toBe('1:02:09');
    expect(formatDuration(0)).toBe('');
    expect(visibleDurationMs(120, 10, 60)).toBe(50_000);
    expect(visibleDurationMs(120, 0, null)).toBe(120_000);
  });

  it('primera frase para la línea corta', () => {
    expect(firstSentence('Contacts and deals. It syncs Gmail.')).toBe('Contacts and deals.');
    expect(firstSentence('Sin punto final')).toBe('Sin punto final');
  });
});

describe('URLs versionadas', () => {
  it('el hash cambia con el contenido y con la versión del diseño', () => {
    expect(ogHash(['a'])).toBe(ogHash(['a']));
    expect(ogHash(['a'])).not.toBe(ogHash(['b']));
    expect(OG_VERSION).toMatch(/^\d+$/);
  });

  it('ancha y cuadrada, con medidas, alt y tipo', () => {
    const [wide, square] = ogImages('/api/og/product/crm/es', 'CRM', ['t']);
    expect(wide).toMatchObject({ width: 1200, height: 630, alt: 'CRM', type: 'image/png' });
    expect(wide.url).toMatch(/^\/api\/og\/product\/crm\/es\?v=[0-9a-z]+$/);
    expect(square).toMatchObject({ width: 1200, height: 1200 });
    expect(square.url).toBe(`${wide.url}&f=sq`);
  });

  it('no toca imágenes que no son tarjetas', () => {
    expect(ogUrl('https://cdn.example.com/foto.jpg')).toBe('https://cdn.example.com/foto.jpg');
    expect(isOgCard('/api/og/home/en')).toBe(true);
    expect(isOgCard('https://zerosoft.ai/api/og/home/en?v=1')).toBe(true);
    expect(isOgCard('/uploads/x.png')).toBe(false);
  });

  it('twitter summary_large_image con la ancha; absolutas fuera del sitio', () => {
    const og = ogMeta('/api/og/rec/abc', 'Video', undefined);
    expect(og.twitter.card).toBe('summary_large_image');
    expect(og.twitter.images[0].url).toBe(og.images[0].url);
    const abs = ogMetaAbsolute('https://app.example.com/', '/api/og/job/acme/dev', 'Dev', 'd');
    expect(abs.images[0].url).toMatch(/^https:\/\/app\.example\.com\/api\/og\/job\/acme\/dev\?v=/);
    expect(abs.twitter.images[0].url).toBe(abs.images[0].url);
  });

  it('pageMetadata versiona la tarjeta y respeta una imagen propia', () => {
    const a = pageMetadata({ locale: 'en', path: '/x', title: 'Uno', description: 'd', image: '/api/og/page/en/docs' });
    const b = pageMetadata({ locale: 'en', path: '/x', title: 'Dos', description: 'd', image: '/api/og/page/en/docs' });
    const url = (m: typeof a) => (m.openGraph as { images: { url: string }[] }).images[0].url;
    expect(url(a)).not.toBe(url(b));
    const own = pageMetadata({ locale: 'en', path: '/x', title: 'Uno', description: 'd', image: 'https://cdn.example.com/a.png' });
    expect((own.openGraph as { images: unknown[] }).images).toHaveLength(1);
  });
});

describe('fotos para la tarjeta de video', () => {
  it('acepta PNG y JPEG; WebP y otros, no', () => {
    expect(imageMime(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0]))).toBe('image/png');
    expect(imageMime(Buffer.from([0xff, 0xd8, 0xff, 0xe0]))).toBe('image/jpeg');
    expect(imageMime(Buffer.from('RIFF....WEBP'))).toBeNull();
  });
});
