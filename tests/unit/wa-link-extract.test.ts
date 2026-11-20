import { describe, expect, it } from 'vitest';
import { parseImageHints, parseLinkMeta } from '@/lib/docs-unfurl';

/**
 * De dónde sale la imagen de la tarjeta de un link (Inbox y Lines): HTML de
 * prueba, sin red. Sitios inventados.
 */

const page = (head: string) => `<!doctype html><html><head><title>Evento de prueba</title>${head}</head><body></body></html>`;

describe('imagen de la vista previa', () => {
  it('resuelve una og:image relativa contra la URL final', () => {
    const html = page('<meta property="og:image" content="/img/portada.png">');
    expect(parseLinkMeta(html, 'https://eventos.example/e/charla').image).toBe('https://eventos.example/img/portada.png');
    expect(parseImageHints(html, 'https://eventos.example/e/charla').candidates).toEqual(['https://eventos.example/img/portada.png']);
    // Relativa a la carpeta, sin barra al principio.
    expect(parseLinkMeta(page('<meta property="og:image" content="portada.jpg">'), 'https://eventos.example/e/charla').image).toBe('https://eventos.example/e/portada.jpg');
  });

  it('sin og:image usa twitter:image (también relativa y con name=)', () => {
    const html = page('<meta name="twitter:card" content="summary_large_image"><meta name="twitter:image" content="/tw.jpg">');
    expect(parseLinkMeta(html, 'https://eventos.example/e/1').image).toBe('https://eventos.example/tw.jpg');
    expect(parseLinkMeta(page('<meta name="twitter:image:src" content="https://cdn.example/a.png">'), 'https://eventos.example/').image).toBe('https://cdn.example/a.png');
  });

  it('usa og:image:secure_url, <link rel="image_src"> e itemprop="image" como respaldo, en ese orden', () => {
    expect(parseLinkMeta(page('<meta property="og:image:secure_url" content="https://cdn.example/s.png">'), 'https://x.example/').image).toBe('https://cdn.example/s.png');
    expect(parseLinkMeta(page('<link rel="image_src" href="/src.png">'), 'https://x.example/a/b').image).toBe('https://x.example/src.png');
    expect(parseLinkMeta(page('<meta itemprop="image" content="/schema.png">'), 'https://x.example/').image).toBe('https://x.example/schema.png');
    const all = page(
      '<meta itemprop="image" content="/schema.png"><link rel="image_src" href="/src.png"><meta name="twitter:image" content="/tw.png"><meta property="og:image:secure_url" content="/sec.png"><meta property="og:image" content="/og.png">',
    );
    expect(parseImageHints(all, 'https://x.example/').candidates).toEqual([
      'https://x.example/og.png',
      'https://x.example/sec.png',
      'https://x.example/tw.png',
      'https://x.example/src.png',
      'https://x.example/schema.png',
    ]);
  });

  it('la grilla de dos sale solo de og:image repetido, no de la misma imagen en twitter:image', () => {
    const html = page('<meta property="og:image" content="http://x.example/a.png"><meta property="og:image:secure_url" content="https://x.example/a.png"><meta name="twitter:image" content="/tw.png">');
    const hints = parseImageHints(html, 'https://x.example/');
    expect(hints.images).toEqual(['http://x.example/a.png']);
    expect(hints.candidates).toHaveLength(3);
  });

  it('sin imagen: nada (ni un ícono ni un esquema que no sea http)', () => {
    const html = page('<meta property="og:title" content="Solo título"><link rel="icon" href="/favicon.ico"><meta name="twitter:image" content="javascript:alert(1)"><meta property="og:image" content="data:image/png;base64,AAAA">');
    const meta = parseLinkMeta(html, 'https://x.example/');
    expect(meta.title).toBe('Solo título');
    expect(meta.image).toBeUndefined();
    expect(parseImageHints(html, 'https://x.example/')).toEqual({ images: [], candidates: [], width: 0, height: 0 });
  });
});
