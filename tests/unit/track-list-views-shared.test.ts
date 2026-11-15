import { describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';
import { createListView, getListView, isShareableListKey, listListViews, updateListView, deleteListView } from '@/lib/track-list-views';
import { makeUser } from './helpers';

const session = vi.hoisted(() => ({ user: null as null | Record<string, unknown> }));
vi.mock('@/lib/session', () => ({
  getCurrentUser: async () => session.user,
  realUserId: (u: { id: string; actingUser?: { id: string } }) => u.actingUser?.id ?? u.id,
}));

const route = await import('@/app/api/track/list-views/route');

const payload = { viewType: 'list' as const, filters: { priority: ['high'] }, sort: 'manual' as const };

describe('vistas guardadas compartidas con el workspace (Issues, Issues de un project)', () => {
  it('solo se comparten en un workspace y nunca las de My issues', () => {
    expect(isShareableListKey('workspace-issues', 'ws-1')).toBe(true);
    expect(isShareableListKey('plan:abc', 'ws-1')).toBe(true);
    expect(isShareableListKey('mine:assigned', 'ws-1')).toBe(false);
    // Sin workspace no hay con quién compartir.
    expect(isShareableListKey('workspace-issues', '')).toBe(false);
  });

  it('la compartida la ve el resto del workspace, con su dueño; solo el dueño la edita o la borra', async () => {
    const ana = await makeUser('views-ana');
    const leo = await makeUser('views-leo');
    const outsider = await makeUser('views-out');
    const ws = `ws-${Math.random().toString(36).slice(2, 8)}`;
    const other = `ws-${Math.random().toString(36).slice(2, 8)}`;

    // Workspaces nuevos: scope_id vacío para todos; se comparte por workspace_id.
    const personal = await createListView(ana.id, '', 'workspace-issues', { name: 'Mine only', ...payload }, ws);
    const shared = await createListView(ana.id, '', 'workspace-issues', { name: 'Bugs this week', shared: true, ...payload }, ws);
    expect(personal.shared).toBe(false);
    expect(shared.shared).toBe(true);

    const leoSees = await listListViews(leo.id, '', 'workspace-issues', ws);
    expect(leoSees.map((v) => v.name)).toEqual(['Bugs this week']);
    expect(leoSees[0].user_id).toBe(ana.id);
    expect(leoSees[0].filters).toEqual({ priority: ['high'] });

    // Otro workspace no la ve, aunque use la misma lista y el mismo scope vacío.
    expect(await listListViews(outsider.id, '', 'workspace-issues', other)).toEqual([]);
    expect(await listListViews(outsider.id, '', 'workspace-issues')).toEqual([]);
    // Ni otra lista del mismo workspace.
    expect(await listListViews(leo.id, '', 'plan:xyz', ws)).toEqual([]);

    // Leo no la edita, no la deja de compartir ni la borra.
    expect(await updateListView(shared.id, leo.id, { name: 'Hacked' }, ws)).toBeUndefined();
    expect(await updateListView(shared.id, leo.id, { shared: false }, ws)).toBeUndefined();
    expect(await deleteListView(shared.id, leo.id)).toBe(false);
    expect((await getListView(shared.id, ana.id))?.name).toBe('Bugs this week');

    // Ana la vuelve personal: Leo deja de verla.
    expect((await updateListView(shared.id, ana.id, { shared: false }, ws))?.shared).toBe(false);
    expect(await listListViews(leo.id, '', 'workspace-issues', ws)).toEqual([]);
    // Su vista personal sigue en su lista.
    expect((await listListViews(ana.id, '', 'workspace-issues', ws)).map((v) => v.name).sort()).toEqual(['Bugs this week', 'Mine only']);
  });

  it('una vista de antes (sin workspace) se ata al workspace activo al compartirla', async () => {
    const ana = await makeUser('views-old');
    const leo = await makeUser('views-old-2');
    const ws = `ws-${Math.random().toString(36).slice(2, 8)}`;
    const old = await createListView(ana.id, '', 'workspace-issues', { name: 'Old view', ...payload });
    expect((await updateListView(old.id, ana.id, { shared: true }, ws))?.shared).toBe(true);
    expect((await listListViews(leo.id, '', 'workspace-issues', ws)).map((v) => v.name)).toEqual(['Old view']);
  });

  it('las de My issues y las de alguien sin workspace quedan personales aunque se pidan compartidas', async () => {
    const ana = await makeUser('views-mine');
    const leo = await makeUser('views-mine-2');
    const ws = `ws-${Math.random().toString(36).slice(2, 8)}`;
    const mine = await createListView(ana.id, '', 'mine:assigned', { name: 'Urgent', shared: true, ...payload }, ws);
    expect(mine.shared).toBe(false);
    expect(await listListViews(leo.id, '', 'mine:assigned', ws)).toEqual([]);
    expect((await updateListView(mine.id, ana.id, { shared: true }, ws))?.shared).toBe(false);

    const solo = await createListView(ana.id, '', 'workspace-issues', { name: 'Solo', shared: true, ...payload });
    expect(solo.shared).toBe(false);
    expect(await listListViews(leo.id, '', 'workspace-issues')).toEqual([]);
  });

  it('la API comparte, avisa si la lista se puede compartir y no deja tocar la vista de otro', async () => {
    const ana = await makeUser('views-api-ana');
    const leo = await makeUser('views-api-leo');
    const ws = `ws-${Math.random().toString(36).slice(2, 8)}`;
    const json = (method: string, body: unknown) =>
      new NextRequest('http://x/api/track/list-views', { method, body: JSON.stringify(body), headers: { 'content-type': 'application/json' } });

    session.user = { id: ana.id, team: null, workspace: { id: ws } };
    const created = await route.POST(json('POST', { key: 'workspace-issues', name: 'Triage queue', shared: true, ...payload }));
    expect(created.status).toBe(201);
    const view = (await created.json()) as { id: string; shared: boolean };
    expect(view.shared).toBe(true);

    session.user = { id: leo.id, team: null, workspace: { id: ws } };
    const got = (await (await route.GET(new NextRequest('http://x/api/track/list-views?key=workspace-issues'))).json()) as {
      rows: Array<{ id: string; owner_name: string | null }>;
      shareable: boolean;
    };
    expect(got.shareable).toBe(true);
    expect(got.rows.map((r) => r.id)).toContain(view.id);
    const mine = (await (await route.GET(new NextRequest('http://x/api/track/list-views?key=mine:assigned'))).json()) as { shareable: boolean };
    expect(mine.shareable).toBe(false);

    expect((await route.PATCH(json('PATCH', { id: view.id, shared: false }))).status).toBe(404);
    expect((await route.DELETE(new NextRequest(`http://x/api/track/list-views?id=${view.id}`, { method: 'DELETE' }))).status).toBe(404);
  });
});
