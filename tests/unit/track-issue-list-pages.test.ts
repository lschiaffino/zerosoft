import { describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';
import { getDb } from '@/lib/db';
import { createIssue, createProject, listAllIssues, listStatuses, SUBGROUP_SEP } from '@/lib/track-data';
import { createListView, deleteListView, isListKey, listListViews, updateListView } from '@/lib/track-list-views';
import {
  countsByStatusName,
  listQuery,
  stateFromParams,
  stateToParams,
  viewPayload,
  viewSignature,
  viewToState,
  type ViewState,
} from '@/lib/track-issue-list';
import { EMPTY_FILTERS } from '@/lib/track-filter';
import { groupDropTarget, WORKSPACE_ISSUE_GROUPS } from '@/lib/track-views';
import { makeUser } from './helpers';

const session = vi.hoisted(() => ({ user: null as null | Record<string, unknown> }));
vi.mock('@/lib/session', () => ({
  getCurrentUser: async () => session.user,
  realUserId: (u: { id: string; actingUser?: { id: string } }) => u.actingUser?.id ?? u.id,
}));

const issuesRoute = await import('@/app/api/track/issues/route');
const listViewsRoute = await import('@/app/api/track/list-views/route');

type Page = { rows: Array<{ id: string }>; total: number; groupCounts?: Record<string, number>; subGroupCounts?: Record<string, number> };

async function getPage(qs: string): Promise<Page> {
  const res = await issuesRoute.GET(new NextRequest(`http://x/api/track/issues?${qs}`));
  expect(res.status).toBe(200);
  return (await res.json()) as Page;
}

describe('lista de issues: páginas sin tope y totales por grupo', () => {
  it('la API pagina más allá de 500 issues y cuenta cada grupo y sub-grupo', async () => {
    const u = await makeUser('pages');
    session.user = { id: u.id, team: null };
    const team = await createProject(u.id, null, { name: 'Muchos' });
    const statuses = await listStatuses(team.id);
    const done = statuses.find((s) => s.category === 'done')!;
    const db = getDb();
    for (let i = 0; i < 520; i++) {
      await createIssue(team.id, u.id, { title: `Issue ${i}`, description: [], priority: i % 2 ? 'high' : 'low' }, { source: 'app' });
    }
    // 20 cerrados, con un label.
    const ids = (await db.prepare('SELECT id FROM track_issues WHERE project_id = ? ORDER BY created_at LIMIT 20').all(team.id)) as Array<{ id: string }>;
    for (const { id } of ids) {
      await db.prepare('UPDATE track_issues SET status_id = ?, labels = ? WHERE id = ?').run(done.id, JSON.stringify([{ id: 'lab-1', name: 'Bug', color: '#f00' }]), id);
    }

    const base = `projectId=${team.id}&pageSize=100&sort=oldest&groupBy=status&subGroupBy=priority`;
    const seen = new Set<string>();
    let first: Page | null = null;
    for (let page = 1; page <= 6; page++) {
      const data = await getPage(`${base}&page=${page}`);
      first ??= data;
      expect(data.total).toBe(520);
      expect(data.rows).toHaveLength(page < 6 ? 100 : 20);
      for (const r of data.rows) seen.add(r.id);
    }
    expect(seen.size).toBe(520);
    expect(first!.groupCounts![done.id]).toBe(20);
    const todo = statuses.find((s) => s.id !== done.id && first!.groupCounts![s.id]);
    expect(first!.groupCounts![todo!.id]).toBe(500);
    expect(first!.subGroupCounts![`${todo!.id}${SUBGROUP_SEP}high`]).toBe(250);

    // Label (un issue por label; sin label = '') y "sin completados".
    const byLabel = await listAllIssues(null, u.id, { projectId: team.id, groupBy: 'label', pageSize: 1 });
    expect(byLabel.groupCounts).toEqual({ 'lab-1': 20, '': 500 });
    const open = await getPage(`projectId=${team.id}&pageSize=1&completed=none&groupBy=status`);
    expect(open.total).toBe(500);
    expect(open.groupCounts![done.id]).toBeUndefined();
    // Pestaña Active de un team: solo esos status.
    const only = await getPage(`projectId=${team.id}&pageSize=1&statusId=${done.id}`);
    expect(only.total).toBe(20);
  }, 120_000);
});

describe('lista de issues: vistas, URL y destinos de arrastre', () => {
  const state: ViewState = {
    layout: 'board',
    filters: { match: 'and', rules: [{ field: 'priority', op: 'is', values: ['high'] }], q: 'x' },
    group: 'status',
    subGroup: 'assignee',
    sort: 'priority',
    showSub: false,
    completed: 'week',
  };

  it('una vista guardada vuelve con lo mismo (y las viejas sin agrupado van por status)', () => {
    const p = viewPayload(state);
    const back = viewToState({ view_type: p.viewType, filters: p.filters, sort: p.sort }, WORKSPACE_ISSUE_GROUPS, 'status');
    expect(viewSignature(back)).toBe(viewSignature(state));
    const old = viewToState({ view_type: 'list', filters: { groupBy: '', match: 'and', rules: [] }, sort: 'newest' }, WORKSPACE_ISSUE_GROUPS, 'status');
    expect(old).toMatchObject({ group: 'status', subGroup: 'none', showSub: true, completed: 'all', layout: 'list' });
  });

  it('la URL del team guarda la vista y se lee igual', () => {
    const sp = stateToParams({ ...state, scope: 'active' }, { group: 'status', sort: 'newest' });
    expect(sp.get('view')).toBe('board');
    expect(sp.get('scope')).toBe('active');
    expect(sp.get('group')).toBeNull();
    const back = stateFromParams(sp, WORKSPACE_ISSUE_GROUPS)!;
    expect(back).toMatchObject({ layout: 'board', subGroup: 'assignee', sort: 'priority', showSub: false, completed: 'week', scope: 'active' });
    expect(back.filters?.rules).toHaveLength(1);
    expect(stateFromParams(new URLSearchParams('savedView=abc'), WORKSPACE_ISSUE_GROUPS)).toBeNull();
  });

  it('la consulta pide los totales del agrupado y el sub-agrupado', () => {
    const q = new URLSearchParams(listQuery({ projectId: 't1' }, EMPTY_FILTERS, 'manual', '2026-11-07', { groupBy: 'status', subGroupBy: 'priority', topLevel: true, completed: 'none', statusIds: ['a', 'b'] }));
    expect(q.get('groupBy')).toBe('status');
    expect(q.get('subGroupBy')).toBe('priority');
    expect(q.get('topLevel')).toBe('1');
    expect(q.get('completed')).toBe('none');
    expect(q.get('statusId')).toBe('a,b');
    expect(new URLSearchParams(listQuery({}, EMPTY_FILTERS, 'manual', '2026-11-07', { groupBy: 'status', subGroupBy: 'status' })).get('subGroupBy')).toBeNull();
  });

  it('suma status de varios teams por nombre y arma los destinos de arrastre', () => {
    const statuses = [
      { id: 'a', name: 'Todo' },
      { id: 'b', name: 'Todo' },
      { id: 'c', name: 'Done' },
    ];
    expect(countsByStatusName({ a: 2, b: 3, c: 1 }, statuses, 'name:')).toEqual({ 'name:todo': 5, 'name:done': 1 });
    expect(groupDropTarget('status', 'a')).toBe('status:a');
    expect(groupDropTarget('status', 'name:Todo', true)).toBeUndefined();
    expect(groupDropTarget('planMilestone', '')).toBe('planMilestone:none');
    expect(groupDropTarget('label', 'x')).toBeUndefined();
  });
});

describe('vistas personales de las listas', () => {
  it('son de cada persona y por lista; la API valida la clave', async () => {
    const u = await makeUser('views');
    const other = await makeUser('views2');
    const v = await createListView(u.id, '', 'mine:assigned', { name: 'Urgentes', viewType: 'list', filters: { groupBy: 'priority' }, sort: 'priority' });
    expect((await listListViews(u.id, '', 'mine:assigned')).map((x) => x.name)).toEqual(['Urgentes']);
    expect(await listListViews(u.id, '', 'workspace-issues')).toEqual([]);
    expect(await listListViews(other.id, '', 'mine:assigned')).toEqual([]);
    expect(await updateListView(v.id, other.id, { name: 'Robada' })).toBeUndefined();
    expect((await updateListView(v.id, u.id, { name: 'Altas' }))?.name).toBe('Altas');
    expect(await deleteListView(v.id, other.id)).toBe(false);
    expect(isListKey('plan:3f1c-uuid')).toBe(true);
    expect(isListKey('../x')).toBe(false);

    session.user = { id: u.id, team: null };
    const created = await listViewsRoute.POST(
      new NextRequest('http://x/api/track/list-views', { method: 'POST', body: JSON.stringify({ key: 'workspace-issues', name: 'Mía', filters: {} }) }),
    );
    expect(created.status).toBe(201);
    const bad = await listViewsRoute.POST(new NextRequest('http://x/api/track/list-views', { method: 'POST', body: JSON.stringify({ key: '../x', name: 'X' }) }));
    expect(bad.status).toBe(400);
    const rows = (await (await listViewsRoute.GET(new NextRequest('http://x/api/track/list-views?key=workspace-issues'))).json()) as { rows: Array<{ id: string }> };
    expect(rows.rows).toHaveLength(1);
    session.user = { id: other.id, team: null };
    const del = await listViewsRoute.DELETE(new NextRequest(`http://x/api/track/list-views?id=${rows.rows[0].id}`, { method: 'DELETE' }));
    expect(del.status).toBe(404);
  });
});
