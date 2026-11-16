import { describe, expect, it } from 'vitest';
import { MAX_HOPS, followToPage, metaRefreshTarget, parseImageHints, parseLinkMeta, type PageHop } from '@/lib/docs-unfurl';
import { linkLayout } from '@/lib/chat-display';
import { needsFetch, pickPreview } from '@/components/groups/wa/link-preview-data';

/**
 * Link corto (de una tienda, por ejemplo) que redirige a la página del
 * producto: se sigue hasta el final y de ahí salen el título, la descripción
 * y la imagen. Sitios inventados.
 */

const PRODUCT = `<html><head>
  <title>Tienda</title>
  <meta property="og:title" content="Silla de prueba plegable">
  <meta property="og:description" content="Silla plegable de madera, envío en el día. Hasta 12 cuotas.">
  <meta property="og:image" content="/img/silla.jpg">
  <meta property="og:image:width" content="800"><meta property="og:image:height" content="800">
  <meta property="og:site_name" content="Tienda de prueba">
</head></html>`;

function web(pages: Record<string, PageHop>) {
  const asked: string[] = [];
  const get = async (url: string) => {
    asked.push(url);
    return pages[url] ?? null;
  };
  return { get, asked };
}

describe('followToPage', () => {
  it('sigue redirecciones 30x y un meta refresh hasta la página del producto', async () => {
    const { get, asked } = web({
      'https://corto.example/abc': { status: 301, location: 'https://www.tienda.example/sec/abc' },
      'https://www.tienda.example/sec/abc': { status: 302, location: '/ir?id=7' },
      'https://www.tienda.example/ir?id=7': { status: 200, html: '<meta http-equiv="refresh" content="0; url=https://articulo.tienda.example/p/silla">' },
      'https://articulo.tienda.example/p/silla': { status: 200, html: PRODUCT },
    });
    const page = await followToPage('https://corto.example/abc', get);
    expect(asked).toHaveLength(4);
    expect(page?.finalUrl).toBe('https://articulo.tienda.example/p/silla');
    const meta = parseLinkMeta(page!.html, page!.finalUrl);
    expect(meta).toMatchObject({ title: 'Silla de prueba plegable', description: expect.stringContaining('Silla plegable'), site: 'Tienda de prueba' });
    // La imagen relativa se resuelve contra la página final, no contra el link corto.
    expect(meta.image).toBe('https://articulo.tienda.example/img/silla.jpg');
    const hints = parseImageHints(page!.html, page!.finalUrl);
    // Cuadrada y grande, como la foto de un producto: la tarjeta grande.
    expect(linkLayout({ image: meta.image, imageWidth: hints.width, imageHeight: hints.height })).toBe('large');
  });

  it('corta los bucles, los saltos de más y lo que no responde', async () => {
    const loop = web({ 'https://a.example/': { status: 302, location: 'https://b.example/' }, 'https://b.example/': { status: 302, location: 'https://a.example/' } });
    expect(await followToPage('https://a.example/', loop.get)).toBeNull();
    const chain: Record<string, PageHop> = {};
    for (let i = 0; i < MAX_HOPS + 3; i++) chain[`https://c.example/${i}`] = { status: 302, location: `https://c.example/${i + 1}` };
    const long = web(chain);
    expect(await followToPage('https://c.example/0', long.get)).toBeNull();
    expect(long.asked.length).toBeLessThanOrEqual(MAX_HOPS + 1);
    expect(await followToPage('https://nada.example/', web({}).get)).toBeNull();
    // Un destino que no es http(s) no se sigue.
    expect(await followToPage('https://d.example/', web({ 'https://d.example/': { status: 302, location: 'file:///etc/passwd' } }).get)).toBeNull();
  });
});

describe('metaRefreshTarget', () => {
  it('solo los inmediatos, con la URL absoluta', () => {
    expect(metaRefreshTarget('<meta http-equiv="refresh" content="0;URL=\'/p/1\'">', 'https://x.example/a')).toBe('https://x.example/p/1');
    expect(metaRefreshTarget('<meta http-equiv="refresh" content="300; url=/p/1">', 'https://x.example/a')).toBeUndefined();
    expect(metaRefreshTarget('<meta name="description" content="0; url=/p/1">', 'https://x.example/a')).toBeUndefined();
  });
});

describe('cuál vista previa se muestra', () => {
  const siteOnly = { url: 'https://corto.example/abc', title: 'Tienda' };
  const full = { url: 'https://corto.example/abc', title: 'Silla de prueba plegable', description: 'Silla plegable', image: '/api/wa/link-preview/image?url=x', imageWidth: 800, imageHeight: 800 };

  it('la de WhatsApp con solo el nombre del sitio pide la del servidor y la del servidor gana', () => {
    expect(needsFetch(siteOnly, 'large')).toBe(true);
    expect(needsFetch(siteOnly, 'compact')).toBe(true);
    expect(pickPreview(siteOnly, full)).toBe(full);
    expect(pickPreview(siteOnly, null)).toBe(siteOnly);
  });
});
