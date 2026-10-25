import { describe, expect, it } from 'vitest';
import { groupIssues, scopeStatusIds } from '@/lib/track-views';

const statuses = [
  { id: 'b', category: 'backlog' },
  { id: 't', category: 'todo' },
  { id: 'p', category: 'in_progress' },
  { id: 'd', category: 'done' },
  { id: 'c', category: 'cancelled' },
];

describe('pestañas del team (All / Active / Backlog) y completados', () => {
  it('All con completados no filtra', () => {
    expect(scopeStatusIds(statuses, 'all', true)).toBeNull();
  });
  it('Active son los por hacer y empezados; Backlog solo backlog', () => {
    expect(scopeStatusIds(statuses, 'active', true)).toEqual(['t', 'p']);
    expect(scopeStatusIds(statuses, 'backlog', true)).toEqual(['b']);
  });
  it('ocultar completados saca terminados y cancelados', () => {
    expect(scopeStatusIds(statuses, 'all', false)).toEqual(['b', 't', 'p']);
  });
  it('sin status posibles devuelve un id que no matchea nada', () => {
    expect(scopeStatusIds([{ id: 'd', category: 'done' }], 'active', true)).toEqual(['__none__']);
  });
});

describe('grupos por estado como Linear', () => {
  const issue = (status_id: string, category: string, name: string) =>
    ({
      id: `${status_id}-${Math.random()}`,
      project_id: 'p1',
      status_id,
      status_name: name,
      status_color: '#000000',
      status_category: category,
      assignee_id: null,
      assignee_name: null,
      assignee_email: null,
      priority: 'none',
      cycle_id: null,
      cycle_name: null,
      labels: '[]',
    }) as never;
  it('lo empezado primero, backlog después de por hacer y lo terminado al final', () => {
    const rows = [issue('d', 'done', 'Done'), issue('b', 'backlog', 'Backlog'), issue('t', 'todo', 'Todo'), issue('p', 'in_progress', 'In Progress')];
    const full = statuses.map((s) => ({ ...s, name: s.id, color: '#000000' }));
    expect(groupIssues(rows, 'status', { statuses: full, activeFirst: true }).map((g) => g.key)).toEqual(['p', 't', 'b', 'd']);
  });
});

import { treeRoots } from '@/lib/track-views';

describe('árbol de sub-issues en listas agrupadas', () => {
  it('agrupa por raíz y expande los descendientes bajo su padre', () => {
    const rows = [
      { id: 'c', parent_id: 'p' },
      { id: 'p', parent_id: null },
      { id: 'g', parent_id: 'c' },
      { id: 'x', parent_id: 'fuera' },
    ];
    const { roots, expand } = treeRoots(rows);
    expect(roots.map((r) => r.id)).toEqual(['p', 'x']);
    expect(expand([rows[1]]).map((r) => r.id)).toEqual(['p', 'c', 'g']);
  });
});
