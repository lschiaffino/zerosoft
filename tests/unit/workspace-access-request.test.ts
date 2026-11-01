import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';
import { getDb, type UserRow } from '@/lib/db';
import { addMember, requestToJoin } from '@/lib/teams';
import { ensureWorkspace, updateWorkspace } from '@/lib/workspace';
import { makeUser } from './helpers';

/** Sesión simulada como lib/session (persona real, owner del workspace, rol, apps y ficha). */
const session = vi.hoisted(() => ({ user: null as null | Record<string, unknown> }));
vi.mock('@/lib/session', () => ({
  getCurrentUser: async () => session.user,
  realUserId: (u: { id: string; actingUser?: { id: string } }) => u.actingUser?.id ?? u.id,
  isWorkspaceAdmin: (u: { role: string }) => u.role === 'owner' || u.role === 'admin',
}));

const route = await import('@/app/api/teams/access-request/route');

beforeEach(() => {
  session.user = null;
});

async function load(id: string): Promise<UserRow> {
  return (await getDb().prepare('SELECT * FROM users WHERE id = ?').get(id)) as UserRow;
}

async function actAs(owner: UserRow, person: UserRow, role: string, apps: '*' | string[] = '*') {
  const workspace = await ensureWorkspace(owner.id);
  session.user =
    person.id === owner.id
      ? { ...(await load(owner.id)), role: 'owner', apps: '*', team: null, workspace }
      : { ...(await load(owner.id)), actingUser: await load(person.id), role, apps, team: null, workspace };
}

const post = (body: unknown) =>
  route.POST(new NextRequest('http://localhost/api/teams/access-request', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) }) as never);

async function inbox(userId: string) {
  return (await getDb().prepare("SELECT title, body, href FROM notifications WHERE user_id = ? AND type = 'workspace_access' ORDER BY created_at").all(userId)) as Array<{
    title: string;
    body: string | null;
    href: string;
  }>;
}

describe('pedir acceso a una app', () => {
  it('avisa al owner y a los admins (no a los members), una vez por app por día', async () => {
    const owner = await makeUser('aro');
    const team = await ensureWorkspace(owner.id);
    await updateWorkspace(team.id, { name: 'Acme' });
    const admin = await makeUser('ara');
    const other = await makeUser('arm');
    const carla = await makeUser('arc');
    await addMember(team.id, admin.id, 'admin');
    await addMember(team.id, other.id, 'member');
    await addMember(team.id, carla.id, 'member', { apps: ['docs'] });

    await actAs(owner, carla, 'member', ['docs']);
    const res = await post({ app: 'crm' });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true });
    for (const id of [owner.id, admin.id]) {
      const [n] = await inbox(id);
      expect(n.title).toContain('CRM');
      expect(n.title).toContain(carla.name ?? carla.email);
      expect(n.href).toBe(`/app/settings/members?person=${carla.id}`);
    }
    expect(await inbox(other.id)).toEqual([]);

    // Repetir el mismo pedido no vuelve a avisar.
    expect(await (await post({ app: 'crm' })).json()).toEqual({ ok: true, already: true });
    expect(await inbox(owner.id)).toHaveLength(1);
    // Otra app sí.
    await post({ app: 'track' });
    expect(await inbox(owner.id)).toHaveLength(2);
  });

  it('no hay nada que pedir en tu workspace, con una app que ya tenés ni con una app que no existe', async () => {
    const owner = await makeUser('arx');
    const team = await ensureWorkspace(owner.id);
    const m = await makeUser('ary');
    await addMember(team.id, m.id, 'member', { apps: ['docs'] });
    await actAs(owner, owner, 'owner');
    expect((await post({ app: 'crm' })).status).toBe(409);
    await actAs(owner, m, 'member', ['docs']);
    expect((await post({ app: 'docs' })).status).toBe(409);
    expect((await post({ app: 'nope' })).status).toBe(400);
    session.user = null;
    expect((await post({ app: 'crm' })).status).toBe(401);
  });

  it('un guest también puede pedir (el admin decide si lo hace miembro)', async () => {
    const owner = await makeUser('arg');
    const team = await ensureWorkspace(owner.id);
    const g = await makeUser('arh');
    await addMember(team.id, g.id, 'guest');
    await actAs(owner, g, 'guest');
    expect((await post({ app: 'docs' })).status).toBe(200);
    expect(await inbox(owner.id)).toHaveLength(1);
  });

  it('pedir sumarse por dominio avisa a owner y admins una sola vez', async () => {
    const owner = await makeUser('arj');
    const team = await ensureWorkspace(owner.id);
    const asker = await makeUser('ark');
    await requestToJoin(team, asker.id, asker.email, '*');
    await requestToJoin(team, asker.id, asker.email, '*');
    const rows = await inbox(owner.id);
    expect(rows).toHaveLength(1);
    expect(rows[0].title).toContain(asker.email);
  });
});
