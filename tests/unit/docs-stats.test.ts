import { describe, expect, it } from 'vitest';
import { pageStats } from '@/lib/docs-stats';
import type { DocsBlock } from '@/lib/docs-types';

const p = (content: string): DocsBlock => ({ id: Math.random().toString(36), type: 'paragraph', content }) as DocsBlock;

describe('pageStats', () => {
  it('cuenta título y bloques sin el HTML inline', () => {
    const s = pageStats('Plan de lanzamiento', [p('Hola <b>mundo</b> otra vez'), p('')]);
    expect(s.words).toBe(7);
    expect(s.characters).toBe('Plan de lanzamiento Hola mundo otra vez'.length);
  });

  it('una página vacía da cero y 0 minutos', () => {
    expect(pageStats('', [p('')])).toEqual({ words: 0, characters: 0, minutes: 0 });
  });

  it('redondea los minutos y nunca baja de 1 si hay texto', () => {
    expect(pageStats('', [p('uno dos tres')]).minutes).toBe(1);
    expect(pageStats('', [p(Array(600).fill('a').join(' '))]).minutes).toBe(3);
  });

  it('cuenta las celdas de una tabla', () => {
    const t = { id: 't', type: 'table', rows: [['a b', 'c'], ['d', 'e']] } as DocsBlock;
    expect(pageStats('', [t]).words).toBe(5);
  });

  it('ignora las bases de datos', () => {
    const d = { id: 'd', type: 'database' } as DocsBlock;
    expect(pageStats('x', [d]).words).toBe(1);
  });
});
