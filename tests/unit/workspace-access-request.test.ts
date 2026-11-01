import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';
import { getDb, type UserRow } from '@/lib/db';
import { addMember, getInvite, requestToJoin } from '@/lib/teams';
import { canGrantApps, ensureWorkspace, parseApps, updateWorkspace, type AppAccess } from '@/lib/workspace';
import { grantedApps, lostAccessNotice, pendingRequests } from '@/lib/workspace-access-request';
import { makeUser } from './helpers';

/** Sesión simulada como lib/session (persona real, owner del workspace, rol, apps y ficha). */
const session = vi.hoisted(() => ({ user: null as null | Record<string, unknown> }));
vi.mock('@/lib/session', () => ({
  getCurrentUser: async () => session.user,
  realUserId: (u: { id: string; actingUser?: { id: string } }) => u.actingUser?.id ?? u.id,
  isWorkspaceAdmin: (u: { role: string }) => u.role === 'owner' || u.role === 'admin',
}));

const route = await import('@/app/api/teams/access-request/route');
const member = await import('@/lib/routes/teams/members/[userId]/route');
const invites = await import('@/app/api/teams/invites/route');
const invite = await import('@/lib/routes/teams/invites/[id]/route');
const wsRoute = await import('@/app/api/teams/workspace/route');

beforeEach(() => {
  session.user = null;
});

async function load(id: string): Promise<UserRow> {
  return (await getDb().prepare('SELECT * FROM users WHERE id = ?').get(id)) as UserRow;
}

async function actAs(owner: UserRow, person: UserRow, role: string, apps: AppAccess = '*') {
  const workspace = await ensureWorkspace(owner.id);
  session.user =
    person.id === owner.id
      ? { ...(await load(owner.id)), role: 'owner', apps: '*', team: null, workspace }
      : { ...(await load(owner.id)), actingUser: await load(person.id), role, apps, team: null, workspace };
}

const json = (url: string, method: string, body?: unknown) =>
  new NextRequest(`http://localhost${url}`, { method, headers: { 'content-type': 'application/json' }, ...(body !== undefined ? { body: JSON.stringify(body) } : {}) }) as never;
const post = (body: unknown) => route.POST(json('/api/teams/access-request', 'POST', body));
const deny = (personId: string, workspaceId: string) => route.DELETE(json('/api/teams/access-request', 'DELETE', { personId, workspaceId }));
const patch = (userId: string, body: unknown) => member.PATCH(json(`/api/teams/members/${userId}`, 'PATCH', body), { params: Promise.resolve({ userId }) });

async function inbox(userId: string, unread = false) {
  return (await getDb()
    .prepare(`SELECT title, body, href, source_type, read_at FROM notifications WHERE user_id = ? AND type = 'workspace_access' ${unread ? 'AND read_at IS NULL' : ''} ORDER BY created_at`)
    .all(userId)) as Array<{ title: string; body: string | null; href: string; source_type: string; read_at: string | null }>;
}

async function setup(prefix: string) {
  const owner = await makeUser(`${prefix}o`);
  const team = await ensureWorkspace(owner.id);
  await updateWorkspace(team.id, { name: 'Acme' });
  return { owner, team };
}

describe('pedir acceso a una app', () => {
  it('avisa a owner y admins que tienen la app, una sola línea por persona, con el workspace en el link', async () => {
    const { owner, team } = await setup('ar1');
    const admin = await makeUser('ar1a');
    const limited = await makeUser('ar1l');
    const other = await makeUser('ar1m');
    const carla = await makeUser('ar1c');
    await addMember(team.id, admin.id, 'admin');
    await addMember(team.id, limited.id, 'admin', { apps: ['docs'] });
    await addMember(team.id, other.id, 'member');
    await addMember(team.id, carla.id, 'member', { apps: ['docs'] });

    await actAs(owner, carla, 'member', ['docs']);
    const res = await post({ app: 'crm' });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true });
    for (const id of [owner.id, admin.id]) {
      const [n] = await inbox(id);
      expect(n.title).toContain('CRM');
      expect(n.href).toBe(`/app/settings/members?person=${carla.id}&ws=${team.id}`);
    }
    // El admin sin CRM no puede darlo: no recibe un pedido sin salida.
    expect(await inbox(limited.id)).toEqual([]);
    expect(await inbox(other.id)).toEqual([]);

    // Repetir sin respuesta no vuelve a avisar.
    expect(await (await post({ app: 'crm' })).json()).toEqual({ ok: true, already: true });
    // Otra app, sin leer: el mismo aviso nombra las dos.
    await post({ app: 'track' });
    const merged = await inbox(owner.id);
    expect(merged).toHaveLength(1);
    expect(merged[0].title).toContain('CRM');
    expect(merged[0].title).toContain('Track');
    expect((await pendingRequests(team.id)).get(carla.id)).toEqual(expect.arrayContaining(['crm', 'track']));
  });

  it('lo que pide un admin va solo al owner', async () => {
    const { owner, team } = await setup('ar2');
    const other = await makeUser('ar2a');
    const asker = await makeUser('ar2b');
    await addMember(team.id, other.id, 'admin');
    await addMember(team.id, asker.id, 'admin', { apps: ['docs'] });
    await actAs(owner, asker, 'admin', ['docs']);
    await post({ app: 'crm' });
    expect(await inbox(owner.id)).toHaveLength(1);
    expect(await inbox(other.id)).toEqual([]);
  });

  it('dar la app responde: cierra los avisos de los demás, le avisa y se puede volver a pedir si se la sacan', async () => {
    const { owner, team } = await setup('ar3');
    const admin = await makeUser('ar3a');
    const m = await makeUser('ar3m');
    await addMember(team.id, admin.id, 'admin');
    await addMember(team.id, m.id, 'member', { apps: ['docs'] });
    await actAs(owner, m, 'member', ['docs']);
    await post({ app: 'track' });
    expect(await inbox(admin.id, true)).toHaveLength(1);

    await actAs(owner, owner, 'owner');
    expect((await patch(m.id, { apps: ['docs', 'track'], workspaceId: team.id })).status).toBe(200);
    expect(await inbox(admin.id, true)).toEqual([]);
    expect(await inbox(owner.id, true)).toEqual([]);
    expect((await inbox(m.id)).at(-1)!.title).toContain('Track');
    expect((await pendingRequests(team.id)).get(m.id)).toBeUndefined();

    // Se la sacan y la vuelve a pedir: pedido nuevo, aviso nuevo (nada de "ya lo pediste").
    await patch(m.id, { apps: ['docs'] });
    await actAs(owner, m, 'member', ['docs']);
    expect(await (await post({ app: 'track' })).json()).toEqual({ ok: true });
    expect(await inbox(owner.id, true)).toHaveLength(1);
  });

  it('rechazar le avisa, cierra los avisos y deja volver a pedir', async () => {
    const { owner, team } = await setup('ar4');
    const admin = await makeUser('ar4a');
    const m = await makeUser('ar4m');
    await addMember(team.id, admin.id, 'admin');
    await addMember(team.id, m.id, 'member', { apps: ['docs'] });
    await actAs(owner, m, 'member', ['docs']);
    await post({ app: 'crm' });
    await actAs(owner, admin, 'admin');
    expect((await deny(m.id, 'otro')).status).toBe(409);
    expect((await deny(m.id, team.id)).status).toBe(200);
    expect(await inbox(owner.id, true)).toEqual([]);
    const [n] = await inbox(m.id);
    expect(n.title).toContain('CRM');
    expect(n.body).toBeTruthy();
    // Sin pendientes no hay nada que rechazar.
    expect((await deny(m.id, team.id)).status).toBe(404);
    await actAs(owner, m, 'member', ['docs']);
    expect(await (await post({ app: 'crm' })).json()).toEqual({ ok: true });
    // Un member no rechaza.
    expect((await deny(m.id, team.id)).status).toBe(403);
  });

  it('no hay nada que pedir en tu workspace ni con una app que ya tenés', async () => {
    const { owner, team } = await setup('ar5');
    const m = await makeUser('ar5m');
    await addMember(team.id, m.id, 'member', { apps: ['docs'] });
    await actAs(owner, owner, 'owner');
    expect((await post({ app: 'crm' })).status).toBe(409);
    await actAs(owner, m, 'member', ['docs']);
    expect((await post({ app: 'docs' })).status).toBe(409);
    expect((await post({ app: 'nope' })).status).toBe(400);
    session.user = null;
    expect((await post({ app: 'crm' })).status).toBe(401);
  });

  it('el workspace que cree editar la pantalla tiene que ser el activo', async () => {
    const { owner, team } = await setup('ar6');
    const m = await makeUser('ar6m');
    await addMember(team.id, m.id, 'member', { apps: ['docs'] });
    await actAs(owner, owner, 'owner');
    expect((await patch(m.id, { apps: ['docs', 'crm'], workspaceId: 'ws_otro' })).status).toBe(409);
    expect(await inbox(m.id)).toEqual([]);
    expect((await patch(m.id, { apps: ['docs', 'crm'], workspaceId: team.id })).status).toBe(200);
    const [n] = await inbox(m.id);
    expect(n.title).toContain('CRM');
    expect(n.title).toContain('Acme');
    expect(n.title).not.toContain('Docs');
    expect(grantedApps('*', ['crm'])).toEqual([]);
  });

  it('pedir sumarse por dominio avisa a owner y admins una sola vez', async () => {
    const { owner, team } = await setup('ar7');
    const asker = await makeUser('ar7b');
    await requestToJoin(team, asker.id, asker.email, '*');
    await requestToJoin(team, asker.id, asker.email, '*');
    const rows = await inbox(owner.id);
    expect(rows).toHaveLength(1);
    expect(rows[0].title).toContain(asker.email);
  });
});

describe('nadie da apps que no tiene', () => {
  it('la regla: suma solo lo suyo, puede quitar y mantener', () => {
    expect(canGrantApps('*', '*')).toBe(true);
    expect(canGrantApps(['docs'], '*')).toBe(false);
    expect(canGrantApps(['docs'], '*', '*')).toBe(true);
    expect(canGrantApps(['docs'], ['docs'])).toBe(true);
    expect(canGrantApps(['docs'], ['crm'])).toBe(false);
    expect(canGrantApps(['docs'], ['crm', 'docs'], ['crm'])).toBe(true);
    expect(canGrantApps(['docs'], [], ['crm'])).toBe(true);
    expect(canGrantApps(['docs'], ['track'], '*')).toBe(true);
  });

  it('un admin limitado no lo logra por ninguna ruta', async () => {
    const { owner, team } = await setup('gr1');
    const adl = await makeUser('gr1a');
    const m = await makeUser('gr1m');
    const g = await makeUser('gr1g');
    await addMember(team.id, adl.id, 'admin', { apps: ['docs'] });
    await addMember(team.id, m.id, 'member', { apps: ['docs'] });
    await addMember(team.id, g.id, 'guest', { apps: ['crm'] });
    await actAs(owner, adl, 'admin', ['docs']);

    const inv = (body: unknown) => invites.POST(json('/api/teams/invites', 'POST', body));
    expect((await inv({ emails: 'gr1x@acme.io' })).status).toBe(403);
    expect((await inv({ emails: 'gr1x@acme.io', apps: '*' })).status).toBe(403);
    expect((await inv({ emails: 'gr1x@acme.io', apps: ['crm'] })).status).toBe(403);
    expect((await inv({ emails: 'gr1x@acme.io', apps: ['docs'] })).status).toBe(201);
    // Un guest no usa apps: no hay nada que dar.
    expect((await inv({ emails: 'gr1y@acme.io', role: 'guest' })).status).toBe(201);

    expect((await patch(m.id, { apps: ['docs', 'crm'] })).status).toBe(403);
    expect((await patch(m.id, { apps: '*' })).status).toBe(403);
    expect((await patch(m.id, { apps: [] })).status).toBe(200);
    expect(parseApps(((await getDb().prepare('SELECT apps FROM team_members WHERE team_id = ? AND user_id = ?').get(team.id, m.id)) as { apps: string }).apps)).toEqual([]);
    // Devolverle a un guest apps guardadas que no tiene quien edita.
    expect((await patch(g.id, { role: 'member' })).status).toBe(403);

    await updateWorkspace(team.id, { joinApps: ['docs'] });
    await actAs(owner, adl, 'admin', ['docs']);
    const ws = (body: unknown) => wsRoute.PATCH(json('/api/teams/workspace', 'PATCH', body));
    expect((await ws({ joinApps: ['crm'] })).status).toBe(403);

    // Aprobar un ingreso con apps que no tiene.
    const asker = await makeUser('gr1j');
    const request = await requestToJoin(team, asker.id, asker.email, ['crm']);
    expect((await invite.POST(json(`/api/teams/invites/${request.id}`, 'POST', { action: 'approve' }), { params: Promise.resolve({ id: request.id }) })).status).toBe(403);
    expect((await getInvite(request.id, team.id))?.status).toBe('pending');
  });
});

describe('quien cambia de lugar se entera', () => {
  it('sacado: aviso y una vez en el inicio; pasado a guest también; sale de la lista de pendientes', async () => {
    const { owner, team } = await setup('lo1');
    const m = await makeUser('lo1m');
    const g = await makeUser('lo1g');
    await addMember(team.id, m.id, 'member', { apps: ['docs'] });
    await addMember(team.id, g.id, 'member', { apps: ['docs'] });
    await actAs(owner, m, 'member', ['docs']);
    await post({ app: 'crm' });

    await actAs(owner, owner, 'owner');
    const del = await member.DELETE(json(`/api/teams/members/${m.id}`, 'DELETE'), { params: Promise.resolve({ userId: m.id }) });
    expect(del.status).toBe(200);
    expect((await lostAccessNotice(m.id))?.title).toContain('Acme');
    expect((await lostAccessNotice(m.id))?.body).toBeTruthy();
    expect((await pendingRequests(team.id)).get(m.id)).toBeUndefined();
    expect(await inbox(owner.id, true)).toEqual([]);

    await patch(g.id, { role: 'guest' });
    expect((await lostAccessNotice(g.id))?.title).toContain('Acme');
  });

  it('volver a ser del equipo lo lleva de vuelta al workspace', async () => {
    const { owner, team } = await setup('lo2');
    const g = await makeUser('lo2g');
    await addMember(team.id, g.id, 'guest', { apps: [] });
    await actAs(owner, owner, 'owner');
    expect((await patch(g.id, { role: 'member' })).status).toBe(200);
    expect((await load(g.id)).active_team_id).toBe(team.id);
    expect((await inbox(g.id)).at(-1)!.title).toContain('Acme');
    expect(await lostAccessNotice(g.id)).toBeNull();
  });
});
