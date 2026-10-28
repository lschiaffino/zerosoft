import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';
import { getDb, upsertUser, type UserRow } from '@/lib/db';
import { addMember, createInvite, getMemberRole } from '@/lib/teams';
import { ensureWorkspace } from '@/lib/workspace';
import { makeUser } from './helpers';

/** Sesión simulada como lib/session (persona real, owner del workspace, rol y ficha). */
const session = vi.hoisted(() => ({ user: null as null | Record<string, unknown> }));
vi.mock('@/lib/session', () => ({
  getCurrentUser: async () => session.user,
  realUserId: (u: { id: string; actingUser?: { id: string } }) => u.actingUser?.id ?? u.id,
  isWorkspaceAdmin: (u: { role: string }) => u.role === 'owner' || u.role === 'admin',
}));

const invites = await import('@/app/api/teams/invites/route');
const invite = await import('@/lib/routes/teams/invites/[id]/route');
const member = await import('@/lib/routes/teams/members/[userId]/route');
const accept = await import('@/app/api/teams/accept/route');
const ws = await import('@/app/api/teams/workspace/route');
const groups = await import('@/app/api/teams/groups/route');

beforeEach(() => {
  session.user = null;
  delete process.env.RESEND_API_KEY;
});

async function load(id: string): Promise<UserRow> {
  return (await getDb().prepare('SELECT * FROM users WHERE id = ?').get(id)) as UserRow;
}

async function actAs(owner: UserRow, person: UserRow, role: string) {
  const workspace = await ensureWorkspace(owner.id);
  session.user = person.id === owner.id ? { ...(await load(owner.id)), role: 'owner', team: null, workspace } : { ...(await load(owner.id)), actingUser: await load(person.id), role, team: null, workspace };
}

const send = (url: string, method: string, body?: unknown) =>
  new NextRequest(url, { method, headers: { 'content-type': 'application/json' }, ...(body !== undefined ? { body: JSON.stringify(body) } : {}) }) as never;
const params = <T extends Record<string, string>>(p: T) => ({ params: Promise.resolve(p) });

describe('rutas de /api/teams', () => {
  it('solo owner y admins invitan; un admin no nombra admins; el link sale en la respuesta', async () => {
    const owner = await makeUser('ro');
    const team = await ensureWorkspace(owner.id);
    const m = await makeUser('rm');
    await addMember(team.id, m.id, 'member');
    const url = 'http://localhost/api/teams/invites';

    await actAs(owner, m, 'member');
    expect((await invites.POST(send(url, 'POST', { emails: 'x@acme.io' }))).status).toBe(403);

    const admin = await makeUser('ra');
    await addMember(team.id, admin.id, 'admin');
    await actAs(owner, admin, 'admin');
    expect((await invites.POST(send(url, 'POST', { emails: 'x@acme.io', role: 'admin' }))).status).toBe(403);
    const res = await invites.POST(send(url, 'POST', { emails: 'x@acme.io, bad', role: 'member', apps: ['docs'] }));
    expect(res.status).toBe(201);
    const body = (await res.json()) as { results: Array<{ status: string; url: string; inviteId: string }>; invalid: string[] };
    expect(body.invalid).toEqual(['bad']);
    expect(body.results[0].status).toBe('skipped');
    expect(body.results[0].url).toContain('/invite/');

    // Reenviar: una vez por minuto.
    const r1 = await invite.POST(send(`${url}/${body.results[0].inviteId}`, 'POST'), params({ id: body.results[0].inviteId }));
    expect(r1.status).toBe(200);
    const r2 = await invite.POST(send(`${url}/${body.results[0].inviteId}`, 'POST'), params({ id: body.results[0].inviteId }));
    expect(r2.status).toBe(429);
    // Revocar y que el link no sirva más.
    expect((await invite.DELETE(send(`${url}/x`, 'DELETE'), params({ id: body.results[0].inviteId }))).status).toBe(200);
    const token = ((await getDb().prepare('SELECT token FROM team_invites WHERE id = ?').get(body.results[0].inviteId)) as { token: string }).token;
    const x = await upsertUser({ email: 'x@acme.io', name: 'X' });
    await actAs(x, x, 'owner');
    expect((await accept.POST(send('http://localhost/api/teams/accept', 'POST', { token }))).status).toBe(400);
  });

  it('aceptar con otro email pide confirmación; el link es de un solo uso', async () => {
    const owner = await makeUser('ao');
    const team = await ensureWorkspace(owner.id);
    const inv = await createInvite(team.id, 'otra@acme.io', owner.id, { role: 'member' });
    const someone = await makeUser('as');
    await actAs(someone, someone, 'owner');
    const url = 'http://localhost/api/teams/accept';
    const res = await accept.POST(send(url, 'POST', { token: inv.token }));
    expect(res.status).toBe(409);
    expect(await res.json()).toMatchObject({ error: 'email_mismatch', inviteEmail: 'otra@acme.io' });
    const ok = await accept.POST(send(url, 'POST', { token: inv.token, confirm: true }));
    expect(ok.status).toBe(200);
    expect(await ok.json()).toMatchObject({ ok: true, team: { id: team.id } });
    expect(await getMemberRole(team.id, someone.id)).toBe('member');
    expect(((await getDb().prepare('SELECT active_team_id FROM users WHERE id = ?').get(someone.id)) as { active_team_id: string }).active_team_id).toBe(team.id);
    expect((await accept.POST(send(url, 'POST', { token: inv.token, confirm: true }))).status).toBe(400);
  });

  it('roles: un admin no toca a otro admin ni se cambia a sí mismo; el owner no se va', async () => {
    const owner = await makeUser('po');
    const team = await ensureWorkspace(owner.id);
    const a1 = await makeUser('pa1');
    const a2 = await makeUser('pa2');
    const m = await makeUser('pm');
    await addMember(team.id, a1.id, 'admin');
    await addMember(team.id, a2.id, 'admin');
    await addMember(team.id, m.id, 'member');
    await actAs(owner, a1, 'admin');
    const url = 'http://localhost/api/teams/members/x';
    expect((await member.PATCH(send(url, 'PATCH', { role: 'member' }), params({ userId: a2.id }))).status).toBe(403);
    expect((await member.PATCH(send(url, 'PATCH', { role: 'member' }), params({ userId: a1.id }))).status).toBe(400);
    expect((await member.PATCH(send(url, 'PATCH', { apps: ['crm'], role: 'guest' }), params({ userId: m.id }))).status).toBe(200);
    expect(await getMemberRole(team.id, m.id)).toBe('guest');
    expect((await member.DELETE(send(url, 'DELETE'), params({ userId: owner.id }))).status).toBe(403);
    await actAs(owner, owner, 'owner');
    expect((await member.DELETE(send(url, 'DELETE'), params({ userId: 'self' }))).status).toBe(400);
    expect((await member.DELETE(send(url, 'DELETE'), params({ userId: a2.id }))).status).toBe(200);
    expect(await getMemberRole(team.id, a2.id)).toBeNull();
  });

  it('la ficha y los subequipos solo los cambian owner y admins', async () => {
    const owner = await makeUser('fo');
    const team = await ensureWorkspace(owner.id);
    const m = await makeUser('fm');
    await addMember(team.id, m.id, 'member');
    await actAs(owner, m, 'member');
    expect((await ws.PATCH(send('http://localhost/api/teams/workspace', 'PATCH', { name: 'X' }))).status).toBe(403);
    expect((await groups.POST(send('http://localhost/api/teams/groups', 'POST', { name: 'Ventas' }))).status).toBe(403);
    await actAs(owner, owner, 'owner');
    const res = await ws.PATCH(send('http://localhost/api/teams/workspace', 'PATCH', { name: 'Darwin AI', mode: 'team', allowedDomains: ['darwin.ai'] }));
    expect(await res.json()).toMatchObject({ name: 'Darwin AI', mode: 'team', allowedDomains: ['darwin.ai'] });
    expect((await groups.POST(send('http://localhost/api/teams/groups', 'POST', { name: 'Ventas', memberIds: [m.id, 'stranger'] }))).status).toBe(201);
    const g = (await getDb().prepare('SELECT m.user_id FROM workspace_group_members m JOIN workspace_groups g ON g.id = m.group_id WHERE g.workspace_id = ?').all(owner.id)) as Array<{ user_id: string }>;
    expect(g.map((r) => r.user_id)).toEqual([m.id]);
  });
});
