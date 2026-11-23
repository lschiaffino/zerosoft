import { describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';
import { addMember, createTeam } from '@/lib/teams';
import { createProject } from '@/lib/track-data';
import { setGuest, setProjectVisibility } from '@/lib/track-access';
import { GROUP_ORDER_MAX, mergeGroupOrder, moveGroupKey, orderGroups, parseGroupOrder, WORKSPACE_ISSUE_GROUPS } from '@/lib/track-views';
import { parseListPrefs, viewPayload, viewSignature, viewToState, type ListPrefs, type ViewState } from '@/lib/track-issue-list';
import { EMPTY_FILTERS } from '@/lib/track-filter';
import { makeUser } from './helpers';

const session = vi.hoisted(() => ({ user: null as null | Record<string, unknown> }));
vi.mock('@/lib/session', () => ({
  getCurrentUser: async () => session.user,
  realUserId: (u: { id: string; actingUser?: { id: string } }) => u.actingUser?.id ?? u.id,
  isWorkspaceAdmin: (u: { role?: string }) => u.role === 'owner' || u.role === 'admin',
}));

const viewsRoute = await import('@/lib/routes/track/projects/[id]/views/route');
const params = (id: string) => ({ params: Promise.resolve({ id }) });
const post = (body: unknown) =>
  new NextRequest('http://x', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) }) as never;
const get = () => new NextRequest('http://x') as never;

const g = (...keys: string[]) => keys.map((key) => ({ key }));
const keys = (list: Array<{ key: string }>) => list.map((x) => x.key);

describe('Track: orden propio de grupos y columnas', () => {
  it('orderGroups: los guardados en su orden y en sus lugares; los nuevos donde caen', () => {
    expect(keys(orderGroups(g('a', 'b', 'c'), ['c', 'a', 'b']))).toEqual(['c', 'a', 'b']);
    // "n" es nuevo (no estaba guardado): queda en su lugar natural.
    expect(keys(orderGroups(g('a', 'n', 'b', 'c'), ['c', 'b', 'a']))).toEqual(['c', 'n', 'b', 'a']);
    // Guardados que hoy no están no molestan; "sin valor" ('') se puede mover como cualquiera.
    expect(keys(orderGroups(g('a', 'b', ''), ['', 'gone', 'a']))).toEqual(['', 'b', 'a']);
    expect(keys(orderGroups(g('a', 'b'), undefined))).toEqual(['a', 'b']);
  });

  it('moveGroupKey y mergeGroupOrder', () => {
    expect(moveGroupKey(['a', 'b', 'c'], 'a', 2)).toEqual(['b', 'c', 'a']);
    expect(moveGroupKey(['a', 'b', 'c'], 'c', 0)).toEqual(['c', 'a', 'b']);
    expect(moveGroupKey(['a', 'b', 'c'], 'b', 99)).toEqual(['a', 'c', 'b']);
    expect(moveGroupKey(['a', 'b', 'c'], 'b', -3)).toEqual(['b', 'a', 'c']);
    expect(moveGroupKey(['a', 'b'], 'x', 0)).toEqual(['a', 'b']);
    // Los guardados que no se ven van detrás, sin repetir.
    expect(mergeGroupOrder(['b', 'a'], ['a', 'hidden', 'b'])).toEqual(['b', 'a', 'hidden']);
    const many = Array.from({ length: 300 }, (_, i) => `k${i}`);
    expect(mergeGroupOrder(many, [])).toHaveLength(GROUP_ORDER_MAX);
  });

  it('parseGroupOrder descarta lo inválido', () => {
    expect(parseGroupOrder(null)).toEqual({});
    expect(parseGroupOrder(['a'])).toEqual({});
    expect(parseGroupOrder({ status: ['a', 'a', 3, 'b'], nope: ['x'], none: ['y'], label: 'z', priority: [] })).toEqual({ status: ['a', 'b'] });
    expect(parseGroupOrder({ assignee: ['x'.repeat(201), 'ok'] })).toEqual({ assignee: ['ok'] });
  });

  it('se recuerda en las preferencias y viaja con la vista guardada (y la marca con cambios)', () => {
    const fallback: ListPrefs = {
      filters: EMPTY_FILTERS,
      group: 'status',
      sort: 'manual',
      layout: 'list',
      showSub: true,
      completed: 'all',
      emptyGroups: false,
      props: ['id'],
    };
    expect(parseListPrefs({ group: 'priority', groupOrder: { priority: ['low', 'urgent'] } }, fallback, WORKSPACE_ISSUE_GROUPS).groupOrder).toEqual({
      priority: ['low', 'urgent'],
    });
    expect(parseListPrefs({ group: 'priority' }, fallback, WORKSPACE_ISSUE_GROUPS).groupOrder).toEqual({});

    const state: ViewState = {
      layout: 'board',
      filters: EMPTY_FILTERS,
      group: 'assignee',
      subGroup: 'none',
      sort: 'manual',
      showSub: true,
      completed: 'all',
      groupOrder: { assignee: ['u2', '', 'u1'] },
    };
    const payload = viewPayload(state);
    expect(payload.filters.groupOrder).toEqual({ assignee: ['u2', '', 'u1'] });
    const back = viewToState({ view_type: payload.viewType, filters: payload.filters, sort: payload.sort }, WORKSPACE_ISSUE_GROUPS, 'status');
    expect(back.groupOrder).toEqual({ assignee: ['u2', '', 'u1'] });
    expect(viewSignature(back)).toBe(viewSignature(state));
    expect(viewSignature({ ...state, groupOrder: { assignee: ['u1', 'u2'] } })).not.toBe(viewSignature(state));
    // Sin orden propio, el cuerpo es el de siempre.
    expect(viewPayload({ ...state, groupOrder: {} }).filters).not.toHaveProperty('groupOrder');
  });

  it('acceso a la vista con orden: anónimo, otro workspace, team privado sin acceso, invitado, miembro y owner', async () => {
    const owner = await makeUser('go-own');
    const member = await makeUser('go-mem');
    const guest = await makeUser('go-gst');
    const stranger = await makeUser('go-str');
    const team = await createTeam(owner.id, 'Acme');
    await addMember(team.id, member.id);
    await addMember(team.id, guest.id);
    const open = await createProject(owner.id, team.id, { name: 'Open', slug: `go-${crypto.randomUUID().slice(0, 6)}` });
    const secret = await createProject(owner.id, team.id, { name: 'Secret', slug: `gs-${crypto.randomUUID().slice(0, 6)}` });
    await setProjectVisibility(secret.id, 'private', owner.id);
    const other = await createProject(owner.id, team.id, { name: 'Other', slug: `gx-${crypto.randomUUID().slice(0, 6)}` });
    await setGuest(team.id, guest.email, [open.id], owner.id);
    const body = { name: 'By priority', viewType: 'list', filters: { groupBy: 'priority', groupOrder: { priority: ['low', 'urgent'] } }, sort: 'manual', shared: true };

    session.user = null;
    expect((await viewsRoute.POST(post(body), params(open.id))).status).toBe(401);
    session.user = { ...stranger, team: null, role: 'owner' };
    expect((await viewsRoute.POST(post(body), params(open.id))).status).toBe(404);
    session.user = { ...member, id: owner.id, actingUser: member, team, role: 'member' };
    expect((await viewsRoute.POST(post(body), params(secret.id))).status).toBe(404);
    session.user = { ...guest, id: owner.id, actingUser: guest, team, role: 'member' };
    expect((await viewsRoute.POST(post(body), params(other.id))).status).toBe(404);

    // Miembro: la guarda con su orden; el owner la ve compartida con el mismo orden.
    session.user = { ...member, id: owner.id, actingUser: member, team, role: 'member' };
    const created = await viewsRoute.POST(post(body), params(open.id));
    expect(created.status).toBe(201);
    const view = (await created.json()) as { id: string; filters: Record<string, unknown> };
    expect(view.filters.groupOrder).toEqual({ priority: ['low', 'urgent'] });
    session.user = { ...owner, team, role: 'owner' };
    const rows = ((await (await viewsRoute.GET(get(), params(open.id))).json()) as { rows: Array<{ id: string; filters: Record<string, unknown> }> }).rows;
    expect(rows.find((r) => r.id === view.id)?.filters.groupOrder).toEqual({ priority: ['low', 'urgent'] });
    // El invitado de Open también la ve (es de su team); el miembro sin acceso al privado no ve las del privado.
    session.user = { ...guest, id: owner.id, actingUser: guest, team, role: 'member' };
    expect((await viewsRoute.GET(get(), params(open.id))).status).toBe(200);
    session.user = { ...member, id: owner.id, actingUser: member, team, role: 'member' };
    expect((await viewsRoute.GET(get(), params(secret.id))).status).toBe(404);
    session.user = null;
  });
});
