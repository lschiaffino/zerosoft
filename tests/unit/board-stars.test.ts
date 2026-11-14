import { describe, expect, it } from 'vitest';
import { starredFirst } from '@/lib/board-stars-order';

const boards = [{ id: 'a' }, { id: 'b' }, { id: 'c' }, { id: 'd' }];

describe('starredFirst', () => {
  it('pone las destacadas arriba y conserva el orden en cada grupo', () => {
    expect(starredFirst(boards, new Set(['c', 'a'])).map((b) => b.id)).toEqual(['a', 'c', 'b', 'd']);
  });
  it('sin estrellas deja la lista igual', () => {
    expect(starredFirst(boards, new Set()).map((b) => b.id)).toEqual(['a', 'b', 'c', 'd']);
  });
  it('ignora ids destacados que ya no están', () => {
    expect(starredFirst(boards, new Set(['zzz'])).map((b) => b.id)).toEqual(['a', 'b', 'c', 'd']);
  });
  it('no modifica el arreglo original', () => {
    const copy = [...boards];
    starredFirst(boards, new Set(['d']));
    expect(boards).toEqual(copy);
  });
});
