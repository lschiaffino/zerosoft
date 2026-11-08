import { describe, expect, it } from 'vitest';
import { INTENT_FRESH_MS, intentTarget, needsPrefetch } from '@/lib/intent-prefetch';

const here = { origin: 'https://zerosoft.ai', pathname: '/es/app/track', search: '' };

describe('intentTarget (qué links del sidebar se precargan)', () => {
  it('precarga otra página de la app, con su query', () => {
    expect(intentTarget({ href: 'https://zerosoft.ai/es/app/docs' }, here)).toBe('/es/app/docs');
    expect(intentTarget({ href: '/en/app/crm/contacts?view=1' }, here)).toBe('/en/app/crm/contacts?view=1');
    expect(intentTarget({ href: '/pt/app' }, here)).toBe('/pt/app');
  });

  it('no precarga la página actual, fuera de la app, APIs, otros orígenes, otra pestaña ni descargas', () => {
    expect(intentTarget({ href: '/es/app/track' }, here)).toBeNull();
    expect(intentTarget({ href: '/es/blog' }, here)).toBeNull();
    expect(intentTarget({ href: '/api/crm/export' }, here)).toBeNull();
    expect(intentTarget({ href: 'https://evil.example/es/app/docs' }, here)).toBeNull();
    expect(intentTarget({ href: '/es/app/docs', target: '_blank' }, here)).toBeNull();
    expect(intentTarget({ href: '/es/app/docs', hasDownload: true }, here)).toBeNull();
    expect(intentTarget({ href: '/es/application' }, here)).toBeNull();
  });
});

describe('needsPrefetch', () => {
  it('pide la primera vez y otra vez solo cuando venció', () => {
    expect(needsPrefetch(undefined, 1000)).toBe(true);
    expect(needsPrefetch(1000, 1000 + INTENT_FRESH_MS - 1)).toBe(false);
    expect(needsPrefetch(1000, 1000 + INTENT_FRESH_MS)).toBe(true);
  });
});
