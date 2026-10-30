import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { PRODUCT_CONFIG, PRODUCT_KEYS, productNumber, productRgb } from '@/lib/products';
import { AUDIENCE_PRODUCTS, PRODUCT_PAGES, RIVALS } from '@/components/site/catalog';
import { generateProductOGSVG } from '@/lib/product-og';

const root = join(__dirname, '..', '..');
const LOCALES = ['es', 'en', 'pt'] as const;

type Json = Record<string, unknown>;
const messages = (locale: string, ns: string): Json =>
  JSON.parse(readFileSync(join(root, 'messages', locale, `${ns}.json`), 'utf8')) as Json;

function get(obj: Json, path: string): unknown {
  return path.split('.').reduce<unknown>((o, k) => (o && typeof o === 'object' ? (o as Json)[k] : undefined), obj);
}

describe('catálogo del sitio', () => {
  it('los colores de lib/products.ts coinciden con las variables --c-* de globals.css', () => {
    const css = readFileSync(join(root, 'styles', 'globals.css'), 'utf8');
    for (const key of PRODUCT_KEYS) {
      const m = css.match(new RegExp(`--c-${key}:\\s*(#[0-9a-fA-F]{6})`));
      expect(m?.[1]?.toLowerCase(), key).toBe(PRODUCT_CONFIG[key].color);
    }
  });

  it('cada app está en una audiencia, tiene rival y página', () => {
    const listed = [...AUDIENCE_PRODUCTS.teams, ...AUDIENCE_PRODUCTS.personal].sort();
    expect(listed).toEqual([...PRODUCT_KEYS].sort());
    for (const key of PRODUCT_KEYS) {
      expect(RIVALS[key], key).toBeTruthy();
      expect(PRODUCT_PAGES[key].sections.length, key).toBeGreaterThan(2);
    }
  });

  it('las páginas no comparten todas el mismo esqueleto', () => {
    const shapes = new Set(PRODUCT_KEYS.map((k) => PRODUCT_PAGES[k].sections.join(',')));
    expect(shapes.size).toBeGreaterThan(5);
  });

  it('helpers de color y numeración', () => {
    expect(productRgb('crm')).toBe('123,77,255');
    expect(productNumber(PRODUCT_KEYS[0])).toBe('01');
    expect(productNumber(PRODUCT_KEYS[10])).toBe('11');
  });

  it('la imagen OG se tiñe con el color del producto', () => {
    const svg = generateProductOGSVG('notes', 'Notes', '09', undefined, PRODUCT_CONFIG.notes.color);
    expect(svg).toContain(PRODUCT_CONFIG.notes.color);
    expect(svg.startsWith('<svg')).toBe(true);
  });
});

describe.each(LOCALES)('copy de las páginas de producto (%s)', (locale) => {
  const pages = messages(locale, 'pages');
  const common = messages(locale, 'common');
  const videos = messages(locale, 'videos');

  it.each(PRODUCT_KEYS)('%s tiene todas las claves que usa su página', (key) => {
    const spec = PRODUCT_PAGES[key];
    const p = `products.${key}`;
    const required = [
      `${p}.meta.title`,
      `${p}.meta.description`,
      `${p}.hero.sub`,
      `${p}.featuresTitle`,
      `${p}.featuresTitleDim`,
      ...['rival', 'price', 'per', 'team', 'zero', 'note'].map((f) => `${p}.compare.${f}`),
      ...['title1', 'title2', 'sub', 'button'].map((f) => `${p}.cta.${f}`),
      ...Array.from({ length: spec.features }, (_, i) => [`${p}.f${i + 1}.t`, `${p}.f${i + 1}.d`]).flat(),
      ...Array.from({ length: spec.faqs }, (_, i) => [`${p}.faq.f${i + 1}.q`, `${p}.faq.f${i + 1}.a`]).flat(),
      ...(spec.sections.includes('how') ? ['s1', 's2', 's3'].flatMap((s) => [`${p}.steps.${s}.t`, `${p}.steps.${s}.d`]) : []),
    ];
    for (const path of required) expect(get(pages, path), path).toBeTypeOf('string');
    expect(get(pages, `mockups.${key}`), `mockups.${key}`).toBeTypeOf('object');
    expect(get(common, `products.${key}.desc`)).toBeTypeOf('string');
    expect(get(common, `header.desc.${key}`)).toBeTypeOf('string');
    expect(get(common, `home.suite.${key}.line`)).toBeTypeOf('string');
    if (spec.sections.includes('video')) expect(get(videos, `items.${key}.title`)).toBeTypeOf('string');
  });

  it('el copy nuevo no usa rayas largas', () => {
    for (const key of ['agents', 'flow', 'robots', 'notes', 'board', 'voice', 'rec', 'talk', 'design']) {
      expect(JSON.stringify(get(pages, `products.${key}`))).not.toContain('—');
    }
  });
});
