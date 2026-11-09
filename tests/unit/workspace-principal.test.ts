import { describe, expect, it } from 'vitest';
import { getClient, getDb, type UserRow } from '@/lib/db';
import { MIGRATIONS } from '@/lib/schema/migrations';
import { addMember, resolveWorkspace } from '@/lib/teams';
import { ensureWorkspace, getMembership, listMyWorkspaces, listTeamPeople } from '@/lib/workspace';
import { createTeamWorkspace, ensurePersonalAndTeam, isPrincipalEmail, ownedTeamWorkspace, teamWorkspaceOf } from '@/lib/workspace-principal';
import { personAppAccess } from '@/lib/api-auth';
import { saveOnboarding } from '@/lib/onboarding';
import { sendEmail } from '@/lib/email';
import { makeUser } from './helpers';

async function load(id: string): Promise<UserRow> {
  return (await getDb().prepare('SELECT * FROM users WHERE id = ?').get(id)) as UserRow;
}

describe('workspace de equipo con titular propio', () => {
  it('la persona es owner, el titular no aparece como persona y los datos no se mezclan con lo personal', async () => {
    const ana = await makeUser('wp1');
    const team = await createTeamWorkspace(ana, 'Acme');
    expect(team.owner_id).toMatch(/^wsp_/);
    expect(team.owner_id).not.toBe(ana.id);
    const principal = await load(team.owner_id);
    expect((principal as unknown as { kind: string }).kind).toBe('workspace');
    expect(isPrincipalEmail(principal.email)).toBe(true);
    expect(await getMembership(team, ana.id)).toEqual({ role: 'owner', apps: '*' });
    const people = await listTeamPeople(team);
    expect(people.map((p) => [p.user_id, p.role])).toEqual([[ana.id, 'owner']]);
    // Activo el de equipo: los datos son del titular, no de Ana.
    const r = await resolveWorkspace({ ...(await load(ana.id)), active_team_id: team.id });
    expect(r.owner.id).toBe(team.owner_id);
    expect(r.role).toBe('owner');
    // API keys y MCP: owner.
    expect(await personAppAccess(team.owner_id, ana.id)).toEqual({ role: 'owner', apps: '*' });
    // El switcher muestra los dos.
    const rows = await listMyWorkspaces(ana);
    expect(rows.map((w) => [w.teamId === null ? 'own' : w.teamId, w.role])).toEqual([['own', 'owner'], [team.id, 'owner']]);
  });

  it('un member invitado al equipo no es owner; el rol owner de team_members solo vale en estos workspaces', async () => {
    const ana = await makeUser('wp2');
    const beto = await makeUser('wp2b');
    const team = await createTeamWorkspace(ana, 'Acme');
    await addMember(team.id, beto.id, 'member');
    expect((await getMembership(team, beto.id))?.role).toBe('member');
    // En un workspace de una persona, una fila 'owner' que no es owner_id sigue valiendo admin.
    const carla = await makeUser('wp2c');
    const own = await ensureWorkspace(carla.id);
    await getDb().prepare("INSERT INTO team_members (team_id, user_id, role) VALUES (?, ?, 'owner')").run(own.id, beto.id);
    expect((await getMembership(own, beto.id))?.role).toBe('admin');
  });

  it('el titular no recibe emails', async () => {
    const ana = await makeUser('wp3');
    const team = await createTeamWorkspace(ana, 'Acme');
    const principal = await load(team.owner_id);
    expect(await sendEmail({ to: principal.email, subject: 'x', text: 'x' })).toEqual({ ok: false, error: 'no_mailbox' });
  });
});

describe('personal y equipo para cada persona', () => {
  it('ensurePersonalAndTeam es idempotente y deja la ficha propia como personal', async () => {
    const ana = await makeUser('wp4');
    const first = await ensurePersonalAndTeam(ana);
    expect(first.created).toBe(true);
    expect(first.team.name).toMatch(/ Team$/);
    const again = await ensurePersonalAndTeam(ana);
    expect(again).toMatchObject({ created: false, team: { id: first.team.id } });
    const own = await ensureWorkspace(ana.id);
    expect((await getDb().prepare('SELECT use_mode FROM teams WHERE id = ?').get(own.id)) as { use_mode: string }).toEqual({ use_mode: 'personal' });
  });

  it('quien ya es parte de un equipo ajeno no recibe otro', async () => {
    const owner = await makeUser('wp5o');
    const beto = await makeUser('wp5b');
    const team = await ensureWorkspace(owner.id);
    await addMember(team.id, beto.id, 'member');
    expect((await ensurePersonalAndTeam(beto)).created).toBe(false);
    expect((await teamWorkspaceOf(beto.id))?.id).toBe(team.id);
  });

  it('onboarding "para mi equipo": arranca en el equipo con su nombre; "solo yo": en el personal', async () => {
    const t = await makeUser('wp6t');
    await saveOnboarding(t, { mode: 'team', teamName: 'Globex', size: '2-10' });
    const team = await ownedTeamWorkspace(t.id);
    expect(team?.name).toBe('Globex');
    expect((await load(t.id)).active_team_id).toBe(team?.id);
    const own = (await getDb().prepare('SELECT use_mode FROM teams WHERE id = ?').get(`ws_${t.id}`)) as { use_mode: string };
    expect(own.use_mode).toBe('personal');

    const p = await makeUser('wp6p');
    await saveOnboarding(p, { mode: 'personal', name: 'Pía' });
    expect((await load(p.id)).active_team_id ?? null).toBeNull();
    expect((await ownedTeamWorkspace(p.id))?.name).toBe('Pía Team');
  });

  it('la migración da equipo a quien no tenía y no duplica', async () => {
    const solo = await makeUser('wp7');
    await getDb().prepare("UPDATE users SET onboarded_at = datetime('now'), name = 'Sol Pérez' WHERE id = ?").run(solo.id);
    await ensureWorkspace(solo.id);
    const withTeam = await makeUser('wp7t');
    await getDb().prepare("UPDATE users SET onboarded_at = datetime('now') WHERE id = ?").run(withTeam.id);
    const mine = await ensureWorkspace(withTeam.id);
    await getDb().prepare("UPDATE teams SET use_mode = 'team' WHERE id = ?").run(mine.id);

    const mig = MIGRATIONS.find((m) => m.id === '295_personal_and_team')!;
    await mig.up(getClient());
    await mig.up(getClient());
    const owned = (await getDb().prepare("SELECT t.name FROM teams t JOIN team_members m ON m.team_id = t.id WHERE m.user_id = ? AND m.role = 'owner' AND t.owner_id LIKE 'wsp%'").all(solo.id)) as Array<{ name: string }>;
    expect(owned).toEqual([{ name: 'Sol Team' }]);
    expect(await ownedTeamWorkspace(withTeam.id)).toBeNull();
  });
});
