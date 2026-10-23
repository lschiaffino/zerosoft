import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { PARITY } from '@/content/feature-parity';
import type { ParityRow } from '@/content/feature-parity/types';
import { computeAreas, computeParity, loc, validateParity } from '@/lib/feature-parity';
import { ideaForCapability } from '@/lib/feature-parity-ideas';
import { PRODUCT_KEYS } from '@/lib/products';

const row = (status: ParityRow['status'], competitorHas = true, weight?: 1 | 2, area = 'a'): ParityRow => ({
  id: `r-${Math.random().toString(36).slice(2, 8)}`,
  area,
  label: { en: 'x', es: 'x', pt: 'x' },
  status,
  competitorHas,
  weight,
});

describe('computeParity', () => {
  it('have y better valen 1, partial 0,5, missing 0', () => {
    const s = computeParity([row('have'), row('better'), row('partial'), row('missing')]);
    expect(s.percent).toBe(62); // 2,5 / 4 = 62,5 → 62
    expect(s).toMatchObject({ counted: 4, have: 2, partial: 1, missing: 1, beyond: 0 });
  });

  it('nunca redondea para arriba', () => {
    // 2 de 3 = 66,67 → 66
    expect(computeParity([row('have'), row('have'), row('missing')]).percent).toBe(66);
    // 29 de 100 exacto (sin error de coma flotante)
    const rows = [...Array.from({ length: 29 }, () => row('have')), ...Array.from({ length: 71 }, () => row('missing'))];
    expect(computeParity(rows).percent).toBe(29);
  });

  it('el peso 2 cuenta doble', () => {
    expect(computeParity([row('have', true, 2), row('missing')]).percent).toBe(66);
    expect(computeParity([row('missing', true, 2), row('have')]).percent).toBe(33);
  });

  it('solo cuentan las filas que el competidor tiene', () => {
    const s = computeParity([row('have'), row('missing'), row('better', false), row('have', false)]);
    expect(s.percent).toBe(50);
    expect(s.counted).toBe(2);
    expect(s.beyond).toBe(1);
  });

  it('sin filas que cuenten da 0', () => {
    expect(computeParity([]).percent).toBe(0);
    expect(computeParity([row('better', false)]).percent).toBe(0);
  });

  it('por área, en el orden de areas', () => {
    const areas = computeAreas({
      competitor: 'X',
      lastReviewed: '2026-10-22',
      areas: [
        { id: 'b', label: { en: 'B', es: 'B', pt: 'B' } },
        { id: 'a', label: { en: 'A', es: 'A', pt: 'A' } },
      ],
      rows: [row('have', true, 1, 'a'), row('partial', true, 1, 'b'), row('missing', true, 1, 'b')],
    });
    expect(areas.map((a) => [a.id, a.percent])).toEqual([
      ['b', 25],
      ['a', 100],
    ]);
  });

  it('loc cae a inglés', () => {
    expect(loc({ en: 'Hi', es: 'Hola', pt: 'Oi' }, 'es')).toBe('Hola');
    expect(loc({ en: 'Hi', es: 'Hola', pt: 'Oi' }, 'fr')).toBe('Hi');
  });
});

describe('archivos de paridad', () => {
  it('hay uno por producto', () => {
    expect(Object.keys(PARITY).sort()).toEqual([...PRODUCT_KEYS].sort());
  });

  it.each(PRODUCT_KEYS)('%s tiene forma válida y filas que cuentan', (key) => {
    const p = PARITY[key];
    expect(validateParity(p)).toEqual([]);
    expect(p.competitor.trim()).not.toBe('');
    const s = computeParity(p.rows);
    expect(s.counted).toBeGreaterThan(10);
    expect(s.percent).toBeGreaterThan(0);
    expect(s.percent).toBeLessThan(100);
    // Las parciales dicen qué hay y qué no.
    for (const r of p.rows.filter((x) => x.status === 'partial')) expect(r.detail, `${key}:${r.id}`).toBeTruthy();
    // Una fila que el competidor no tiene y nosotros tampoco no tiene sentido.
    for (const r of p.rows) expect(r.status === 'missing' && !r.competitorHas, `${key}:${r.id}`).toBe(false);
  });
});

/**
 * Mantener viva la paridad: una idea de research/ideas.json hecha (status
 * "done") que apunta a una capacidad (`parity`) no puede dejar esa capacidad
 * como faltante. Al construirla, se actualiza content/feature-parity/<product>.ts.
 */
describe('ideas hechas contra la paridad', () => {
  const ideas = JSON.parse(readFileSync(join(__dirname, '..', '..', 'research', 'ideas.json'), 'utf8')) as Array<{
    title: string;
    product: string;
    status?: string;
    parity?: string;
  }>;

  it('cada `parity` apunta a una capacidad que existe', () => {
    const bad = ideas
      .filter((i) => i.parity)
      .filter((i) => !(i.product in PARITY) || !PARITY[i.product as keyof typeof PARITY].rows.some((r) => r.id === i.parity))
      .map((i) => `${i.product}:${i.parity} (${i.title})`);
    expect(bad).toEqual([]);
  });

  it('ninguna idea hecha apunta a una capacidad marcada missing', () => {
    const bad = ideas
      .filter((i) => i.status === 'done' && i.parity && i.product in PARITY)
      .filter((i) => PARITY[i.product as keyof typeof PARITY].rows.find((r) => r.id === i.parity)?.status === 'missing')
      .map((i) => `${i.product}:${i.parity} (${i.title})`);
    expect(bad).toEqual([]);
  });

  it('ideaForCapability prefiere la idea abierta', () => {
    const list = [
      { title: 'old', product: 'docs', status: 'done', parity: 'x' },
      { title: 'open', product: 'docs', parity: 'x' },
    ];
    expect(ideaForCapability('docs', 'x', list)?.title).toBe('open');
    expect(ideaForCapability('docs', 'y', list)).toBeUndefined();
  });
});
