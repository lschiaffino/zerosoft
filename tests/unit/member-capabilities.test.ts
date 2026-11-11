import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';
import { getDb, type UserRow } from '@/lib/db';
import { addMember, getMemberCapabilities, resolveWorkspace, setMemberCapabilities, setMemberRole } from '@/lib/teams';
import { ensureWorkspace, getMembership } from '@/lib/workspace';
import { CAPABILITIES, capabilityMessageKey, hasCapability, isCapability, parseCapabilities, serializeCapabilities } from '@/lib/capabilities';
import { can, type Role } from '@/lib/roles';
import { canManageNumber, numberManager } from '@/lib/groups-number-perms';
import { resetFakeProvider } from '@/lib/groups-provider-fake';
import { listAudit } from '@/lib/workspace-admin';
import { makeUser } from './helpers';

/**
 * Capacidades por persona (lib/capabilities.ts) y la primera: conectar
 * números en Lines. El registro y la regla, lo que guarda la base, y las
 * rutas de Lines y de Miembros con la sesión de cada rol.
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

const numbers = await import('@/app/api/groups/numbers/route');
const number = await import('@/lib/routes/groups/numbers/[id]/route');
const connect = await import('@/lib/routes/groups/numbers/[id]/connect/route');
const member = await import('@/lib/routes/teams/members/[userId]/route');

beforeEach(() => {
  session.user = null;
  vi.stubEnv('GROUPS_FAKE', '1');
  vi.stubEnv('RATE_LIMIT_DISABLED', 'true');
  resetFakeProvider();
});

async function load(id: string): Promise<UserRow> {
  return (await getDb().prepare('SELECT * FROM users WHERE id = ?').get(id)) as UserRow;
}

/**
 * La sesión como la arma lib/session.ts: rol, apps y capacidades leídos de la
 * base en este momento (resolveWorkspace), así cada pedido ve lo último.
 */
async function actAs(owner: UserRow, person: UserRow) {
  const workspace = await ensureWorkspace(owner.id);
  if (person.id === owner.id) {
    session.user = { ...(await load(owner.id)), role: 'owner', apps: '*', caps: [], team: null, workspace };
    return;
  }
  await getDb().prepare('UPDATE users SET active_team_id = ? WHERE id = ?').run(workspace.id, person.id);
  const r = await resolveWorkspace(await load(person.id));
  session.user = { ...(await load(owner.id)), actingUser: await load(person.id), role: r.role, apps: r.apps, caps: r.caps, team: null, workspace };
}

const req = (url: string, method: string, body?: unknown) =>
  new NextRequest(url, { method, headers: { 'content-type': 'application/json' }, ...(body !== undefined ? { body: JSON.stringify(body) } : {}) }) as never;
const params = <T extends Record<string, string>>(p: T) => ({ params: Promise.resolve(p) });
const NUM = 'http://localhost/api/groups/numbers';
const CAP = 'lines.numbers.manage';

async function cast() {
  const owner = await makeUser('own');
  const team = await ensureWorkspace(owner.id);
  const admin = await makeUser('adm');
  const marta = await makeUser('marta');
  const nico = await makeUser('nico');
  const guest = await makeUser('gst');
  await addMember(team.id, admin.id, 'admin');
  await addMember(team.id, marta.id, 'member');
  await addMember(team.id, nico.id, 'member');
  await addMember(team.id, guest.id, 'guest', { apps: [] });
  return { owner, team, admin, marta, nico, guest };
}

describe('registro de capacidades (lib/capabilities)', () => {
  it('cada capacidad tiene clave conocida, app y textos en los tres idiomas', async () => {
    const keys = CAPABILITIES.map((c) => c.key);
    expect(new Set(keys).size).toBe(keys.length);
    for (const locale of ['en', 'es', 'pt']) {
      const msgs = (await import(`@/messages/${locale}/settings.json`)).default as { members: { perm: { caps: Record<string, { label: string; help: string; confirm: string }> } } };
      for (const c of CAPABILITIES) {
        const m = msgs.members.perm.caps[capabilityMessageKey(c.key)];
        expect(m?.label, `${locale} ${c.key}`).toBeTruthy();
        expect(m?.help, `${locale} ${c.key}`).toBeTruthy();
        if (c.confirmGrant) expect(m?.confirm, `${locale} ${c.key}`).toBeTruthy();
      }
    }
  });

  it('lee y guarda solo claves conocidas, sin repetir', () => {
    expect(isCapability(CAP)).toBe(true);
    expect(isCapability('lines.numbers.delete_everything')).toBe(false);
    expect(parseCapabilities(`["${CAP}","nope","${CAP}"]`)).toEqual([CAP]);
    expect(parseCapabilities('not json')).toEqual([]);
    expect(parseCapabilities(null)).toEqual([]);
    expect(serializeCapabilities(['x', CAP])).toBe(`["${CAP}"]`);
  });

  it('owner y admin la tienen siempre; un member, si se la dieron y usa la app; un guest, nunca', () => {
    expect(can({ role: 'owner' }, CAP)).toBe(true);
    expect(can({ role: 'admin', apps: ['crm'] }, CAP)).toBe(true);
    expect(can({ role: 'member' }, CAP)).toBe(false);
    expect(can({ role: 'member', caps: [CAP] }, CAP)).toBe(true);
    expect(can({ role: 'member', apps: '["groups","crm"]', caps: `["${CAP}"]` }, CAP)).toBe(true);
    // Sin la app de Lines la capacidad no vale.
    expect(can({ role: 'member', apps: ['crm'], caps: [CAP] }, CAP)).toBe(false);
    expect(can({ role: 'guest', caps: [CAP] }, CAP)).toBe(false);
    // Un rol raro cae en member: sin capacidades guardadas, nada.
    expect(can({ role: 'superuser' }, CAP)).toBe(false);
    expect(hasCapability({ role: 'member', caps: ['x'] }, CAP)).toBe(false);
    // La capacidad no suma acciones de admin.
    expect(can({ role: 'member', caps: [CAP] }, 'members.manage')).toBe(false);
    expect(can({ role: 'member', caps: [CAP] }, 'workspace.edit')).toBe(false);
  });

  it('administrar una línea: admins todas; con la capacidad, solo las propias', () => {
    const base = { id: 'ws', actingUser: { id: 'me' } as UserRow };
    const memberWith = numberManager({ ...base, role: 'member', apps: '*', caps: [CAP] });
    const memberWithout = numberManager({ ...base, role: 'member', apps: '*', caps: [] });
    const admin = numberManager({ ...base, role: 'admin', apps: '*', caps: [] });
    expect(memberWith).toEqual({ me: 'me', isAdmin: false, canAdd: true });
    expect(canManageNumber(memberWith, { owner_id: 'me' })).toBe(true);
    expect(canManageNumber(memberWith, { owner_id: 'other' })).toBe(false);
    expect(canManageNumber(memberWith, { owner_id: null })).toBe(false);
    expect(canManageNumber(memberWithout, { owner_id: 'me' })).toBe(false);
    expect(canManageNumber(admin, { ownerId: null })).toBe(true);
  });
});

describe('capacidades en la base', () => {
  it('la membresía las trae en cada lectura; quitarla vale en la siguiente', async () => {
    const c = await cast();
    expect((await getMembership(c.team, c.marta.id))?.caps).toEqual([]);
    await setMemberCapabilities(c.team.id, c.marta.id, [CAP, 'nope']);
    expect(await getMemberCapabilities(c.team.id, c.marta.id)).toEqual([CAP]);
    await getDb().prepare('UPDATE users SET active_team_id = ? WHERE id = ?').run(c.team.id, c.marta.id);
    expect((await resolveWorkspace(await load(c.marta.id))).caps).toEqual([CAP]);
    await setMemberCapabilities(c.team.id, c.marta.id, []);
    expect((await resolveWorkspace(await load(c.marta.id))).caps).toEqual([]);
    // Al owner no se le guardan: las tiene por rol.
    expect(await setMemberCapabilities(c.team.id, c.owner.id, [CAP])).toBe(false);
  });

  it('pasar a guest las borra: no vuelven solas si después es member otra vez', async () => {
    const c = await cast();
    await setMemberCapabilities(c.team.id, c.marta.id, [CAP]);
    await setMemberRole(c.team.id, c.marta.id, 'guest');
    await setMemberRole(c.team.id, c.marta.id, 'member');
    expect(await getMemberCapabilities(c.team.id, c.marta.id)).toEqual([]);
  });
});

describe('Miembros: quién da capacidades', () => {
  const url = (id: string) => `http://localhost/api/teams/members/${id}`;

  it('owner y admins las dan y las quitan, queda en el registro; un member no, ni a sí mismo', async () => {
    const c = await cast();
    // Un member no se las da a sí mismo ni a otro.
    await actAs(c.owner, c.marta);
    expect((await member.PATCH(req(url(c.marta.id), 'PATCH', { capabilities: [CAP] }), params({ userId: c.marta.id }))).status).toBe(403);
    expect((await member.PATCH(req(url(c.nico.id), 'PATCH', { capabilities: [CAP] }), params({ userId: c.nico.id }))).status).toBe(403);
    // Con la capacidad tampoco cambia roles ni da capacidades.
    await setMemberCapabilities(c.team.id, c.marta.id, [CAP]);
    await actAs(c.owner, c.marta);
    expect((await member.PATCH(req(url(c.nico.id), 'PATCH', { capabilities: [CAP] }), params({ userId: c.nico.id }))).status).toBe(403);
    expect((await member.PATCH(req(url(c.marta.id), 'PATCH', { role: 'admin' }), params({ userId: c.marta.id }))).status).toBe(403);
    expect(await getMemberCapabilities(c.team.id, c.nico.id)).toEqual([]);

    // Un admin se la da a Nico.
    await actAs(c.owner, c.admin);
    const ok = await member.PATCH(req(url(c.nico.id), 'PATCH', { capabilities: [CAP] }), params({ userId: c.nico.id }));
    expect(ok.status).toBe(200);
    expect(await getMemberCapabilities(c.team.id, c.nico.id)).toEqual([CAP]);
    // Claves desconocidas: 400 sin tocar nada.
    expect((await member.PATCH(req(url(c.nico.id), 'PATCH', { capabilities: ['workspace.own'] }), params({ userId: c.nico.id }))).status).toBe(400);
    // Las capacidades son de members: a un admin o a quien pasa a guest, no.
    await actAs(c.owner, c.owner);
    expect((await member.PATCH(req(url(c.admin.id), 'PATCH', { capabilities: [CAP] }), params({ userId: c.admin.id }))).status).toBe(400);
    expect((await member.PATCH(req(url(c.nico.id), 'PATCH', { role: 'guest', capabilities: [CAP] }), params({ userId: c.nico.id }))).status).toBe(400);
    expect((await getMembership(c.team, c.nico.id))?.role).toBe('member');
    // El owner la quita.
    expect((await member.PATCH(req(url(c.nico.id), 'PATCH', { capabilities: [] }), params({ userId: c.nico.id }))).status).toBe(200);
    expect(await getMemberCapabilities(c.team.id, c.nico.id)).toEqual([]);

    const log = (await listAudit(c.team.id, { targetId: c.nico.id })).filter((a) => a.action === 'member.caps');
    expect(log.map((a) => [a.actorId, a.before.caps, a.after.caps])).toEqual([
      [c.owner.id, [CAP], []],
      [c.admin.id, [], [CAP]],
    ]);
  });
});

describe('Lines: conectar números con la capacidad', () => {
  async function create(name: string): Promise<{ status: number; body: Record<string, unknown> }> {
    const res = await numbers.POST(req(NUM, 'POST', { provider: 'fake', name }));
    return { status: res.status, body: (await res.json()) as Record<string, unknown> };
  }

  it('sin la capacidad, un member recibe 403 en cada ruta de administrar', async () => {
    const c = await cast();
    await actAs(c.owner, c.owner);
    const theirs = await create(`Ventas ${Math.random()}`);
    const id = String(theirs.body.id);
    await actAs(c.owner, c.nico);
    expect((await create('No')).status).toBe(403);
    expect((await number.PATCH(req(`${NUM}/${id}`, 'PATCH', { name: 'x' }), params({ id }))).status).toBe(403);
    expect((await number.DELETE(req(`${NUM}/${id}`, 'DELETE'), params({ id }))).status).toBe(403);
    for (const action of ['connect', 'disconnect', 'sync', 'import']) {
      expect((await connect.POST(req(`${NUM}/${id}/connect`, 'POST', { action }), params({ id }))).status, action).toBe(403);
    }
    const list = (await (await numbers.GET()).json()) as { canEdit: boolean };
    expect(list.canEdit).toBe(false);
    // El guest tampoco, aunque tuviera algo guardado.
    await getDb().prepare('UPDATE team_members SET capabilities = ? WHERE team_id = ? AND user_id = ?').run(`["${CAP}"]`, c.team.id, c.guest.id);
    session.user = { ...(await load(c.owner.id)), actingUser: await load(c.guest.id), role: 'guest' as Role, apps: [], caps: [CAP], team: null, workspace: c.team };
    expect((await create('Guest')).status).toBe(403);
  });

  it('con la capacidad: conecta la suya (privada y a su nombre), no toca las ajenas, y al quitarla pierde el acceso en el pedido siguiente', async () => {
    const c = await cast();
    await actAs(c.owner, c.owner);
    const shared = await create('Soporte');
    const sharedId = String(shared.body.id);
    await setMemberCapabilities(c.team.id, c.marta.id, [CAP]);

    await actAs(c.owner, c.marta);
    const mine = await create('Marta personal');
    expect(mine.status).toBe(201);
    const id = String(mine.body.id);
    const row = (await getDb().prepare('SELECT owner_id, visibility, created_by FROM groups_numbers WHERE id = ?').get(id)) as Record<string, string>;
    expect(row).toEqual({ owner_id: c.marta.id, visibility: 'restricted', created_by: c.marta.id });
    // Conecta con QR (proveedor de prueba), ve el estado y la URL del webhook de la suya.
    expect((await connect.POST(req(`${NUM}/${id}/connect`, 'POST', { action: 'connect' }), params({ id }))).status).toBe(200);
    expect((await number.GET(req(`${NUM}/${id}`, 'GET'), params({ id }))).status).toBe(200);
    expect(((await (await number.GET(req(`${NUM}/${id}`, 'GET'), params({ id }))).json()) as { webhookUrl: string | null }).webhookUrl).toContain('/api/groups/webhook/');
    // Renombra y la comparte con Nico, pero no se la pasa a otro.
    expect((await number.PATCH(req(`${NUM}/${id}`, 'PATCH', { name: 'Marta ventas' }), params({ id }))).status).toBe(200);
    expect((await number.PATCH(req(`${NUM}/${id}`, 'PATCH', { ownerId: c.nico.id }), params({ id }))).status).toBe(403);
    expect((await number.PATCH(req(`${NUM}/${id}`, 'PATCH', { visibility: 'restricted', personIds: [c.nico.id] }), params({ id }))).status).toBe(200);
    expect(((await getDb().prepare('SELECT owner_id FROM groups_numbers WHERE id = ?').get(id)) as { owner_id: string }).owner_id).toBe(c.marta.id);
    // La línea del workspace (visible para todos) la ve, pero no la administra.
    expect((await number.PATCH(req(`${NUM}/${sharedId}`, 'PATCH', { name: 'x' }), params({ id: sharedId }))).status).toBe(403);
    expect((await number.DELETE(req(`${NUM}/${sharedId}`, 'DELETE'), params({ id: sharedId }))).status).toBe(403);
    expect((await connect.POST(req(`${NUM}/${sharedId}/connect`, 'POST', { action: 'disconnect' }), params({ id: sharedId }))).status).toBe(403);
    const listed = (await (await numbers.GET()).json()) as { canEdit: boolean; numbers: Array<{ id: string; canManage: boolean; access?: unknown }> };
    expect(listed.canEdit).toBe(true);
    expect(listed.numbers.find((n) => n.id === id)).toMatchObject({ canManage: true, access: { personIds: [c.nico.id], teamIds: [] } });
    expect(listed.numbers.find((n) => n.id === sharedId)).toMatchObject({ canManage: false });
    expect(listed.numbers.find((n) => n.id === sharedId)?.access).toBeUndefined();

    // Una línea privada de otro: ni la ve (404), aunque tenga la capacidad.
    await setMemberCapabilities(c.team.id, c.nico.id, [CAP]);
    await actAs(c.owner, c.nico);
    const nicos = await create('Nico privado');
    const nicoId = String(nicos.body.id);
    await actAs(c.owner, c.marta);
    expect((await number.GET(req(`${NUM}/${nicoId}`, 'GET'), params({ id: nicoId }))).status).toBe(404);
    expect((await number.DELETE(req(`${NUM}/${nicoId}`, 'DELETE'), params({ id: nicoId }))).status).toBe(404);
    expect(((await (await numbers.GET()).json()) as { numbers: Array<{ id: string }> }).numbers.map((n) => n.id)).not.toContain(nicoId);
    // Nico ve la de Marta (se la compartió), pero no la administra.
    await actAs(c.owner, c.nico);
    expect((await number.DELETE(req(`${NUM}/${id}`, 'DELETE'), params({ id }))).status).toBe(403);
    // El admin ve y administra todas.
    await actAs(c.owner, c.admin);
    expect((await number.PATCH(req(`${NUM}/${nicoId}`, 'PATCH', { name: 'Revisada' }), params({ id: nicoId }))).status).toBe(200);

    // El admin le quita la capacidad a Marta: el pedido siguiente ya es 403.
    await member.PATCH(req(`http://localhost/api/teams/members/${c.marta.id}`, 'PATCH', { capabilities: [] }), params({ userId: c.marta.id }));
    await actAs(c.owner, c.marta);
    expect((await number.PATCH(req(`${NUM}/${id}`, 'PATCH', { name: 'otra' }), params({ id }))).status).toBe(403);
    expect((await create('Otra')).status).toBe(403);
    // Sigue viendo los chats de su línea (es la dueña), pero ya no el QR.
    const st = (await (await connect.GET(req(`${NUM}/${id}/connect`, 'GET'), params({ id }))).json()) as Record<string, unknown>;
    expect(st.qr).toBeUndefined();
    // Borrar la suya (de nuevo con la capacidad) funciona.
    await setMemberCapabilities(c.team.id, c.marta.id, [CAP]);
    await actAs(c.owner, c.marta);
    expect((await number.DELETE(req(`${NUM}/${id}`, 'DELETE'), params({ id }))).status).toBe(200);
  });
});
