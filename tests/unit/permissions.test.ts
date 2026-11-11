import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';
import { getDb, type UserRow } from '@/lib/db';
import { addMember, createInvite, getMemberRole } from '@/lib/teams';
import { ensureWorkspace, getMembership } from '@/lib/workspace';
import { assignableRoles, can, canManageRole, ROLE_MATRIX, ROLES, type Role } from '@/lib/roles';
import { canGiveApps } from '@/lib/permissions';
import { listAudit } from '@/lib/workspace-admin';
import { createGroup } from '@/lib/workspace-groups';
import { makeUser } from './helpers';

/**
 * Lo que dice Ajustes › Miembros y permisos es lo que hacen las rutas: cada
 * rol (owner, admin, member, guest) contra acciones representativas de
 * varias apps (personas e invitaciones, workspace, CRM, webhooks, API keys).
 * La sesión es la de lib/session simulada, con el chequeo de admin real.
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
const invite = await import('@/lib/routes/teams/invites/[id]/route');
const member = await import('@/lib/routes/teams/members/[userId]/route');
const ws = await import('@/app/api/teams/workspace/route');
const groups = await import('@/app/api/teams/groups/route');
const keys = await import('@/app/api/keys/route');
const crmObjects = await import('@/app/api/crm/objects/route');
const webhooks = await import('@/app/api/webhooks/route');
const directory = await import('@/app/api/teams/members/route');

beforeEach(() => {
  session.user = null;
  delete process.env.RESEND_API_KEY;
});

async function load(id: string): Promise<UserRow> {
  return (await getDb().prepare('SELECT * FROM users WHERE id = ?').get(id)) as UserRow;
}

async function actAs(owner: UserRow, person: UserRow, role: Role, apps: '*' | string[] = '*') {
  const workspace = await ensureWorkspace(owner.id);
  session.user =
    person.id === owner.id
      ? { ...(await load(owner.id)), role: 'owner', apps: '*', team: null, workspace }
      : { ...(await load(owner.id)), actingUser: await load(person.id), role, apps, team: null, workspace };
}

const send = (url: string, method: string, body?: unknown) =>
  new NextRequest(url, { method, headers: { 'content-type': 'application/json' }, ...(body !== undefined ? { body: JSON.stringify(body) } : {}) }) as never;
const params = <T extends Record<string, string>>(p: T) => ({ params: Promise.resolve(p) });
const U = 'http://localhost/api/teams/members/x';

/** Workspace con una persona de cada rol. */
async function cast() {
  const owner = await makeUser('own');
  const team = await ensureWorkspace(owner.id);
  const admin = await makeUser('adm');
  const admin2 = await makeUser('adm2');
  const mem = await makeUser('mem');
  const mem2 = await makeUser('mem2');
  const guest = await makeUser('gst');
  await addMember(team.id, admin.id, 'admin');
  await addMember(team.id, admin2.id, 'admin');
  await addMember(team.id, mem.id, 'member', { apps: ['crm', 'docs'] });
  await addMember(team.id, mem2.id, 'member');
  await addMember(team.id, guest.id, 'guest', { apps: [] });
  return { owner, team, admin, admin2, mem, mem2, guest };
}

describe('reglas de roles (lib/roles)', () => {
  it('la matriz que muestra la pantalla', () => {
    const table = Object.fromEntries(ROLES.map((r) => [r, ROLE_MATRIX.map((row) => can({ role: r }, row.action))]));
    expect(table).toEqual({
      owner: [true, true, true, true, true],
      admin: [true, true, true, true, false],
      member: [true, false, false, false, false],
      guest: [false, false, false, false, false],
    });
  });

  it('quién gestiona a quién y qué roles da', () => {
    expect(canManageRole('owner', 'admin')).toBe(true);
    expect(canManageRole('owner', 'owner')).toBe(false);
    expect(canManageRole('admin', 'admin')).toBe(false);
    expect(canManageRole('admin', 'member')).toBe(true);
    expect(canManageRole('admin', 'guest')).toBe(true);
    expect(canManageRole('member', 'guest')).toBe(false);
    expect(assignableRoles('owner')).toEqual(['admin', 'member', 'guest']);
    expect(assignableRoles('admin')).toEqual(['member', 'guest']);
    expect(assignableRoles('member')).toEqual([]);
    expect(can({ role: 'admin' }, 'members.manage', { target: 'member', nextRole: 'admin' })).toBe(false);
    expect(can({ role: 'owner' }, 'members.manage', { target: 'member', nextRole: 'admin' })).toBe(true);
    expect(can({ role: 'admin' }, 'members.manage', { target: 'member', self: true })).toBe(false);
    expect(can({ role: 'owner' }, 'members.leave')).toBe(false);
    expect(can({ role: 'guest' }, 'members.view')).toBe(false);
    // Un rol raro nunca suma permisos: cae en member.
    expect(can({ role: 'superuser' }, 'members.invite')).toBe(false);
  });

  it('nadie da apps que no tiene', () => {
    expect(canGiveApps({ role: 'admin', apps: ['crm'] }, ['crm'])).toBe(true);
    expect(canGiveApps({ role: 'admin', apps: ['crm'] }, ['crm', 'docs'])).toBe(false);
    expect(canGiveApps({ role: 'admin', apps: ['crm'] }, '*')).toBe(false);
    expect(canGiveApps({ role: 'admin', apps: ['crm'] }, ['crm'], ['docs', 'crm'])).toBe(true);
    expect(canGiveApps({ role: 'owner', apps: ['crm'] }, '*')).toBe(true);
  });
});

describe('cada rol contra las rutas', () => {
  it('invitar: owner nombra admins; admin solo members y guests; member y guest no invitan', async () => {
    const c = await cast();
    const url = 'http://localhost/api/teams/invites';
    const tries: Array<[UserRow, Role, string, number]> = [
      [c.owner, 'owner', 'admin', 201],
      [c.admin, 'admin', 'admin', 403],
      [c.admin, 'admin', 'member', 201],
      [c.admin, 'admin', 'guest', 201],
      [c.mem, 'member', 'member', 403],
      [c.guest, 'guest', 'guest', 403],
    ];
    for (const [who, role, asRole, status] of tries) {
      await actAs(c.owner, who, role);
      const res = await invites.POST(send(url, 'POST', { emails: `x-${crypto.randomUUID().slice(0, 6)}@acme.io`, role: asRole }));
      expect(res.status, `${role} invita ${asRole}`).toBe(status);
    }
    // Link de invitación: nunca de admin, ni para el owner.
    await actAs(c.owner, c.owner, 'owner');
    expect((await invites.POST(send(url, 'POST', { link: true, role: 'admin' }))).status).toBe(400);
    const link = await invites.POST(send(url, 'POST', { link: true, role: 'member', apps: ['docs'] }));
    expect(link.status).toBe(201);
    const body = (await link.json()) as { results: Array<{ url: string; inviteId: string }> };
    expect(body.results[0].url).toContain('/invite/');
    const row = (await getDb().prepare('SELECT email, role, apps FROM team_invites WHERE id = ?').get(body.results[0].inviteId)) as { email: string; role: string; apps: string };
    expect(row).toEqual({ email: '', role: 'member', apps: '["docs"]' });
    // Un admin con solo CRM no regala Docs por link.
    await actAs(c.owner, c.admin, 'admin', ['crm']);
    expect((await invites.POST(send(url, 'POST', { link: true, role: 'member', apps: ['docs'] }))).status).toBe(403);
    // Quedó en el registro.
    expect((await listAudit(c.team.id)).some((a) => a.action === 'invite.create' && a.after.link === true)).toBe(true);
  });

  it('revocar: un admin no revoca la invitación de admin que hizo el owner', async () => {
    const c = await cast();
    const adminInvite = await createInvite(c.team.id, 'jefa@acme.io', c.owner.id, { role: 'admin' });
    const memberInvite = await createInvite(c.team.id, 'gente@acme.io', c.owner.id, { role: 'member' });
    await actAs(c.owner, c.admin, 'admin');
    expect((await invite.DELETE(send('http://localhost/x', 'DELETE'), params({ id: adminInvite.id }))).status).toBe(403);
    expect((await invite.DELETE(send('http://localhost/x', 'DELETE'), params({ id: memberInvite.id }))).status).toBe(200);
    await actAs(c.owner, c.mem, 'member');
    expect((await invite.DELETE(send('http://localhost/x', 'DELETE'), params({ id: adminInvite.id }))).status).toBe(403);
  });

  it('cambiar rol y apps: cada uno solo a quien puede, y queda registrado con lo de antes', async () => {
    const c = await cast();
    const patch = (target: string, body: unknown) => member.PATCH(send(U, 'PATCH', body), params({ userId: target }));
    await actAs(c.owner, c.mem, 'member');
    expect((await patch(c.mem2.id, { role: 'guest' })).status).toBe(403);
    await actAs(c.owner, c.guest, 'guest');
    expect((await patch(c.mem2.id, { apps: ['crm'] })).status).toBe(403);
    await actAs(c.owner, c.admin, 'admin');
    expect((await patch(c.admin2.id, { role: 'member' })).status).toBe(403);
    expect((await patch(c.mem2.id, { role: 'admin' })).status).toBe(403);
    expect((await patch(c.owner.id, { apps: ['crm'] })).status).toBe(403);
    expect((await patch(c.admin.id, { apps: ['crm'] })).status).toBe(403);
    expect((await patch(c.mem2.id, { apps: ['crm'] })).status).toBe(200);
    // Deshacer = volver a mandar lo de antes, por la misma ruta.
    expect((await patch(c.mem2.id, { apps: '*' })).status).toBe(200);
    expect((await getMembership(c.team, c.mem2.id))?.apps).toBe('*');
    await actAs(c.owner, c.owner, 'owner');
    expect((await patch(c.mem2.id, { role: 'admin' })).status).toBe(200);
    expect(await getMemberRole(c.team.id, c.mem2.id)).toBe('admin');
    const log = await listAudit(c.team.id, { targetId: c.mem2.id });
    expect(log.map((a) => a.action)).toEqual(['member.role', 'member.apps', 'member.apps']);
    expect(log[0]).toMatchObject({ actorId: c.owner.id, before: { role: 'member' }, after: { role: 'admin' } });
    expect(log[2]).toMatchObject({ actorId: c.admin.id, before: { apps: '*' }, after: { apps: ['crm'] } });
  });

  it('quitar con traspaso, sumar de nuevo con lo mismo y nadie más lo hace', async () => {
    const c = await cast();
    const g = (await createGroup(c.owner.id, { name: 'Ventas', memberIds: [c.mem.id] })).id;
    // Trabajo de mem: un issue abierto de Track y un contacto del CRM a su nombre.
    const project = `p-${crypto.randomUUID().slice(0, 8)}`;
    await getDb().prepare('INSERT INTO track_projects (id, owner_id, name, slug) VALUES (?, ?, ?, ?)').run(project, c.owner.id, 'Core', project);
    await getDb()
      .prepare("INSERT INTO track_issues (id, project_id, identifier, title, creator_id, assignee_id, priority) VALUES (?, ?, 'C-1', 'Algo', ?, ?, 'medium')")
      .run(`i-${project}`, project, c.owner.id, c.mem.id);
    await getDb().prepare('INSERT INTO crm_contacts (id, user_id, owner_id, first_name) VALUES (?, ?, ?, ?)').run(`c-${project}`, c.owner.id, c.mem.id, 'Ana');

    const del = (target: string, body?: unknown) => member.DELETE(send(U, 'DELETE', body), params({ userId: target }));
    await actAs(c.owner, c.mem2, 'member');
    expect((await del(c.mem.id)).status).toBe(403);
    await actAs(c.owner, c.admin, 'admin');
    expect((await del(c.admin2.id)).status).toBe(403);
    // Cuánto tiene a cargo (para el diálogo).
    const owned = await member.POST(send(U, 'POST', { action: 'owned' }), params({ userId: c.mem.id }));
    expect(await owned.json()).toEqual({ trackIssues: 1, crmRecords: 1 });
    // No se le pasa a un guest ni a alguien de afuera.
    expect((await del(c.mem.id, { transferTo: c.guest.id })).status).toBe(400);
    const res = await del(c.mem.id, { transferTo: c.mem2.id });
    expect(res.status).toBe(200);
    expect(await getMemberRole(c.team.id, c.mem.id)).toBeNull();
    expect(((await getDb().prepare('SELECT assignee_id FROM track_issues WHERE id = ?').get(`i-${project}`)) as { assignee_id: string }).assignee_id).toBe(c.mem2.id);
    expect(((await getDb().prepare('SELECT owner_id FROM crm_contacts WHERE id = ?').get(`c-${project}`)) as { owner_id: string }).owner_id).toBe(c.mem2.id);

    // Aparece en Quitados y vuelve con su rol, apps y equipo.
    const dir = (await (await directory.GET(send('http://localhost/api/teams/members', 'GET'))).json()) as { deactivated: Array<{ userId: string }> };
    expect(dir.deactivated.map((d) => d.userId)).toContain(c.mem.id);
    await actAs(c.owner, c.mem2, 'member');
    expect((await member.POST(send(U, 'POST', { action: 'reactivate' }), params({ userId: c.mem.id }))).status).toBe(403);
    await actAs(c.owner, c.admin, 'admin');
    expect((await member.POST(send(U, 'POST', { action: 'reactivate' }), params({ userId: c.mem.id }))).status).toBe(200);
    expect(await getMembership(c.team, c.mem.id)).toEqual({ role: 'member', apps: ['crm', 'docs'], caps: [] });
    const back = (await getDb().prepare('SELECT 1 AS x FROM workspace_group_members WHERE group_id = ? AND user_id = ?').get(g, c.mem.id)) as { x: number } | undefined;
    expect(back?.x).toBe(1);
    expect((await member.POST(send(U, 'POST', { action: 'reactivate' }), params({ userId: c.mem.id }))).status).toBe(404);
    // Si después se va por su cuenta, nadie la vuelve a sumar sin que quiera.
    await actAs(c.owner, c.owner, 'owner');
    expect((await del(c.mem.id)).status).toBe(200);
    await actAs(c.owner, c.mem, 'member');
    expect((await del('self')).status).toBe(404);
    await actAs(c.owner, c.owner, 'owner');
    await addMember(c.team.id, c.mem.id, 'member', { apps: ['docs'] });
    await actAs(c.owner, c.mem, 'member');
    expect((await del('self')).status).toBe(200);
    await actAs(c.owner, c.owner, 'owner');
    expect((await member.POST(send(U, 'POST', { action: 'reactivate' }), params({ userId: c.mem.id }))).status).toBe(404);
    // A quien no usa el CRM no se le pasan registros del CRM.
    const sol = await makeUser('sol');
    await addMember(c.team.id, sol.id, 'member', { apps: ['docs'] });
    await addMember(c.team.id, c.mem.id, 'member', { apps: ['crm'] });
    await getDb().prepare("UPDATE crm_contacts SET owner_id = ? WHERE id = ?").run(c.mem.id, `c-${project}`);
    expect((await del(c.mem.id, { transferTo: sol.id })).status).toBe(200);
    expect(((await getDb().prepare('SELECT owner_id FROM crm_contacts WHERE id = ?').get(`c-${project}`)) as { owner_id: string }).owner_id).toBe(c.mem.id);

    // Un admin quitado solo vuelve por el owner.
    await actAs(c.owner, c.owner, 'owner');
    expect((await del(c.admin2.id)).status).toBe(200);
    await actAs(c.owner, c.admin, 'admin');
    expect((await member.POST(send(U, 'POST', { action: 'reactivate' }), params({ userId: c.admin2.id }))).status).toBe(403);
    const actions = (await listAudit(c.team.id)).map((a) => a.action);
    expect(actions).toEqual(expect.arrayContaining(['member.remove', 'member.transfer', 'member.reactivate']));
  });

  it('qué puede ver: solo owner y admins lo consultan; refleja apps y lo compartido', async () => {
    const c = await cast();
    const get = (target: string) => member.GET(send('http://localhost/api/teams/members/x', 'GET'), params({ userId: target }));
    await actAs(c.owner, c.mem2, 'member');
    expect((await get(c.mem.id)).status).toBe(403);
    await actAs(c.owner, c.guest, 'guest');
    expect((await get(c.mem.id)).status).toBe(403);
    await actAs(c.owner, c.admin, 'admin');
    const view = (await (await get(c.mem.id)).json()) as { role: string; apps: Array<{ app: string; allowed: boolean; detail: string | null }> };
    expect(view.role).toBe('member');
    const allowed = view.apps.filter((a) => a.allowed).map((a) => a.app);
    expect(allowed.sort()).toEqual(['crm', 'docs']);
    expect(view.apps.find((a) => a.app === 'crm')?.detail).toBe('Sees every record');
    const g = (await (await get(c.guest.id)).json()) as { apps: Array<{ allowed: boolean }> };
    expect(g.apps.every((a) => !a.allowed)).toBe(true);
    expect((await get('nadie')).status).toBe(404);
  });

  it('otras apps siguen la misma regla: CRM, webhooks, ficha, equipos y API keys', async () => {
    const c = await cast();
    const crmUrl = 'http://localhost/api/crm/objects';
    const hookUrl = 'http://localhost/api/webhooks';
    const expectations: Array<[UserRow, Role, '*' | string[], { crm: number; hook: number; ws: number; groups: number }]> = [
      [c.owner, 'owner', '*', { crm: 400, hook: 400, ws: 200, groups: 400 }],
      [c.admin, 'admin', '*', { crm: 400, hook: 400, ws: 200, groups: 400 }],
      [c.admin, 'admin', ['crm'], { crm: 400, hook: 403, ws: 200, groups: 400 }],
      [c.mem, 'member', ['crm', 'docs'], { crm: 403, hook: 403, ws: 403, groups: 403 }],
    ];
    for (const [who, role, apps, want] of expectations) {
      await actAs(c.owner, who, role, apps);
      const label = `${role} ${JSON.stringify(apps)}`;
      // Un cuerpo vacío: quien puede llega a la validación (400); quien no, 403.
      expect((await crmObjects.POST(send(crmUrl, 'POST', {}))).status, `crm ${label}`).toBe(want.crm);
      expect((await webhooks.POST(send(hookUrl, 'POST', {}))).status, `webhooks ${label}`).toBe(want.hook);
      expect((await ws.PATCH(send('http://localhost/api/teams/workspace', 'PATCH', {}))).status, `ws ${label}`).toBe(want.ws);
      expect((await groups.POST(send('http://localhost/api/teams/groups', 'POST', {}))).status, `groups ${label}`).toBe(want.groups);
    }
    // API keys: un member ve solo las suyas; un admin, todas.
    await getDb().prepare("INSERT INTO api_keys (id, user_id, created_by, name, key_hash, prefix) VALUES (?, ?, ?, 'a', ?, 'zs_a')").run(`k1-${c.team.id}`, c.owner.id, c.admin.id, `h1-${c.team.id}`);
    await getDb().prepare("INSERT INTO api_keys (id, user_id, created_by, name, key_hash, prefix) VALUES (?, ?, ?, 'm', ?, 'zs_m')").run(`k2-${c.team.id}`, c.owner.id, c.mem.id, `h2-${c.team.id}`);
    await actAs(c.owner, c.mem, 'member', ['crm', 'docs']);
    const mine = (await (await keys.GET()).json()) as { keys: Array<{ id: string }> };
    expect(mine.keys.map((k) => k.id)).toEqual([`k2-${c.team.id}`]);
    await actAs(c.owner, c.admin, 'admin');
    const all = (await (await keys.GET()).json()) as { keys: Array<{ id: string }> };
    expect(all.keys.map((k) => k.id).sort()).toEqual([`k1-${c.team.id}`, `k2-${c.team.id}`].sort());
  });
});
