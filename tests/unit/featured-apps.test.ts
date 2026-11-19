import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';
import { getDb, type UserRow } from '@/lib/db';
import { addMember } from '@/lib/teams';
import { ensureWorkspace } from '@/lib/workspace';
import { cleanFeaturedApps, isFeaturableApp, switcherLayout } from '@/lib/featured-apps';
import { loadWorkspaceFeaturedApps, setWorkspaceFeaturedApp } from '@/lib/workspace-apps';
import { appsByCategory, featuredApps } from '@/lib/workspace-mode';
import { APP_SWITCHER_ORDER, isComingSoon, type ProductKey } from '@/lib/products';
import { homeAppGroups, type SidebarLabels } from '@/components/app/sidebar-nav';
import { makeUser } from './helpers';

const session = vi.hoisted(() => ({ user: null as null | Record<string, unknown> }));
vi.mock('@/lib/session', () => ({
  getCurrentUser: async () => session.user,
  realUserId: (u: { id: string; actingUser?: { id: string } }) => u.actingUser?.id ?? u.id,
  isWorkspaceAdmin: (u: { role: string }) => u.role === 'owner' || u.role === 'admin',
}));

const route = await import('@/app/api/teams/apps/featured/route');

beforeEach(() => {
  session.user = null;
});

async function load(id: string): Promise<UserRow> {
  return (await getDb().prepare('SELECT * FROM users WHERE id = ?').get(id)) as UserRow;
}

async function actAs(owner: UserRow, person: UserRow, role: string) {
  const workspace = await ensureWorkspace(owner.id);
  session.user =
    person.id === owner.id
      ? { ...(await load(owner.id)), role: 'owner', apps: '*', team: null, workspace }
      : { ...(await load(owner.id)), actingUser: await load(person.id), role, apps: '*', team: null, workspace };
}

const put = (body: unknown) =>
  route.PUT(new NextRequest('http://localhost/api/teams/apps/featured', { method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) }) as never);

/** Las apps que abre una persona cualquiera: todas menos las "Próximamente". */
const OPEN: ProductKey[] = APP_SWITCHER_ORDER.filter((k) => !isComingSoon(k));

describe('switcherLayout: el menú de apps con y sin destacadas', () => {
  it('sin destacadas es el menú de siempre: todas por categoría, nada plegado', () => {
    for (const none of [[], null, undefined] as const) {
      const layout = switcherLayout(OPEN, none);
      expect(layout.featured).toEqual([]);
      expect(layout.collapsed).toBe(false);
      expect(layout.groups).toEqual(
        appsByCategory()
          .map((g) => ({ ...g, apps: g.apps.filter((k) => OPEN.includes(k)) }))
          .filter((g) => g.apps.length > 0),
      );
      expect(layout.restCount).toBe(OPEN.length);
    }
  });

  it('con destacadas: van arriba en el orden del menú y el resto queda plegado por categoría', () => {
    const layout = switcherLayout(OPEN, ['docs', 'crm']);
    expect(layout.featured).toEqual(['crm', 'docs']);
    expect(layout.collapsed).toBe(true);
    const rest = layout.groups.flatMap((g) => g.apps);
    expect(rest).not.toContain('crm');
    expect(rest).not.toContain('docs');
    expect(rest).toContain('track');
    expect(layout.restCount).toBe(OPEN.length - 2);
    expect([...layout.featured, ...rest].sort()).toEqual([...OPEN].sort());
    expect(layout.groups.every((g) => g.apps.length > 0)).toBe(true);
  });

  it('una destacada que la persona no abre no cuenta; si no le queda ninguna, ve el menú de siempre', () => {
    const withoutCrm = OPEN.filter((k) => k !== 'crm');
    expect(switcherLayout(withoutCrm, ['crm', 'docs']).featured).toEqual(['docs']);
    const none = switcherLayout(withoutCrm, ['crm']);
    expect(none.featured).toEqual([]);
    expect(none.collapsed).toBe(false);
    expect(none.restCount).toBe(withoutCrm.length);
  });

  it('con todas destacadas no hay "Otras apps"', () => {
    const layout = switcherLayout(['crm', 'docs'], ['crm', 'docs']);
    expect(layout).toMatchObject({ featured: ['crm', 'docs'], groups: [], restCount: 0, collapsed: false });
  });

  it('las apagadas y las "Próximamente" no pasan por acá: no se destacan ni cambian', () => {
    // Apagada (no está entre las que abre) y "Próximamente" (no se puede destacar): ninguna aparece.
    const layout = switcherLayout(OPEN.filter((k) => k !== 'track'), ['track', 'chat', 'docs']);
    expect(layout.featured).toEqual(['docs']);
    expect(layout.groups.flatMap((g) => g.apps)).not.toContain('track');
    expect(isFeaturableApp('chat')).toBe(false);
    expect(isFeaturableApp('inbox')).toBe(true);
    expect(isFeaturableApp('nope')).toBe(false);
    expect(cleanFeaturedApps(['docs', 'docs', 'chat', 7, 'nope', 'crm'])).toEqual(['crm', 'docs']);
    expect(cleanFeaturedApps('docs')).toEqual([]);
  });
});

describe('sidebar del inicio y grilla del inicio', () => {
  const L = { yourApps: 'Your apps', moreApps: 'More apps', comingSoon: 'Coming soon' } as unknown as SidebarLabels;
  it('sin elección propia, "Tus apps" son las destacadas del workspace (más las recientes)', () => {
    const groups = homeAppGroups(L, { recentApps: ['notes'], mode: 'team', workspaceFeatured: ['crm', 'docs'] });
    expect(groups[0].items.map((i) => i.href)).toEqual(['/app/notes', '/app/crm', '/app/docs']);
    expect(groups[1]).toMatchObject({ section: 'More apps', collapsible: true });
  });
  it('lo que la persona eligió gana; sin destacadas no cambia nada', () => {
    const own = homeAppGroups(L, { mode: 'team', chosen: ['cal'], workspaceFeatured: ['crm', 'docs'] });
    expect(own[0].items.map((i) => i.href)).toEqual(['/app/calendar']);
    expect(homeAppGroups(L, { mode: 'team', workspaceFeatured: [] })).toEqual(homeAppGroups(L, { mode: 'team' }));
    expect(featuredApps({ mode: 'team', workspace: ['crm', 'docs'] })).toEqual(['crm', 'docs']);
    expect(featuredApps({ mode: 'team', chosen: ['cal'], workspace: ['crm'] })).toEqual(['cal']);
    expect(featuredApps({ mode: 'team', workspace: [] })).toEqual(featuredApps({ mode: 'team' }));
  });
});

describe('apps destacadas en la base', () => {
  it('guarda por workspace, sin repetir, y las devuelve en el orden del menú', async () => {
    const a = await makeUser('fa1a');
    const b = await makeUser('fa1b');
    expect(await loadWorkspaceFeaturedApps(a.id)).toEqual([]);
    await setWorkspaceFeaturedApp(a.id, 'docs', true, a.id);
    await setWorkspaceFeaturedApp(a.id, 'crm', true, a.id);
    expect(await setWorkspaceFeaturedApp(a.id, 'docs', true, a.id)).toEqual(['crm', 'docs']);
    // Otro workspace no ve nada de esto.
    expect(await loadWorkspaceFeaturedApps(b.id)).toEqual([]);
    expect(await setWorkspaceFeaturedApp(a.id, 'crm', false, a.id)).toEqual(['docs']);
    expect(await setWorkspaceFeaturedApp(a.id, 'crm', false, a.id)).toEqual(['docs']);
  });
});

describe('PUT /api/teams/apps/featured', () => {
  it('owner y admin destacan; member, guest y sin sesión no', async () => {
    const owner = await makeUser('fa2o');
    const team = await ensureWorkspace(owner.id);
    const admin = await makeUser('fa2a');
    const member = await makeUser('fa2m');
    const guest = await makeUser('fa2g');
    await addMember(team.id, admin.id, 'admin');
    await addMember(team.id, member.id, 'member');
    await addMember(team.id, guest.id, 'guest');

    expect((await put({ app: 'crm', featured: true })).status).toBe(401);
    await actAs(owner, member, 'member');
    expect((await put({ app: 'crm', featured: true })).status).toBe(403);
    await actAs(owner, guest, 'guest');
    expect((await put({ app: 'crm', featured: true })).status).toBe(403);
    expect(await loadWorkspaceFeaturedApps(owner.id)).toEqual([]);

    await actAs(owner, admin, 'admin');
    const res = await put({ app: 'crm', featured: true });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ app: 'crm', featured: ['crm'] });
    await actAs(owner, owner, 'owner');
    expect(await (await put({ app: 'inbox', featured: true })).json()).toEqual({ app: 'inbox', featured: ['crm', 'inbox'] });
    expect(await (await put({ app: 'crm', featured: false })).json()).toEqual({ app: 'crm', featured: ['inbox'] });

    // El member lee las destacadas de su workspace (arman su menú), pero no las cambia.
    await actAs(owner, member, 'member');
    expect(await (await route.GET()).json()).toEqual({ featured: ['inbox'] });
  });

  it('rechaza apps que no existen, las "Próximamente" y un cuerpo sin featured', async () => {
    const owner = await makeUser('fa3o');
    await actAs(owner, owner, 'owner');
    expect((await put({ app: 'nope', featured: true })).status).toBe(400);
    expect((await put({ app: 'chat', featured: true })).status).toBe(400);
    expect((await put({ app: 'crm' })).status).toBe(400);
    expect((await put({ app: 'crm', featured: 'yes' })).status).toBe(400);
    expect(await loadWorkspaceFeaturedApps(owner.id)).toEqual([]);
  });
});
