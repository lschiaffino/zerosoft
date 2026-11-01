import { describe, expect, it } from 'vitest';
import { alternatesFor, articleLd, faqLd, pageMetadata, siteVerification, softwareLd } from '@/lib/seo';
import { compareSlugs, competitorSlug, findComparison, getComparisons, gapRows, rivalMatches } from '@/lib/compare';
import { PARITY } from '@/content/feature-parity';
import { computeParity } from '@/lib/feature-parity';
import { PRODUCT_KEYS } from '@/lib/products';
import { STATIC_PAGES } from '@/lib/seo-routes';
import { localizeLinks, tagSlug } from '@/lib/blog';
import { clampText, titleSize } from '@/lib/og-text';

describe('pageMetadata', () => {
  it('pone canonical, hreflang de los tres idiomas y x-default al inglés', () => {
    const meta = pageMetadata({ locale: 'es', path: '/products/crm', title: 'CRM', description: 'd' });
    expect(meta.alternates?.canonical).toBe('/es/products/crm');
    expect(meta.alternates?.languages).toEqual({
      en: '/en/products/crm',
      es: '/es/products/crm',
      pt: '/pt/products/crm',
      'x-default': '/en/products/crm',
    });
    const og = meta.openGraph as { url: string; locale: string; images: { url: string; width: number }[] };
    expect(og.url).toBe('/es/products/crm');
    expect(og.locale).toBe('es_AR');
    expect(og.images[0]).toMatchObject({ url: '/api/og/home', width: 1200 });
    expect((meta.twitter as { card: string }).card).toBe('summary_large_image');
    expect(meta.robots).toBeUndefined();
  });

  it('el home es /<locale> y su título va sin el template', () => {
    const meta = pageMetadata({ locale: 'pt', path: '', title: 'zerosoft: x', description: 'd', absoluteTitle: true });
    expect(meta.alternates?.canonical).toBe('/pt');
    expect(meta.title).toEqual({ absolute: 'zerosoft: x' });
  });

  it('limita hreflang a los idiomas en que existe la página; x-default cae al primero', () => {
    const alt = alternatesFor('/blog/tag/precios', 'es', ['es']);
    expect(alt.languages).toEqual({ es: '/es/blog/tag/precios', 'x-default': '/es/blog/tag/precios' });
  });

  it('noindex deja seguir los links', () => {
    expect(pageMetadata({ locale: 'en', path: '/x', title: 't', description: 'd', noindex: true }).robots).toEqual({ index: false, follow: true });
  });

  it('artículos: tipo article con fechas', () => {
    const og = pageMetadata({ locale: 'en', path: '/blog/x', title: 't', description: 'd', type: 'article', publishedTime: '2026-10-31' })
      .openGraph as { type: string; publishedTime: string; modifiedTime: string };
    expect(og).toMatchObject({ type: 'article', publishedTime: '2026-10-31', modifiedTime: '2026-10-31' });
  });
});

describe('verificación de buscadores', () => {
  it('sin variables no imprime nada', () => {
    expect(siteVerification({})).toBeUndefined();
  });
  it('Google, Bing (msvalidate.01) y Yandex desde el entorno', () => {
    expect(siteVerification({ GOOGLE_SITE_VERIFICATION: ' g1 ', BING_SITE_VERIFICATION: 'b1', YANDEX_SITE_VERIFICATION: 'y1' })).toEqual({
      google: 'g1',
      yandex: 'y1',
      other: { 'msvalidate.01': 'b1' },
    });
  });
});

describe('JSON-LD', () => {
  it('SoftwareApplication con las dos ofertas reales y sin rating', () => {
    const ld = softwareLd({ locale: 'en', name: 'zerosoft CRM', description: 'd', path: '/products/crm' });
    expect(ld.offers.map((o) => o.price)).toEqual(['0', '0']);
    expect(ld.license).toContain('agpl');
    expect(ld).not.toHaveProperty('aggregateRating');
  });
  it('FAQPage con preguntas y respuestas', () => {
    expect(faqLd([{ q: 'a?', a: 'b' }]).mainEntity[0]).toEqual({ '@type': 'Question', name: 'a?', acceptedAnswer: { '@type': 'Answer', text: 'b' } });
  });
  it('BlogPosting con URL absoluta e imagen', () => {
    const ld = articleLd({
      locale: 'es',
      path: '/blog/x',
      title: 't',
      description: 'd',
      published: '2026-10-01',
      image: '/api/og/blog/es/x',
      tags: ['crm'],
      author: { name: 'zerosoft', path: '/blog/author/zerosoft' },
    });
    expect(ld.mainEntityOfPage).toMatch(/^https?:\/\/[^/]+\/es\/blog\/x$/);
    expect(ld.image).toMatch(/\/api\/og\/blog\/es\/x$/);
    expect(ld.dateModified).toBe('2026-10-01');
  });
});

describe('comparaciones', () => {
  it('slugs de competidor', () => {
    expect(competitorSlug('HubSpot')).toBe('hubspot');
    expect(competitorSlug('Excalidraw+')).toBe('excalidraw-plus');
    expect(competitorSlug('Wispr Flow + Granola')).toBe('wispr-flow-granola');
    expect(competitorSlug('Intercom Fin')).toBe('intercom-fin');
  });

  it('una página vs y una alternative por app, sin repetir', () => {
    const slugs = compareSlugs();
    expect(slugs).toHaveLength(PRODUCT_KEYS.length * 2);
    expect(new Set(slugs).size).toBe(slugs.length);
    for (const s of slugs) expect(s).toMatch(/^[a-z0-9-]+$/);
  });

  it('el porcentaje es el de la tabla de paridad (se actualiza solo)', () => {
    for (const c of getComparisons()) {
      expect(c.competitor).toBe(PARITY[c.product].competitor);
      expect(c.score.percent).toBe(computeParity(PARITY[c.product].rows).percent);
      expect(findComparison(c.vsSlug)).toEqual({ kind: 'vs', comparison: c });
      expect(findComparison(c.altSlug)).toEqual({ kind: 'alternative', comparison: c });
    }
    expect(findComparison('zerosoft-vs-nadie')).toBeNull();
  });

  it('lo que falta sale de la tabla, con lo central primero', () => {
    const gaps = gapRows('crm');
    expect(gaps.every((r) => r.competitorHas && r.status !== 'have' && r.status !== 'better')).toBe(true);
    const weights = gaps.map((r) => r.weight ?? 1);
    expect([...weights].sort((a, b) => b - a)).toEqual(weights);
  });

  it('el precio citado solo se muestra contra el mismo competidor', () => {
    expect(rivalMatches('HubSpot', 'HubSpot')).toBe(true);
    expect(rivalMatches('Dub', 'Bitly')).toBe(false);
    expect(rivalMatches('Intercom', 'Intercom Fin')).toBe(false);
  });
});

describe('páginas fijas', () => {
  it('rutas únicas', () => {
    const paths = Object.values(STATIC_PAGES).map((p) => p.path);
    expect(new Set(paths).size).toBe(paths.length);
  });
});

describe('blog: links y tags', () => {
  it('pone el idioma en los links internos y deja el resto', () => {
    const html = '<a href="/blog/x">a</a><a href="/es/products">b</a><a href="https://x.com/y">c</a><a href="/api/v1">d</a><a href="/">e</a><a href="#h">f</a>';
    expect(localizeLinks(html, 'pt')).toBe(
      '<a href="/pt/blog/x">a</a><a href="/es/products">b</a><a href="https://x.com/y">c</a><a href="/api/v1">d</a><a href="/pt">e</a><a href="#h">f</a>',
    );
  });
  it('slug de tag sin acentos', () => {
    expect(tagSlug('Migración')).toBe('migracion');
    expect(tagSlug('self-hosting')).toBe('self-hosting');
    expect(tagSlug('Automatização ')).toBe('automatizacao');
  });
});

describe('tarjeta OG', () => {
  it('títulos largos: letra más chica y corte en palabra', () => {
    expect(titleSize('CRM')).toBeGreaterThan(titleSize('Cómo pasar tus contactos de HubSpot a un CRM open source sin perder el historial'));
    const cut = clampText('uno dos tres cuatro cinco seis', 14);
    expect(cut).toBe('uno dos tres…');
  });
});
