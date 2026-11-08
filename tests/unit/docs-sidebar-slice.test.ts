import { describe, expect, it } from 'vitest';
import { sidebarChildren, sidebarSlice } from '@/lib/docs-sidebar';
import type { DocsPageSummary } from '@/lib/docs-types';

const p = (id: string, parent: string | null, updated = '2026-11-01'): DocsPageSummary => ({ id, parent_id: parent, title: id, icon: null, position: null, updated_at: updated });

describe('Docs: sidebar liviano (primer nivel y rama abierta)', () => {
  const all = [p('a', null), p('a1', 'a'), p('a11', 'a1'), p('a12', 'a1'), p('a2', 'a'), p('b', null), p('b1', 'b', '2026-11-05'), p('orphan', 'gone')];

  it('sin página abierta: solo el primer nivel, con cuántas hijas tiene cada una', () => {
    const s = sidebarSlice(all);
    expect(s.pages.map((x) => [x.id, x.child_count])).toEqual([
      ['a', 2],
      ['b', 1],
      ['orphan', 0],
    ]);
    expect(s.total).toBe(8);
    expect(s.recent[0].id).toBe('b1');
  });

  it('con una página abierta: su rama (ancestros y hermanas) y sus hijas', () => {
    expect(sidebarSlice(all, 'a1').pages.map((x) => x.id)).toEqual(['a', 'a1', 'a11', 'a12', 'a2', 'b', 'orphan']);
    expect(sidebarSlice(all, 'a11').pages.map((x) => x.id)).toEqual(['a', 'a1', 'a11', 'a12', 'a2', 'b', 'orphan']);
  });

  it('al desplegar: las hijas con su cantidad de hijas', () => {
    expect(sidebarChildren(all, 'a').map((x) => [x.id, x.child_count])).toEqual([
      ['a1', 2],
      ['a2', 0],
    ]);
  });
});
