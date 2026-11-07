import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { PRODUCT_KEYS } from '@/lib/products';
import { Cells, NO_INPUT, stillFrame } from '@/lib/zero-art/engine';
import { PRODUCT_FIGURES, type FigureRef } from '@/lib/zero-art/catalog';
import { makeFigure } from '@/lib/zero-art/figures';

const OTHERS: FigureRef[] = [['notfound', ''], ['field', '']];
const ALL = [...Object.values(PRODUCT_FIGURES), ...OTHERS];

function frame(ref: FigureRef, t: number) {
  const f = makeFigure(ref);
  const c = new Cells(f.cols, f.rows);
  f.draw(c, t, NO_INPUT);
  return c.text();
}

describe('figuras de ceros', () => {
  it('cada app tiene su figura y su epígrafe en los tres idiomas', () => {
    expect(Object.keys(PRODUCT_FIGURES).sort()).toEqual([...PRODUCT_KEYS].sort());
    for (const locale of ['es', 'en', 'pt']) {
      const product = JSON.parse(readFileSync(`messages/${locale}/pages.json`, 'utf8')).product;
      for (const key of PRODUCT_KEYS) {
        expect(product.heroFig[key]).toMatch(/^fig\. 0 · /);
        expect(product.heroFig[key]).not.toContain('—');
      }
    }
  });

  it.each(ALL.map((ref) => [ref.join(':'), ref] as const))('%s: grilla exacta, solo la rampa y sin azar', (_name, ref) => {
    const f = makeFigure(ref);
    const still = stillFrame(f);
    const rows = still.split('\n');
    expect(rows).toHaveLength(f.rows);
    for (const row of rows) expect([...row]).toHaveLength(f.cols);
    expect(still).toMatch(/^[ ·°o0Ø\n]+$/);
    // El servidor y el cliente tienen que dar el mismo texto.
    expect(stillFrame(makeFigure(ref))).toBe(still);
    // El cuadro quieto tiene que mostrar algo.
    expect(still.replace(/\s/g, '').length).toBeGreaterThan(40);
  });

  it.each(ALL.map((ref) => [ref.join(':'), ref] as const))('%s: se mueve', (_name, ref) => {
    const f = makeFigure(ref);
    expect(frame(ref, f.still + 2)).not.toBe(frame(ref, f.still));
  });

  it('las figuras que ocupan todo el ancho aguantan cualquier grilla', () => {
    for (const ref of [['field', '']] as FigureRef[]) {
      const f = makeFigure(ref);
      for (const [cols, rows] of [[30, 8], [160, 40]]) {
        const c = new Cells(cols, rows);
        f.draw(c, 3, { dragX: 0, dragY: 0, x: 10, y: 4 });
        expect(c.text().split('\n')).toHaveLength(rows);
      }
    }
  });

  it('un cuadro cuesta menos de 4 ms', () => {
    for (const ref of ALL) {
      const f = makeFigure(ref);
      const c = new Cells(f.cols, f.rows);
      const start = performance.now();
      for (let n = 0; n < 40; n++) {
        f.draw(c, n * 0.1, NO_INPUT);
        c.text();
      }
      expect((performance.now() - start) / 40).toBeLessThan(4);
    }
  });
});
