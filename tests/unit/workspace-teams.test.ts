import { describe, expect, it } from 'vitest';
import { createClient } from '@libsql/client';
import os from 'os';
import path from 'path';
import { MIGRATIONS, runMigrations } from '@/lib/schema/migrations';
import { workspaceTeamsUp } from '@/lib/schema/workspace-migrations';
import { getDb, upsertUser } from '@/lib/db';
import {
  acceptInvite,
  addMember,
  createInvite,
  createTeam,
  getInviteByToken,
  removeMember,
  resolveWorkspace,
  setActiveTeam,
  setMemberRole,
} from '@/lib/teams';
import {
  appFromPath,
  canUseApp,
  domainWorkspaces,
  ensureWorkspace,
  fichaId,
  listMyWorkspaces,
  listOwnerSpacePeople,
  parseApps,
  serializeApps,
  updateWorkspace,
} from '@/lib/workspace';
import { createGroup, deleteGroup, groupMembersBySlug, listGroups, updateGroup } from '@/lib/workspace-groups';
import { inviteMany, parseEmailList } from '@/lib/workspace-invites';
import { renderInviteEmail } from '@/lib/invite-email';
import { createApiKey } from '@/lib/api-auth';
import { listChatAgents } from '@/lib/chat-data';
import { updateChatTeam } from '@/lib/chat-collab';
import { createProject, listProjectMembers } from '@/lib/track-data';
import { listTalkGroups } from '@/lib/talk';
import { saveBasicProfile, saveOnboarding, suggestTeamName, onboardingDestination } from '@/lib/onboarding';
import { makeUser } from './helpers';

function freshClient() {
  return createClient({ url: `file:${path.join(os.tmpdir(), `ws128-${crypto.randomUUID()}.db`)}` });
}

const uid = () => crypto.randomUUID().slice(0, 8);

describe('128_workspace_teams: migración aditiva sobre datos de antes', () => {
  it('conserva equipos, ids y datos; agrega fichas, onboarding y subequipos espejados', async () => {
    const client = freshClient();
    const idx = MIGRATIONS.findIndex((m) => m.id === '128_workspace_teams');
    expect(idx).toBeGreaterThan(0);
    await runMigrations(client, MIGRATIONS.slice(0, idx));
    const exec = (sql: string, args: Array<string | null> = []) => client.execute({ sql, args });
    for (const [id, created] of [
      ['a', '2026-01-01 10:00:00'],
      ['b', '2026-01-02 10:00:00'],
      ['c', '2026-01-03 10:00:00'],
      ['d', '2026-01-04 10:00:00'],
    ]) {
      await exec('INSERT INTO users (id, email, name, handle, created_at) VALUES (?, ?, ?, ?, ?)', [id, `${id}@acme.io`, id.toUpperCase(), id, created]);
    }
    // a tiene dos equipos (t1 el más viejo); b en t1, d en t2; c sin equipo.
    await exec("INSERT INTO teams (id, name, owner_id, created_at) VALUES ('t1', 'Acme', 'a', '2026-02-01 00:00:00')");
    await exec("INSERT INTO teams (id, name, owner_id, created_at) VALUES ('t2', 'Acme Labs', 'a', '2026-03-01 00:00:00')");
    await exec("INSERT INTO team_members (team_id, user_id, role) VALUES ('t1', 'a', 'owner'), ('t1', 'b', 'admin'), ('t2', 'a', 'owner'), ('t2', 'd', 'member')");
    await exec("UPDATE users SET active_team_id = 't1' WHERE id = 'b'");
    await exec("INSERT INTO team_invites (id, team_id, email, token, invited_by) VALUES ('i1', 't1', 'e@acme.io', 'tok1', 'a')");
    await exec("INSERT INTO track_projects (id, team_id, owner_id, name, slug) VALUES ('p1', 't1', 'a', 'Mobile', 'MOB'), ('p2', NULL, 'a', 'Personal', 'PER')");
    await exec("INSERT INTO crm_sales_teams (id, user_id, name) VALUES ('s1', 'a', 'Ventas')");
    await exec("INSERT INTO crm_sales_team_members (team_id, user_id, person_id) VALUES ('s1', 'a', 'b')");
    await exec("INSERT INTO chat_teams (id, workspace_id, name) VALUES ('c1', 'a', 'Soporte')");
    await exec("INSERT INTO chat_team_members (team_id, user_id) VALUES ('c1', 'b')");
    await exec("INSERT INTO groups_teams (id, user_id, name) VALUES ('g1', 'a', 'Guardia')");
    await exec("INSERT INTO groups_team_members (team_id, person_id) VALUES ('g1', 'b')");
    const before = {
      projects: (await exec('SELECT id, team_id, owner_id, slug FROM track_projects ORDER BY id')).rows.map((r) => ({ ...r })),
    };

    await runMigrations(client);

    // Nada se borró ni cambió de id.
    const teams = (await exec('SELECT id, owner_id, keyed_by, use_mode FROM teams ORDER BY created_at, id')).rows.map((r) => ({ ...r }));
    expect(teams.filter((t) => t.owner_id === 'a').map((t) => [t.id, t.keyed_by])).toEqual([
      ['t1', 'team'],
      ['t2', 'team'],
    ]);
    expect((await exec('SELECT id, team_id, owner_id, slug FROM track_projects ORDER BY id')).rows.map((r) => ({ ...r }))).toEqual(before.projects);
    expect((await exec("SELECT status FROM team_invites WHERE id = 'i1'")).rows[0].status).toBe('pending');
    expect((await exec("SELECT active_team_id FROM users WHERE id = 'b'")).rows[0].active_team_id).toBe('t1');
    expect((await exec("SELECT role FROM team_members WHERE team_id = 't1' AND user_id = 'b'")).rows[0].role).toBe('admin');
    // Fichas nuevas para quien no tenía equipo (b, c, d), con su owner adentro.
    for (const u of ['b', 'c', 'd']) {
      const row = (await exec('SELECT id, keyed_by FROM teams WHERE owner_id = ?', [u])).rows[0];
      expect(row.id).toBe(`ws_${u}`);
      expect(row.keyed_by).toBe('owner');
      expect((await exec("SELECT role FROM team_members WHERE team_id = ? AND user_id = ?", [`ws_${u}`, u])).rows[0].role).toBe('owner');
    }
    // Los de antes no ven el onboarding.
    expect((await exec("SELECT onboarded_at FROM users WHERE id = 'c'")).rows[0].onboarded_at).toBe('2026-01-03 10:00:00');
    // Subequipos de las tres apps con el mismo id, cada uno solo en su app (no se copian entre apps).
    const groups = (await exec("SELECT id, source, slug FROM workspace_groups WHERE workspace_id = 'a' ORDER BY id")).rows.map((r) => [r.id, r.source, r.slug]);
    expect(groups).toEqual([
      ['c1', 'chat', 'soporte'],
      ['g1', 'groups', 'guardia'],
      ['s1', 'crm', 'ventas'],
    ]);
    expect((await exec("SELECT COUNT(*) AS n FROM crm_sales_teams WHERE user_id = 'a'")).rows[0].n).toBe(1);
    expect((await exec("SELECT COUNT(*) AS n FROM chat_teams WHERE workspace_id = 'a'")).rows[0].n).toBe(1);
    expect((await exec("SELECT COUNT(*) AS n FROM groups_teams WHERE user_id = 'a'")).rows[0].n).toBe(1);
    expect((await exec("SELECT COUNT(*) AS n FROM chat_team_members WHERE user_id = 'b'")).rows[0].n).toBe(1);
    expect((await exec("SELECT COUNT(*) AS n FROM crm_sales_team_members WHERE user_id = 'a'")).rows[0].n).toBe(1);
    expect((await exec("SELECT apps FROM workspace_groups WHERE id = 's1'")).rows[0].apps).toBe('["crm"]');
    // Idempotente: correrla de nuevo no cambia nada.
    const count = async () => (await exec('SELECT (SELECT COUNT(*) FROM teams) + (SELECT COUNT(*) FROM workspace_groups) + (SELECT COUNT(*) FROM team_members) AS n')).rows[0].n;
    const n = await count();
    await workspaceTeamsUp(client);
    expect(await count()).toBe(n);
    expect((await exec("SELECT keyed_by FROM teams WHERE id = 'ws_c'")).rows[0].keyed_by).toBe('owner');
  });
});

describe('workspace: acceso por app y paths', () => {
  it('parsea, serializa y decide el acceso', () => {
    expect(parseApps('*')).toBe('*');
    expect(parseApps('["crm","docs","nope"]')).toEqual(['crm', 'docs']);
    expect(serializeApps(['crm', 'crm'])).toBe('["crm"]');
    expect(canUseApp({ role: 'member', apps: ['crm'] }, 'crm')).toBe(true);
    expect(canUseApp({ role: 'member', apps: ['crm'] }, 'track')).toBe(false);
    expect(canUseApp({ role: 'guest', apps: '*' }, 'docs')).toBe(false);
    expect(canUseApp({ role: 'owner', apps: [] }, 'docs')).toBe(true);
    expect(appFromPath('/es/app/calendar/bookings')).toBe('cal');
    expect(appFromPath('/api/boards/x')).toBe('board');
    expect(appFromPath('/api/links/x')).toBe('link');
    expect(appFromPath('/en/app/settings/members')).toBeNull();
  });
});

describe('workspace: crear equipo, invitar, aceptar y sacar', () => {
  it('un workspace nuevo comparte los datos del owner con quien acepta, en todas las apps', async () => {
    const owner = await makeUser('owner');
    const ws = await ensureWorkspace(owner.id);
    expect(ws.id).toBe(fichaId(owner.id));
    expect(await ensureWorkspace(owner.id)).toMatchObject({ id: ws.id });
    expect(await updateWorkspace(ws.id, { name: 'Darwin AI', mode: 'team' })).toBeNull();

    const mate = await upsertUser({ email: `mate-${uid()}@darwin.ai`, name: 'Mate' });
    const invite = await createInvite(ws.id, mate.email, owner.id, { role: 'member', apps: ['crm', 'docs', 'track'], locale: 'es' });
    // Un solo link vivo por persona: invitar de nuevo reusa la invitación.
    expect((await createInvite(ws.id, mate.email.toUpperCase(), owner.id, { role: 'member', apps: ['crm', 'docs', 'track'] })).id).toBe(invite.id);
    const team = await acceptInvite((await getInviteByToken(invite.token))!, mate.id);
    expect(team?.id).toBe(ws.id);
    // De un solo uso.
    expect(await acceptInvite((await getInviteByToken(invite.token))!, mate.id)).toBeNull();
    expect(await setActiveTeam(mate.id, ws.id)).toBe(true);
    const r = await resolveWorkspace((await getDb().prepare('SELECT * FROM users WHERE id = ?').get(mate.id)) as never);
    expect(r.owner.id).toBe(owner.id);
    expect(r.team).toBeNull(); // Track y Chat usan el id del owner
    expect(r.workspace.name).toBe('Darwin AI');
    expect(r.role).toBe('member');
    expect(r.apps).toEqual(['crm', 'docs', 'track']);

    // Track: el proyecto del owner lo ve y lo asigna el equipo.
    const project = await createProject(owner.id, null, { name: `Core ${uid()}` });
    expect((await listProjectMembers(project.id, owner.id)).map((p) => p.id).sort()).toEqual([owner.id, mate.id].sort());
    // Chat: solo quienes tienen Chat.
    expect((await listChatAgents(owner.id, null)).map((a) => a.id)).toEqual([owner.id]);
    await getDb().prepare("UPDATE team_members SET apps = '*' WHERE team_id = ? AND user_id = ?").run(ws.id, mate.id);
    expect((await listChatAgents(owner.id, null)).map((a) => a.id).sort()).toEqual([owner.id, mate.id].sort());
    expect((await listOwnerSpacePeople(owner.id)).map((p) => p.role)).toEqual(['owner', 'member']);

    // El switcher muestra los dos workspaces de la persona.
    const entries = await listMyWorkspaces(mate);
    expect(entries.map((e) => [e.own, e.name])).toEqual([
      [true, 'Mate'],
      [false, 'Darwin AI'],
    ]);

    // Sacarla corta todo: workspace activo, API keys, subequipos.
    const group = await createGroup(owner.id, { name: `Ventas ${uid()}`, memberIds: [mate.id], apps: ['crm'] });
    const key = await createApiKey(owner.id, 'mate key', mate.id);
    await removeMember(ws.id, mate.id);
    const after = await resolveWorkspace((await getDb().prepare('SELECT * FROM users WHERE id = ?').get(mate.id)) as never);
    expect(after.owner.id).toBe(mate.id);
    expect(((await getDb().prepare('SELECT revoked FROM api_keys WHERE id = ?').get(key.id)) as { revoked: number }).revoked).toBe(1);
    expect((await listGroups(owner.id)).find((g) => g.id === group.id)?.members).toEqual([]);
    expect((await getDb().prepare('SELECT COUNT(*) AS n FROM crm_sales_team_members WHERE team_id = ?').get(group.id)) as { n: number }).toEqual({ n: 0 });
    expect(await setActiveTeam(mate.id, ws.id)).toBe(false);
  });

  it('un guest no entra al workspace ni cuenta como persona del equipo', async () => {
    const owner = await makeUser('gowner');
    const ws = await ensureWorkspace(owner.id);
    const guest = await makeUser('guest');
    const inv = await createInvite(ws.id, guest.email, owner.id, { role: 'guest' });
    await acceptInvite(inv, guest.id);
    expect(await setActiveTeam(guest.id, ws.id)).toBe(false);
    await getDb().prepare('UPDATE users SET active_team_id = ? WHERE id = ?').run(ws.id, guest.id);
    const r = await resolveWorkspace((await getDb().prepare('SELECT * FROM users WHERE id = ?').get(guest.id)) as never);
    expect(r.owner.id).toBe(guest.id);
    expect((await listOwnerSpacePeople(owner.id)).map((p) => p.id)).toEqual([owner.id]);
    // Bajar a guest a un miembro lo saca del workspace.
    const m = await makeUser('member');
    await addMember(ws.id, m.id, 'member');
    expect((await listOwnerSpacePeople(owner.id)).length).toBe(2);
    await setMemberRole(ws.id, m.id, 'guest');
    expect((await listOwnerSpacePeople(owner.id)).length).toBe(1);
  });

  it('los equipos de antes de 128 siguen con la clave del equipo', async () => {
    const owner = await makeUser('legacy');
    const t = await createTeam(owner.id, 'Legacy');
    const m = await makeUser('lm');
    await addMember(t.id, m.id, 'member');
    await setActiveTeam(m.id, t.id);
    const r = await resolveWorkspace((await getDb().prepare('SELECT * FROM users WHERE id = ?').get(m.id)) as never);
    expect(r.team?.id).toBe(t.id);
    expect(r.workspace.id).toBe(t.id);
    // El owner, en su espacio personal, sigue como antes; su ficha es el equipo más viejo.
    const own = await resolveWorkspace(owner);
    expect(own.team).toBeNull();
    expect(own.workspace.id).toBe(t.id);
    expect((await listMyWorkspaces(owner)).map((e) => [e.teamId, e.personal])).toEqual([
      [null, true],
      [t.id, false],
    ]);
  });
});

describe('workspace: subequipos en todas las apps', () => {
  it('crear, editar desde Chat y borrar se ve en CRM, Chat, Groups y Talk', async () => {
    const owner = await makeUser('gw');
    const ws = await ensureWorkspace(owner.id);
    const a = await makeUser('ga');
    await addMember(ws.id, a.id);
    // Sin elegir apps, un subequipo nuevo no toca la visibilidad del CRM ni Chat ni Groups.
    const plain = await createGroup(owner.id, { name: `Solo Talk ${crypto.randomUUID().slice(0, 4)}`, memberIds: [a.id] });
    expect(plain.apps).toEqual([]);
    expect(await getDb().prepare('SELECT 1 AS x FROM crm_sales_teams WHERE id = ?').get(plain.id)).toBeUndefined();
    expect(await getDb().prepare('SELECT 1 AS x FROM chat_teams WHERE id = ?').get(plain.id)).toBeUndefined();
    const g = await createGroup(owner.id, { name: 'Soporte Norte', memberIds: [a.id], leadIds: [a.id], apps: ['crm', 'chat', 'groups'] });
    expect(g.slug).toBe('soporte-norte');
    const db = getDb();
    expect(await db.prepare('SELECT name FROM crm_sales_teams WHERE id = ?').get(g.id)).toEqual({ name: 'Soporte Norte' });
    expect(await db.prepare('SELECT user_id FROM chat_team_members WHERE team_id = ?').all(g.id)).toEqual([{ user_id: a.id }]);
    expect(await db.prepare('SELECT person_id FROM groups_team_members WHERE team_id = ?').all(g.id)).toEqual([{ person_id: a.id }]);
    expect(await groupMembersBySlug(owner.id, 'soporte-norte')).toEqual([a.id]);
    expect((await listTalkGroups(owner.id)).find((x) => x.id === g.id)?.handle).toBe('soporte-norte');
    // Un nombre repetido no se acepta.
    await expect(createGroup(owner.id, { name: 'soporte norte' })).rejects.toThrow('duplicate_name');
    // Chat lo edita desde su pantalla: el directorio y las demás apps se enteran.
    await updateChatTeam(owner.id, g.id, { name: 'Soporte', memberIds: [owner.id, a.id] }, [owner.id, a.id]);
    const synced = (await listGroups(owner.id)).find((x) => x.id === g.id)!;
    expect(synced.name).toBe('Soporte');
    expect(synced.members.map((m) => m.user_id).sort()).toEqual([owner.id, a.id].sort());
    expect(await db.prepare('SELECT name FROM groups_teams WHERE id = ?').get(g.id)).toEqual({ name: 'Soporte' });
    expect(((await db.prepare('SELECT COUNT(*) AS n FROM crm_sales_team_members WHERE team_id = ?').get(g.id)) as { n: number }).n).toBe(2);
    expect((await updateGroup(owner.id, g.id, { memberIds: [a.id] }))?.members.map((m) => m.role)).toEqual(['lead']);
    // Dejar de usarlo en el CRM lo saca del CRM (y sigue en las demás).
    await updateGroup(owner.id, g.id, { apps: ['chat', 'groups'] });
    expect(await db.prepare('SELECT 1 AS x FROM crm_sales_teams WHERE id = ?').get(g.id)).toBeUndefined();
    expect(await db.prepare('SELECT 1 AS x FROM chat_teams WHERE id = ?').get(g.id)).toBeTruthy();
    expect(await deleteGroup(owner.id, g.id)).toBe(true);
    expect(await db.prepare('SELECT 1 AS x FROM chat_teams WHERE id = ?').get(g.id)).toBeUndefined();
    expect(await db.prepare('SELECT 1 AS x FROM crm_sales_teams WHERE id = ?').get(g.id)).toBeUndefined();
  });
});

describe('invitaciones por email', () => {
  it('separa listas pegadas y descarta lo que no es email', () => {
    expect(parseEmailList('Ana <ana@x.com>, leo@y.com\nana@x.com; mal, mailto:z@z.io')).toEqual({
      valid: ['ana@x.com', 'leo@y.com', 'z@z.io'],
      invalid: ['mal'],
    });
  });

  it('el email tiene el link, el rol y el vencimiento, en el idioma de la invitación', () => {
    const mail = renderInviteEmail({
      to: 'leo@x.com',
      url: 'https://zerosoft.ai/es/invite/abc',
      workspaceName: 'Darwin <AI>',
      inviterName: 'Lautaro',
      role: 'member',
      expiresAt: '2026-11-11T00:00:00.000Z',
      locale: 'es',
    });
    expect(mail.subject).toBe('Lautaro te invitó a Darwin <AI> en zerosoft');
    expect(mail.html).toContain('https://zerosoft.ai/es/invite/abc');
    expect(mail.html).toContain('Darwin &lt;AI&gt;');
    expect(mail.html).not.toContain('<AI>');
    expect(mail.text).toContain('11 de noviembre de 2026');
    expect(mail.html + mail.text).not.toMatch(/—/);
  });

  it('sin proveedor de email la invitación queda con el link para copiar; quien ya está no se reinvita', async () => {
    const prev = process.env.RESEND_API_KEY;
    delete process.env.RESEND_API_KEY;
    const owner = await makeUser('inv');
    const ws = await ensureWorkspace(owner.id);
    await updateWorkspace(ws.id, { mode: 'personal' });
    const m = await makeUser('already');
    await addMember(ws.id, m.id);
    const out = await inviteMany({
      team: { ...ws, use_mode: 'personal' },
      inviter: { id: owner.id, name: 'Owner', email: owner.email },
      emails: `new-${uid()}@acme.io, ${m.email}, nope`,
      base: 'https://zerosoft.ai',
      locale: 'pt',
    });
    expect(out.invalid).toEqual(['nope']);
    expect(out.results.map((r) => r.status)).toEqual(['skipped', 'member']);
    expect(out.results[0].url).toMatch(/^https:\/\/zerosoft\.ai\/pt\/invite\/[A-Za-z0-9_-]{32}$/);
    // Invitar gente pasa el workspace a modo equipo.
    expect(((await getDb().prepare('SELECT use_mode FROM teams WHERE id = ?').get(ws.id)) as { use_mode: string }).use_mode).toBe('team');
    if (prev !== undefined) process.env.RESEND_API_KEY = prev;
  });
});

describe('ficha, dominios y onboarding', () => {
  it('valida identificador y dominios, y ofrece sumarse por dominio', async () => {
    const a = await makeUser('fa');
    const b = await makeUser('fb');
    const wa = await ensureWorkspace(a.id);
    const wb = await ensureWorkspace(b.id);
    const slug = `acme-${uid()}`;
    expect(await updateWorkspace(wa.id, { slug })).toBeNull();
    expect(await updateWorkspace(wb.id, { slug })).toBe('slug_taken');
    expect(await updateWorkspace(wa.id, { allowedDomains: ['gmail.com'] })).toBe('public_domain');
    const domain = `${uid()}.example.io`;
    expect(await updateWorkspace(wa.id, { allowedDomains: [`@${domain}`] })).toBeNull();
    const colleague = await upsertUser({ email: `col-${uid()}@${domain}`, name: 'Col' });
    expect((await domainWorkspaces(colleague)).map((t) => t.id)).toEqual([wa.id]);
    expect(await domainWorkspaces(a)).toEqual([]);
  });

  it('guarda el onboarding: modo, equipo, perfil y la app de entrada', async () => {
    const u = await makeUser('ob');
    await getDb().prepare('UPDATE users SET onboarded_at = NULL WHERE id = ?').run(u.id);
    const profile = await saveOnboarding(u, { mode: 'team', teamName: 'Darwin AI', size: '11-50', role: 'sales', sourceTool: 'hubspot', entryApp: 'crm', name: 'Ana Pérez', locale: 'es', timeZone: 'America/Argentina/Buenos_Aires' });
    expect(onboardingDestination(profile, true)).toBe('/app/crm/settings?tab=import&from=hubspot');
    expect(onboardingDestination(profile, false)).toBe('/app/crm');
    const row = (await getDb().prepare('SELECT name, locale, time_zone, onboarded_at, profile FROM users WHERE id = ?').get(u.id)) as Record<string, string>;
    expect(row.name).toBe('Ana Pérez');
    expect(row.locale).toBe('es');
    expect(row.onboarded_at).toBeTruthy();
    expect(JSON.parse(row.profile)).toMatchObject({ role: 'sales', sourceTool: 'hubspot', entryApp: 'crm', nameEdited: true });
    const ws = (await getDb().prepare('SELECT name, use_mode, size FROM teams WHERE owner_id = ?').get(u.id)) as Record<string, string>;
    expect(ws).toEqual({ name: 'Darwin AI', use_mode: 'team', size: '11-50' });
    // El nombre editado no lo pisa el de Google en el próximo login.
    await upsertUser({ email: u.email, name: 'Google Name' });
    expect(((await getDb().prepare('SELECT name FROM users WHERE id = ?').get(u.id)) as { name: string }).name).toBe('Ana Pérez');
    await saveBasicProfile(u.id, { name: 'Ana', locale: 'xx', timeZone: 'Nowhere/Land', finish: false });
    expect(await getDb().prepare('SELECT name, locale, time_zone FROM users WHERE id = ?').get(u.id)).toEqual({ name: 'Ana', locale: 'es', time_zone: 'America/Argentina/Buenos_Aires' });
    expect(suggestTeamName('ana@getdarwin.ai', 'X')).toBe('Getdarwin');
    expect(suggestTeamName('ana@gmail.com', 'X')).toBe('X');
  });
});
