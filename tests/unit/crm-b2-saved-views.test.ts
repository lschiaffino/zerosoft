/**
 * CRM, bloque B2: vistas guardadas de los listados (pestañas, compartir,
 * columnas) y sus permisos. Los datos son inventados.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';
import { createCustomField, createDeal, createPipeline, createStage, listDealsForBoard } from '@/lib/crm';
import { getDb } from '@/lib/db';
import { MEMBER_SUBJECT, setFieldPermissions } from '@/lib/crm-field-perms';
import { createSalesTeam, setSalesTeamMembers } from '@/lib/crm-visibility';
import { listViewContext, sessionViewViewer } from '@/lib/crm-views';
import {
  DEFAULT_VIEWS,
  addTab,
  canEditView,
  canSeeView,
  closeTab,
  moveTab,
  normalizeTabs,
  orderedColumns,
  pickViewState,
  redactViewQuery,
  resolveViewState,
  togglePin,
  type ViewViewer,
} from '@/lib/crm-views-shared';
import type { SessionUser } from '@/lib/session';
import { asMember, asOwner, roles, workspaceWithMember } from './access-helpers';

const session = vi.hoisted(() => ({ user: null as SessionUser | null }));
vi.mock('@/lib/session', async (orig) => ({
  ...((await orig()) as object),
  getCurrentUser: async () => session.user,
}));
vi.mock('next/cache', () => ({ revalidatePath: () => undefined }));
vi.mock('next/server', async (orig) => ({ ...((await orig()) as object), after: () => undefined }));

const viewsRoute = await import('@/app/api/crm/views/route');
const viewRoute = await import('@/lib/routes/crm/views/[id]/route');
const tabsRoute = await import('@/app/api/crm/views/tabs/route');

beforeEach(() => {
  session.user = null;
});

const json = (url: string, method: string, body: unknown) =>
  new NextRequest(url, { method, headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
const get = (url: string) => new NextRequest(url);
const ctx = (id: string) => ({ params: Promise.resolve({ id }) });

interface ViewOut {
  id: string;
  name: string;
  visibility: string;
  mine: boolean;
  canEdit: boolean;
  query: Record<string, string>;
}

async function create(user: SessionUser, body: Record<string, unknown>): Promise<Response> {
  session.user = user;
  return viewsRoute.POST(json('http://x/api/crm/views', 'POST', { entity: 'contacts', name: 'Vista', ...body }));
}

async function list(user: SessionUser, qs = 'entity=contacts'): Promise<ViewOut[]> {
  session.user = user;
  const res = await viewsRoute.GET(get(`http://x/api/crm/views?${qs}`));
  return ((await res.json()) as { rows: ViewOut[] }).rows;
}

describe('vistas: reglas puras', () => {
  it('pickViewState deja solo el estado del objeto, sin el orden por defecto', () => {
    expect(
      pickViewState('contacts', { q: ' ana ', sort: 'newest', page: '3', pipeline: 'p', custom_plan: 'Pro', 'custom_x y': '1', freeze: '0', cols: 'name,email,name,bad col' }),
    ).toEqual({ q: 'ana', custom_plan: 'Pro', cols: 'name,email' });
    expect(pickViewState('deals', { stageId: 's1', stalled: '1', lifecycle: 'lead' })).toEqual({ stageId: 's1', stalled: '1' });
  });

  it('la URL gana sobre la vista; con m=1 la URL es todo; freeze=0 apaga el de la vista', () => {
    const view = { lifecycle: 'lead', sort: 'name', freeze: '1' };
    expect(resolveViewState('contacts', { sv: 'v1' }, view)).toEqual({ state: view, modified: false });
    expect(resolveViewState('contacts', { sv: 'v1', sort: 'email' }, view)).toEqual({
      state: { lifecycle: 'lead', sort: 'email', freeze: '1' },
      modified: true,
    });
    expect(resolveViewState('contacts', { sv: 'v1', m: '1', sort: 'name', freeze: '1' }, view).state).toEqual({ sort: 'name', freeze: '1' });
    expect(resolveViewState('contacts', { sv: 'v1', freeze: '0' }, view).state).toEqual({ lifecycle: 'lead', sort: 'name' });
    expect(resolveViewState('contacts', {}, {}).modified).toBe(false);
    expect(resolveViewState('contacts', { q: 'x' }, {}).modified).toBe(true);
  });

  it('redactViewQuery quita filtros, orden y columnas de campos ocultos', () => {
    const filters = JSON.stringify({
      v: 1,
      groups: [
        { rules: [{ f: 'custom:salary', o: 'gt', v: '100' }, { f: 'lifecycle', o: 'is', v: ['lead'] }] },
        { rules: [{ f: 'custom:salary', o: 'known' }] },
      ],
    });
    const out = redactViewQuery(
      { custom_salary: '5', custom_plan: 'Pro', sort: 'cf:salary:desc', cols: 'name,custom:salary,custom:plan', filters },
      new Set(['salary']),
    );
    expect(out).toEqual({
      custom_plan: 'Pro',
      cols: 'name,custom:plan',
      filters: JSON.stringify({ v: 1, groups: [{ rules: [{ f: 'lifecycle', o: 'is', v: ['lead'] }] }] }),
    });
    expect(JSON.stringify(out)).not.toContain('salary');
    expect(redactViewQuery({ sort: 'cf:plan' }, new Set(['salary']))).toEqual({ sort: 'cf:plan' });
  });

  it('las columnas: el nombre siempre primero, sin las que no existen para quien mira', () => {
    expect(orderedColumns(['email', 'custom:secret', 'name', 'phone'], ['name', 'email', 'phone'], 'name')).toEqual(['name', 'email', 'phone']);
  });

  it('pestañas: fijadas primero, una fijada no se cierra y siempre queda una', () => {
    const tabs = normalizeTabs(
      [{ key: 'all' }, { key: 'v1', pinned: true }, { key: 'all' }, { key: 'ghost' }, { key: 'mine' }],
      (k) => k !== 'ghost',
    );
    expect(tabs).toEqual([{ key: 'v1', pinned: true }, { key: 'all' }, { key: 'mine' }]);
    expect(closeTab(tabs, 'v1')).toEqual(tabs);
    expect(closeTab(tabs, 'mine')).toEqual([{ key: 'v1', pinned: true }, { key: 'all' }]);
    expect(closeTab([{ key: 'all' }], 'all')).toEqual([{ key: 'all' }]);
    expect(togglePin(tabs, 'mine')).toEqual([{ key: 'v1', pinned: true }, { key: 'mine', pinned: true }, { key: 'all' }]);
    expect(addTab(tabs, 'v2').map((t) => t.key)).toEqual(['v1', 'all', 'mine', 'v2']);
    const full = Array.from({ length: 50 }, (_, i) => ({ key: `k${i}` }));
    const added = addTab(full, 'new');
    expect(added).toHaveLength(50);
    expect(added.at(-1)).toEqual({ key: 'new' });
    // Una sin fijar no pasa delante de las fijadas.
    expect(moveTab(tabs, 'mine', 0).map((t) => t.key)).toEqual(['v1', 'mine', 'all']);
    expect(moveTab(tabs, 'all', 9).map((t) => t.key)).toEqual(['v1', 'mine', 'all']);
  });

  it('quién ve y quién edita', () => {
    const row = (visibility: string, person: string | null = 'p1', team: string | null = null) => ({
      user_id: 'w',
      person_id: person,
      visibility,
      team_id: team,
    });
    const v = (personId: string, isAdmin = false, teams: string[] = []): ViewViewer => ({
      workspaceId: 'w',
      personId,
      isAdmin,
      teamIds: new Set(teams),
    });
    // Privada: solo quien la creó, tampoco un admin.
    expect(canSeeView(row('private'), v('p1'))).toBe(true);
    expect(canSeeView(row('private'), v('p2'))).toBe(false);
    expect(canSeeView(row('private'), v('admin', true))).toBe(false);
    // Equipo: el equipo y los admins.
    expect(canSeeView(row('team', 'p1', 't1'), v('p2', false, ['t1']))).toBe(true);
    expect(canSeeView(row('team', 'p1', 't1'), v('p3', false, ['t2']))).toBe(false);
    expect(canSeeView(row('team', 'p1', 't1'), v('admin', true))).toBe(true);
    // Todos: la ve el workspace, la edita quien la creó o un admin.
    expect(canSeeView(row('everyone'), v('p2'))).toBe(true);
    expect(canEditView(row('everyone'), v('p2'))).toBe(false);
    expect(canEditView(row('everyone'), v('p1'))).toBe(true);
    expect(canEditView(row('everyone'), v('admin', true))).toBe(true);
    // Otro workspace: nada.
    expect(canSeeView(row('everyone'), { ...v('p1'), workspaceId: 'otro' })).toBe(false);
    // Las vistas de antes (sin creador) son del dueño del workspace.
    expect(canEditView(row('everyone', null), v('w'))).toBe(true);
    expect(canEditView(row('everyone', null), v('p2'))).toBe(false);
  });

  it('las vistas por defecto: mías, sin asignar y deals abiertos', () => {
    expect(DEFAULT_VIEWS.contacts.map((d) => d.key)).toEqual(['all', 'mine', 'unassigned']);
    expect(DEFAULT_VIEWS.deals.map((d) => d.key)).toEqual(['all', 'mine', 'open']);
    expect(DEFAULT_VIEWS.deals[2].query.filters).toContain('"status"');
  });
});

describe('vistas: API y permisos', () => {
  it('anónimo 401, otro workspace no ve nada', async () => {
    const w = await workspaceWithMember('b2-roles');
    const res = await create(asOwner(w.owner), { visibility: 'everyone' });
    const id = ((await res.json()) as ViewOut).id;
    for (const r of roles(w)) {
      session.user = r.user;
      const l = await viewsRoute.GET(get('http://x/api/crm/views?entity=contacts'));
      const one = await viewRoute.GET(get(`http://x/api/crm/views/${id}`), ctx(id));
      if (r.name === 'anonymous') {
        expect(l.status).toBe(401);
        expect(one.status).toBe(401);
      } else if (r.name === 'other_workspace') {
        expect(((await l.json()) as { rows: unknown[] }).rows).toEqual([]);
        expect(one.status).toBe(404);
        expect((await viewRoute.DELETE(get('http://x'), ctx(id))).status).toBe(404);
      } else {
        expect(one.status).toBe(200);
      }
    }
  });

  it('una privada no existe para nadie más, tampoco para un admin', async () => {
    const w = await workspaceWithMember('b2-private');
    const member = asMember(w.owner, w.member);
    const friend = asMember(w.owner, w.friend);
    const res = await create(member, { name: 'Mis leads', visibility: 'private', query: { lifecycle: 'lead' } });
    expect(res.status).toBe(201);
    const view = (await res.json()) as ViewOut;
    expect(view).toMatchObject({ visibility: 'private', mine: true, canEdit: true, query: { lifecycle: 'lead' } });
    expect(JSON.stringify(view)).not.toContain('user_id');

    for (const other of [friend, asOwner(w.owner), asMember(w.owner, w.friend, 'admin')]) {
      expect((await list(other)).map((v) => v.id)).not.toContain(view.id);
      session.user = other;
      expect((await viewRoute.GET(get('http://x'), ctx(view.id))).status).toBe(404);
      expect((await viewRoute.PATCH(json('http://x', 'PATCH', { name: 'Otra' }), ctx(view.id))).status).toBe(404);
      expect((await viewRoute.DELETE(get('http://x'), ctx(view.id))).status).toBe(404);
      // Tampoco se puede abrir como pestaña.
      const tabs = await tabsRoute.PUT(json('http://x', 'PUT', { entity: 'contacts', tabs: [{ key: 'all' }, { key: view.id }] }));
      expect(((await tabs.json()) as { tabs: Array<{ key: string }> }).tabs.map((t) => t.key)).toEqual(['all']);
    }
    expect((await list(member)).map((v) => v.id)).toContain(view.id);
  });

  it('una compartida con todos: la ven todos, la cambian quien la creó o un admin', async () => {
    const w = await workspaceWithMember('b2-everyone');
    const member = asMember(w.owner, w.member);
    const friend = asMember(w.owner, w.friend);
    const view = (await (await create(member, { name: 'Clientes', visibility: 'everyone' })).json()) as ViewOut;

    const seen = (await list(friend)).find((v) => v.id === view.id);
    expect(seen).toMatchObject({ mine: false, canEdit: false });
    session.user = friend;
    expect((await viewRoute.PATCH(json('http://x', 'PATCH', { name: 'Mía' }), ctx(view.id))).status).toBe(403);
    expect((await viewRoute.DELETE(get('http://x'), ctx(view.id))).status).toBe(403);

    session.user = member;
    const upd = await viewRoute.PATCH(json('http://x', 'PATCH', { query: { lifecycle: 'customer', sort: 'name' } }), ctx(view.id));
    expect(((await upd.json()) as ViewOut).query).toEqual({ lifecycle: 'customer', sort: 'name' });

    session.user = asOwner(w.owner);
    expect((await viewRoute.PATCH(json('http://x', 'PATCH', { name: 'Clientes activos' }), ctx(view.id))).status).toBe(200);
    expect((await viewRoute.DELETE(get('http://x'), ctx(view.id))).status).toBe(204);
    expect((await list(member)).map((v) => v.id)).not.toContain(view.id);
  });

  it('una de equipo: solo su equipo; nadie comparte con un equipo ajeno', async () => {
    const w = await workspaceWithMember('b2-team');
    const member = asMember(w.owner, w.member);
    const friend = asMember(w.owner, w.friend);
    const team = await createSalesTeam(w.owner.id, { name: 'Ventas', members: [w.member.id] });
    const other = await createSalesTeam(w.owner.id, { name: 'Otros', members: [w.friend.id] });

    expect((await create(member, { visibility: 'team', teamId: other.id })).status).toBe(400);
    expect((await create(member, { visibility: 'team' })).status).toBe(400);
    const view = (await (await create(member, { name: 'Equipo', visibility: 'team', teamId: team.id })).json()) as ViewOut;

    expect((await list(friend)).map((v) => v.id)).not.toContain(view.id);
    session.user = friend;
    expect((await viewRoute.GET(get('http://x'), ctx(view.id))).status).toBe(404);
    await setSalesTeamMembers(w.owner.id, team.id, [w.member.id, w.friend.id]);
    expect((await list(friend)).find((v) => v.id === view.id)).toMatchObject({ canEdit: false });
    // Un admin la ve y la puede editar.
    expect((await list(asOwner(w.owner))).find((v) => v.id === view.id)).toMatchObject({ canEdit: true });
    // Filtros de "Todas las vistas".
    expect((await list(member, 'entity=contacts&shared=team')).map((v) => v.id)).toEqual([view.id]);
    expect((await list(member, 'entity=contacts&shared=everyone')).map((v) => v.id)).toEqual([]);
    expect((await list(friend, 'entity=contacts&shared=mine')).map((v) => v.id)).toEqual([]);
    expect((await list(friend, `entity=contacts&createdBy=${w.member.id}`)).map((v) => v.id)).toEqual([view.id]);
    expect((await list(friend, 'entity=contacts&q=equi')).map((v) => v.id)).toEqual([view.id]);
  });

  it('una vista compartida no revela campos ocultos para quien la abre', async () => {
    const w = await workspaceWithMember('b2-fields');
    const field = await createCustomField(w.owner.id, { entity: 'contacts', name: 'salary', label: 'Salary', type: 'number' });
    await createCustomField(w.owner.id, { entity: 'contacts', name: 'plan', label: 'Plan', type: 'text' });
    await setFieldPermissions(w.owner.id, field.id, [{ subject: MEMBER_SUBJECT, access: 'hidden' }]);
    const filters = JSON.stringify({ v: 1, groups: [{ rules: [{ f: 'custom:salary', o: 'gt', v: '90000' }] }] });
    const view = (await (
      await create(asOwner(w.owner), {
        visibility: 'everyone',
        query: { filters, custom_salary: '1', sort: 'cf:salary', cols: 'name,custom:salary,custom:plan', lifecycle: 'lead' },
      })
    ).json()) as ViewOut;
    expect(view.query.filters).toContain('salary');

    const member = asMember(w.owner, w.member);
    const seen = (await list(member)).find((v) => v.id === view.id)!;
    expect(seen.query).toEqual({ cols: 'name,custom:plan', lifecycle: 'lead' });
    session.user = member;
    const one = await viewRoute.GET(get('http://x'), ctx(view.id));
    const body = JSON.stringify(await one.json());
    expect(body).not.toContain('salary');
    expect(body).not.toContain('90000');

    // Lo que guarda un member no incluye campos que tiene ocultos.
    const own = (await (await create(member, { query: { custom_salary: '3', custom_plan: 'Pro' } })).json()) as ViewOut;
    const raw = (await getDb().prepare('SELECT query FROM crm_saved_views WHERE id = ?').get(own.id)) as { query: string };
    expect(JSON.parse(raw.query)).toEqual({ custom_plan: 'Pro' });
  });

  it('pestañas: por defecto las vistas por defecto y las que ve; la nueva se agrega a quien la crea', async () => {
    const w = await workspaceWithMember('b2-tabs');
    const member = asMember(w.owner, w.member);
    session.user = member;
    const first = await tabsRoute.GET(get('http://x/api/crm/views/tabs?entity=deals'));
    expect(((await first.json()) as { tabs: Array<{ key: string }> }).tabs.map((t) => t.key)).toEqual(['all', 'mine', 'open']);

    const v = (await (await create(member, { entity: 'deals', name: 'Grandes' })).json()) as ViewOut;
    session.user = member;
    const after = await tabsRoute.GET(get('http://x/api/crm/views/tabs?entity=deals'));
    expect(((await after.json()) as { tabs: Array<{ key: string }> }).tabs.map((t) => t.key)).toEqual(['all', 'mine', 'open', v.id]);

    const put = await tabsRoute.PUT(
      json('http://x', 'PUT', { entity: 'deals', tabs: [{ key: v.id, pinned: true }, { key: 'open' }, { key: 'nope' }] }),
    );
    expect(((await put.json()) as { tabs: unknown }).tabs).toEqual([{ key: v.id, pinned: true }, { key: 'open' }]);
    expect((await tabsRoute.GET(get('http://x/api/crm/views/tabs?entity=nope'))).status).toBe(400);

    // Sin `sv` se abre la primera pestaña (la fijada).
    const viewer = await sessionViewViewer(member);
    const ctxNoSv = await listViewContext(viewer, 'deals', undefined, new Set());
    expect(ctxNoSv).toMatchObject({ defaultKey: v.id, activeKey: v.id });
    // Un `sv` ajeno o inexistente cae en "Todos".
    expect((await listViewContext(viewer, 'deals', 'nope', new Set())).activeKey).toBe('all');

    // Al borrar la vista desaparece de las pestañas.
    session.user = member;
    await viewRoute.DELETE(get('http://x'), ctx(v.id));
    const gone = await tabsRoute.GET(get('http://x/api/crm/views/tabs?entity=deals'));
    expect(((await gone.json()) as { tabs: Array<{ key: string }> }).tabs.map((t) => t.key)).toEqual(['open']);
  });

  it('una vista vieja de otro objeto (tasks) no rompe el listado', async () => {
    const w = await workspaceWithMember('b2-legacy');
    await getDb()
      .prepare("INSERT INTO crm_saved_views (id, user_id, entity, name, query) VALUES (?, ?, 'tasks', 'Old', '{\"q\":\"x\"}')")
      .run(crypto.randomUUID(), w.owner.id);
    session.user = asOwner(w.owner);
    const res = await viewsRoute.GET(get('http://x/api/crm/views'));
    expect(res.status).toBe(200);
    expect(((await res.json()) as { rows: unknown[] }).rows).toEqual([]);
  });

  it('valida el cuerpo', async () => {
    const w = await workspaceWithMember('b2-body');
    expect((await create(asOwner(w.owner), { entity: 'tasks' })).status).toBe(400);
    expect((await create(asOwner(w.owner), { name: '' })).status).toBe(400);
    expect((await create(asOwner(w.owner), { visibility: 'world' })).status).toBe(400);
  });
});

describe('board de deals con la vista activa', () => {
  it('filtra por estado y por owner, sin salir del alcance de quien mira', async () => {
    const w = await workspaceWithMember('b2-board');
    const p = await createPipeline(w.owner.id, 'Ventas');
    const open = (await createStage(w.owner.id, p.id, { name: 'Abierto' }))!;
    const won = (await createStage(w.owner.id, p.id, { name: 'Ganado' }))!;
    await getDb().prepare('UPDATE crm_stages SET is_won = 1 WHERE id = ?').run(won.id);
    for (const [name, stageId, ownerId] of [
      ['Uno', open.id, w.member.id],
      ['Dos', won.id, w.member.id],
      ['Tres', open.id, w.friend.id],
    ] as const) {
      expect((await createDeal(w.owner.id, { pipelineId: p.id, stageId, name, ownerId })).ok).toBe(true);
    }
    const names = (stages: Awaited<ReturnType<typeof listDealsForBoard>>) => stages.flatMap((s) => s.deals.map((d) => d.name)).sort();
    const statusOpen = { v: 1 as const, groups: [{ rules: [{ f: 'status', o: 'is', v: ['open'] }] }] };
    expect(names(await listDealsForBoard(w.owner.id, p.id, null, { filters: statusOpen }))).toEqual(['Tres', 'Uno']);
    const mine = { v: 1 as const, groups: [{ rules: [{ f: 'owner', o: 'is', v: ['me'] }] }] };
    expect(names(await listDealsForBoard(w.owner.id, p.id, null, { filters: mine, filterEnv: { viewerId: w.member.id } }))).toEqual(['Dos', 'Uno']);
    // Una vista "de todos" no amplía lo que un member ve: el alcance se aplica igual.
    expect(names(await listDealsForBoard(w.owner.id, p.id, [w.friend.id], { filters: statusOpen }))).toEqual(['Tres']);
    expect(names(await listDealsForBoard(w.owner.id, p.id, null))).toEqual(['Dos', 'Tres', 'Uno']);
  });
});
