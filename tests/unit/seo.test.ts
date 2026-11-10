import { describe, expect, it } from 'vitest';
import { alternatesFor, articleLd, clampDescription, faqLd, pageMetadata, siteVerification, softwareLd } from '@/lib/seo';
import { compareSlugs, competitorSlug, findComparison, getComparisons, gapRows, rivalMatches } from '@/lib/compare';
import { PARITY } from '@/content/feature-parity';
import { computeParity } from '@/lib/feature-parity';
import { PRODUCT_KEYS } from '@/lib/products';
import { STATIC_PAGES } from '@/lib/seo-routes';
import { localizeLinks, tagSlug } from '@/lib/blog';
import { clampText, fitTitle } from '@/lib/og/text';

describe('clampDescription', () => {
  it('deja igual lo que entra', () => {
    expect(clampDescription('Corta.')).toBe('Corta.');
  });
  it('corta en la última frase completa si es larga', () => {
    const first = 'Una primera frase que tiene bastante largo para quedarse sola en la descripción.';
    const out = clampDescription(`${first} ${'Y otra frase que ya no entra de ninguna manera en el resultado final '.repeat(3)}.`);
    expect(out).toBe(first);
  });
  it('sin frase corta, corta en una palabra con puntos suspensivos', () => {
    const out = clampDescription('palabra '.repeat(40));
    expect(out.length).toBeLessThanOrEqual(160);
    expect(out.endsWith('palabra…')).toBe(true);
  });
  it('pageMetadata nunca deja pasar una descripción larga', () => {
    const meta = pageMetadata({ locale: 'en', path: '/x', title: 'X', description: 'word '.repeat(80) });
    expect(String(meta.description).length).toBeLessThanOrEqual(160);
  });
});

describe('apps "Próximamente"', () => {
  it('el sitio no dice "en construcción" fuera de las claves de Próximamente', async () => {
    const { readFileSync } = await import('node:fs');
    for (const locale of ['en', 'es', 'pt']) {
      // Las claves "building" son los textos de las apps Próximamente.
      const common = JSON.parse(readFileSync(`messages/${locale}/common.json`, 'utf8'));
      const text = JSON.stringify(common, (k, v) => (k === 'building' ? undefined : v));
      expect(text, locale).not.toMatch(/In the works|En construcción|Em construção/);
    }
  });
  it('las cuentas de apps del sitio son las disponibles, sin las Próximamente', async () => {
    const { AVAILABLE_PRODUCT_KEYS, COMING_SOON_APPS, PRODUCT_KEYS } = await import('@/lib/products');
    const { readFileSync } = await import('node:fs');
    expect(AVAILABLE_PRODUCT_KEYS.length + COMING_SOON_APPS.length).toBe(PRODUCT_KEYS.length);
    const words: Record<string, string> = { 19: 'nineteen|diecinueve|dezenove' };
    const word = words[AVAILABLE_PRODUCT_KEYS.length];
    expect(word, 'agregá la palabra de la cuenta nueva').toBeTruthy();
    for (const locale of ['en', 'es', 'pt']) {
      const tagline = JSON.parse(readFileSync(`messages/${locale}/common.json`, 'utf8')).meta.tagline as string;
      expect(tagline.toLowerCase(), locale).toMatch(new RegExp(word));
    }
  });
});

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
    // Sin imagen propia, la del home en el idioma, versionada, ancha y cuadrada.
    expect(og.images[0]).toMatchObject({ width: 1200, height: 630, type: 'image/png', alt: 'CRM' });
    expect(og.images[0].url).toMatch(/^\/api\/og\/home\/es\?v=[0-9a-z]+$/);
    expect(og.images[1]).toMatchObject({ width: 1200, height: 1200 });
    expect(og.images[1].url).toMatch(/[?&]f=sq/);
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
    expect(fitTitle('CRM', 620, 3)).toBeGreaterThan(fitTitle('Cómo pasar tus contactos de HubSpot a un CRM open source sin perder el historial', 620, 3));
    const cut = clampText('uno dos tres cuatro cinco seis', 14);
    expect(cut).toBe('uno dos tres…');
  });
});
