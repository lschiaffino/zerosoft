import { describe, expect, it } from 'vitest';
import { OSI_LICENSES, SOFTWARE_DIRECTORY, licenseUrl } from '@/content/software-directory';
import { categoryLd, categoryVars } from '@/lib/software-directory';
import { RESERVED_SLUGS } from '@/lib/reserved';
import { isProductKey } from '@/lib/products';

const all = SOFTWARE_DIRECTORY.flatMap((c) => [...c.openSource, ...(c.sourceAvailable ?? []), ...c.paid]);

describe('content/software-directory', () => {
  it('slugs únicos, en minúscula y con al menos una app de zerosoft', () => {
    const slugs = SOFTWARE_DIRECTORY.map((c) => c.slug);
    expect(new Set(slugs).size).toBe(slugs.length);
    for (const c of SOFTWARE_DIRECTORY) {
      expect(c.slug).toMatch(/^[a-z0-9]+(-[a-z0-9]+)*$/);
      expect(c.apps.length, c.slug).toBeGreaterThan(0);
      for (const k of c.apps) expect(isProductKey(k), `${c.slug}: ${k}`).toBe(true);
      expect(c.openSource.length, c.slug).toBeGreaterThan(0);
      expect(c.paid.length, c.slug).toBeGreaterThan(0);
    }
  });

  it('textos en los tres idiomas', () => {
    for (const c of SOFTWARE_DIRECTORY) {
      for (const field of [c.name, c.title, c.summary]) {
        for (const l of ['en', 'es', 'pt'] as const) expect(field[l], `${c.slug}.${l}`).toBeTruthy();
      }
    }
  });

  it('open source: licencia aprobada por la OSI; source-available: licencia que no lo es; pagos sin licencia', () => {
    for (const c of SOFTWARE_DIRECTORY) {
      for (const p of c.openSource) expect((OSI_LICENSES as readonly string[]).includes(p.license ?? ''), `${c.slug}: ${p.name}`).toBe(true);
      for (const p of c.sourceAvailable ?? []) {
        expect(p.license, p.name).toBeTruthy();
        expect(licenseUrl(p.license!), p.name).toBeNull();
        expect(p.source, p.name).toBeTruthy();
      }
      for (const p of c.paid) {
        expect(p.license, p.name).toBeUndefined();
        expect(p.source, p.name).toBeUndefined();
      }
    }
  });

  it('URLs https y sin nombres repetidos dentro de una categoría', () => {
    for (const p of all) {
      expect(p.url, p.name).toMatch(/^https:\/\//);
      if (p.source) expect(p.source, p.name).toMatch(/^https:\/\/github\.com\/[^/]+\/[^/]+$/);
    }
    for (const c of SOFTWARE_DIRECTORY) {
      const names = [...c.openSource, ...(c.sourceAvailable ?? []), ...c.paid].map((p) => p.name);
      expect(new Set(names).size, c.slug).toBe(names.length);
    }
  });

  it('sin precios en los datos', () => {
    expect(JSON.stringify(SOFTWARE_DIRECTORY)).not.toMatch(/\$\s?\d|USD|€/);
  });

  it('"software" es un slug reservado (no lo puede tomar un workspace)', () => {
    expect(RESERVED_SLUGS.has('software')).toBe(true);
  });
});

describe('JSON-LD de una categoría', () => {
  it('ItemList con zerosoft primero y cada producto listado', () => {
    const c = SOFTWARE_DIRECTORY[0];
    const [page] = categoryLd(c, 'en', { title: 't', description: 'd', appDescriptions: {} }) as unknown as [
      { '@type': string; mainEntity: { numberOfItems: number; itemListElement: { position: number; item: { name?: string; '@id'?: string } }[] } },
    ];
    expect(page['@type']).toBe('CollectionPage');
    const items = page.mainEntity.itemListElement;
    expect(page.mainEntity.numberOfItems).toBe(items.length);
    expect(items.length).toBe(c.apps.length + c.openSource.length + (c.sourceAvailable?.length ?? 0) + c.paid.length);
    expect(items[0].item['@id']).toContain('#software');
    expect(items.map((i) => i.position)).toEqual(items.map((_, i) => i + 1));
  });

  it('variables de los textos en el idioma de la página', () => {
    const v = categoryVars(SOFTWARE_DIRECTORY[0], 'es');
    expect(v.paid).toBe(SOFTWARE_DIRECTORY[0].paid[0].name);
    expect(v.paidNames).toContain(' y ');
  });
});
