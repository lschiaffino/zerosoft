import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';
import { getDb, type UserRow } from '@/lib/db';
import { acceptInvite, addMember, resolveWorkspace, setMemberCapabilities } from '@/lib/teams';
import { ensureWorkspace, getMembership } from '@/lib/workspace';
import { inviteAppsOf } from '@/lib/capabilities';
import { makeUser } from './helpers';

/**
 * "Puede invitar a Lines": un member con el permiso invita al workspace, y la
 * persona entra como member y solo con Lines. Todo lo demás (otras apps,
 * admin, guests, equipos, dar el permiso, editar personas, otro workspace)
 * queda cerrado en el servidor.
 */
const session = vi.hoisted(() => ({ user: null as null | Record<string, unknown> }));
vi.mock('@/lib/session', async () => {
  const roles = await vi.importActual<typeof import('@/lib/roles')>('@/lib/roles');
  return {
    getCurrentUser: async () => session.user,
    realUserId: (u: { id: string; actingUser?: { id: string } }) => u.actingUser?.id ?? u.id,
    isWorkspaceAdmin: (u: { role: string }) => roles.can(u, 'workspace.edit'),
  };
});

const invites = await import('@/app/api/teams/invites/route');
const memberRoute = await import('@/lib/routes/teams/members/[userId]/route');
const CAP = 'lines.invite';

beforeEach(() => {
  session.user = null;
  vi.stubEnv('RATE_LIMIT_DISABLED', 'true');
});

async function load(id: string): Promise<UserRow> {
  return (await getDb().prepare('SELECT * FROM users WHERE id = ?').get(id)) as UserRow;
}

async function actAs(owner: UserRow, person: UserRow) {
  const workspace = await ensureWorkspace(owner.id);
  await getDb().prepare('UPDATE users SET active_team_id = ? WHERE id = ?').run(workspace.id, person.id);
  const r = await resolveWorkspace(await load(person.id));
  session.user = { ...(await load(owner.id)), actingUser: await load(person.id), role: r.role, apps: r.apps, caps: r.caps, team: null, workspace };
}

const post = (body: unknown) =>
  invites.POST(new NextRequest('http://localhost/api/teams/invites', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) }) as never);

async function cast() {
  const owner = await makeUser('own');
  const team = await ensureWorkspace(owner.id);
  const admin = await makeUser('adm');
  const marta = await makeUser('marta');
  const nico = await makeUser('nico');
  const guest = await makeUser('gst');
  await addMember(team.id, admin.id, 'admin');
  await addMember(team.id, marta.id, 'member', { apps: ['groups', 'crm'] });
  await addMember(team.id, nico.id, 'member', { apps: ['crm'] });
  await addMember(team.id, guest.id, 'guest', { apps: [] });
  return { owner, team, admin, marta, nico, guest };
}

describe('inviteAppsOf (lib/capabilities)', () => {
  it('solo un member con la capacidad y con la app', () => {
    expect(inviteAppsOf({ role: 'member', caps: [CAP], apps: '*' })).toEqual(['groups']);
    expect(inviteAppsOf({ role: 'member', caps: [CAP], apps: ['crm'] })).toEqual([]);
    expect(inviteAppsOf({ role: 'member', caps: [] })).toEqual([]);
    expect(inviteAppsOf({ role: 'guest', caps: [CAP] })).toEqual([]);
    // Owner y admin invitan por su rol, no por la capacidad.
    expect(inviteAppsOf({ role: 'admin', caps: [CAP] })).toEqual([]);
  });
});

describe('POST /api/teams/invites con "Puede invitar a Lines"', () => {
  it('un member sin el permiso no invita: 403', async () => {
    const { owner, marta } = await cast();
    await actAs(owner, marta);
    expect((await post({ emails: 'a@invite-test.io', role: 'member', apps: ['groups'] })).status).toBe(403);
    expect((await post({ link: true, role: 'member', apps: ['groups'] })).status).toBe(403);
  });

  it('con el permiso invita como member y solo con Lines, por email y por link', async () => {
    const { owner, team, marta } = await cast();
    await setMemberCapabilities(team.id, marta.id, [CAP]);
    await actAs(owner, marta);
    expect((await post({ emails: 'b@invite-test.io', role: 'member', apps: ['groups'] })).status).toBe(201);
    // Sin apps en el pedido: solo Lines.
    expect((await post({ emails: 'c@invite-test.io' })).status).toBe(201);
    expect((await post({ link: true })).status).toBe(201);
    const rows = (await getDb().prepare("SELECT email, role, apps FROM team_invites WHERE team_id = ? AND email IN ('b@invite-test.io','c@invite-test.io','')").all(team.id)) as Array<{ role: string; apps: string }>;
    expect(rows.length).toBe(3);
    for (const r of rows) {
      expect(r.role).toBe('member');
      expect(JSON.parse(r.apps)).toEqual(['groups']);
    }
    // Queda en el registro de cambios.
    const log = (await getDb().prepare("SELECT action FROM workspace_audit WHERE team_id = ? AND action = 'invite.create'").all(team.id)) as unknown[];
    expect(log.length).toBeGreaterThan(0);
  });

  it('no escala: otra app, todas las apps, admin, guest, equipos', async () => {
    const { owner, team, marta } = await cast();
    await setMemberCapabilities(team.id, marta.id, [CAP]);
    await actAs(owner, marta);
    expect((await post({ emails: 'd@invite-test.io', role: 'member', apps: ['crm'] })).status).toBe(403);
    expect((await post({ emails: 'd@invite-test.io', role: 'member', apps: ['groups', 'crm'] })).status).toBe(403);
    expect((await post({ emails: 'd@invite-test.io', role: 'member', apps: '*' })).status).toBe(403);
    expect((await post({ emails: 'd@invite-test.io', role: 'member', apps: [] })).status).toBe(403);
    expect((await post({ emails: 'd@invite-test.io', role: 'admin', apps: ['groups'] })).status).toBe(403);
    expect((await post({ link: true, role: 'admin', apps: ['groups'] })).status).toBe(403);
    expect((await post({ emails: 'd@invite-test.io', role: 'guest' })).status).toBe(403);
    // Los equipos se ignoran: nadie entra a un equipo por una invitación de un member.
    const sub = 'grp-invite-test';
    await getDb().prepare('INSERT INTO workspace_groups (id, workspace_id, name) VALUES (?, ?, ?)').run(sub, owner.id, 'Soporte');
    expect((await post({ emails: 'e@invite-test.io', groupIds: [sub] })).status).toBe(201);
    const row = (await getDb().prepare("SELECT group_ids FROM team_invites WHERE team_id = ? AND email = 'e@invite-test.io'").get(team.id)) as { group_ids?: string } | undefined;
    expect(JSON.parse(row?.group_ids || '[]')).toEqual([]);
    expect((await getDb().prepare("SELECT 1 AS x FROM team_invites WHERE team_id = ? AND email = 'd@invite-test.io'").get(team.id))).toBeUndefined();
  });

  it('un guest o un member sin Lines no invitan aunque tengan el permiso guardado', async () => {
    const { owner, team, nico, guest } = await cast();
    await setMemberCapabilities(team.id, guest.id, [CAP]);
    await setMemberCapabilities(team.id, nico.id, [CAP]);
    // Un guest no entra al workspace: la sesión lo trae con rol guest.
    await actAs(owner, nico);
    session.user = { ...session.user, actingUser: await load(guest.id), role: 'guest', apps: [], caps: [CAP] };
    expect((await post({ emails: 'f@invite-test.io', role: 'member', apps: ['groups'] })).status).toBe(403);
    await actAs(owner, nico);
    expect((await post({ emails: 'f@invite-test.io', role: 'member', apps: ['groups'] })).status).toBe(403);
  });

  it('quien ya es parte del equipo no recibe nada nuevo', async () => {
    const { owner, team, marta, nico } = await cast();
    await setMemberCapabilities(team.id, marta.id, [CAP]);
    await actAs(owner, marta);
    const res = await post({ emails: (await load(nico.id)).email });
    expect(res.status).toBe(201);
    const body = (await res.json()) as { results: Array<{ status: string }> };
    expect(body.results[0].status).toBe('member');
    expect((await getMembership(team, nico.id))?.apps).toEqual(['crm']);
  });

  it('quitar el permiso corta en el pedido siguiente', async () => {
    const { owner, team, marta } = await cast();
    await setMemberCapabilities(team.id, marta.id, [CAP]);
    await actAs(owner, marta);
    expect((await post({ emails: 'g@invite-test.io' })).status).toBe(201);
    await setMemberCapabilities(team.id, marta.id, []);
    await actAs(owner, marta);
    expect((await post({ emails: 'h@invite-test.io' })).status).toBe(403);
  });

  it('el invitado entra como member con solo Lines', async () => {
    const { owner, team, marta } = await cast();
    await setMemberCapabilities(team.id, marta.id, [CAP]);
    await actAs(owner, marta);
    const res = await post({ emails: 'newbie@invite-test.io', role: 'member', apps: ['groups'] });
    const body = (await res.json()) as { results: Array<{ inviteId: string }> };
    const invite = (await getDb().prepare('SELECT * FROM team_invites WHERE id = ?').get(body.results[0].inviteId)) as never;
    const newbie = await makeUser('newbie');
    await acceptInvite(invite, newbie.id);
    const m = await getMembership(team, newbie.id);
    expect(m?.role).toBe('member');
    expect(m?.apps).toEqual(['groups']);
  });

  it('el admin que invita desde Lines tampoco da más que Lines si lo pide así, y el owner no cambia', async () => {
    const { owner, admin } = await cast();
    await actAs(owner, admin);
    expect((await post({ emails: 'i@invite-test.io', role: 'member', apps: ['groups'] })).status).toBe(201);
    expect((await post({ emails: 'j@invite-test.io', role: 'admin' })).status).toBe(403);
  });
});

describe('lo que el permiso no abre', () => {
  it('no edita personas, ni se lo da a sí mismo ni a otros', async () => {
    const { owner, team, marta, nico } = await cast();
    await setMemberCapabilities(team.id, marta.id, [CAP]);
    await actAs(owner, marta);
    const call = (id: string, data: unknown) =>
      memberRoute.PATCH(new NextRequest(`http://localhost/api/teams/members/${id}`, { method: 'PATCH', headers: { 'content-type': 'application/json' }, body: JSON.stringify(data) }) as never, {
        params: Promise.resolve({ userId: id }),
      });
    expect((await call(nico.id, { role: 'admin' })).status).toBe(403);
    expect((await call(nico.id, { apps: ['groups'] })).status).toBe(403);
    expect((await call(nico.id, { capabilities: [CAP] })).status).toBe(403);
    expect((await call(marta.id, { role: 'admin' })).status).toBe(403);
    expect((await call(marta.id, { capabilities: [CAP, 'lines.numbers.manage'] })).status).toBe(403);
  });

  it('otro workspace: su permiso no vale en un workspace donde no lo tiene', async () => {
    const { owner, team, marta } = await cast();
    await setMemberCapabilities(team.id, marta.id, [CAP]);
    const other = await makeUser('other-owner');
    const otherTeam = await ensureWorkspace(other.id);
    await addMember(otherTeam.id, marta.id, 'member', { apps: ['groups'] });
    await getDb().prepare('UPDATE users SET active_team_id = ? WHERE id = ?').run(otherTeam.id, marta.id);
    const r = await resolveWorkspace(await load(marta.id));
    session.user = { ...(await load(other.id)), actingUser: await load(marta.id), role: r.role, apps: r.apps, caps: r.caps, team: null, workspace: otherTeam };
    expect((await post({ emails: 'k@invite-test.io', apps: ['groups'] })).status).toBe(403);
    expect(owner.id).not.toBe(other.id);
  });
});
