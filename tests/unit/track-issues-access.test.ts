import { describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';
import { getClient, getDb } from '@/lib/db';
import { MIGRATIONS } from '@/lib/schema/migrations';
import { addMember, createTeam } from '@/lib/teams';
import {
  createCycle,
  createIssue,
  createProject,
  createStatus,
  getAccessibleIssue,
  getIssue,
  listIssueActivities,
  listStatuses,
  updateProject,
} from '@/lib/track-data';
import { parseClosingIdentifiers } from '@/lib/track-github';
import { createLabel, listLabels, parseIssueLabels } from '@/lib/track-labels';
import { makeUser } from './helpers';

const session = vi.hoisted(() => ({ user: null as null | Record<string, unknown> }));
vi.mock('@/lib/session', () => ({
  getCurrentUser: async () => session.user,
  realUserId: (u: { id: string; actingUser?: { id: string } }) => u.actingUser?.id ?? u.id,
  isWorkspaceAdmin: (u: { role?: string }) => u.role === 'owner' || u.role === 'admin',
}));
vi.mock('next/server', async (orig) => ({
  ...(await orig<typeof import('next/server')>()),
  after: () => undefined,
}));

const issueRoute = await import('@/app/api/track/issues/[id]/route');
const commentsRoute = await import('@/app/api/track/issues/[id]/comments/route');
const projectIssuesRoute = await import('@/app/api/track/projects/[id]/issues/route');
const viewsRoute = await import('@/app/api/track/projects/[id]/views/route');
const viewRoute = await import('@/app/api/track/views/[id]/route');
const labelsRoute = await import('@/app/api/track/labels/route');
const triageRoute = await import('@/app/api/track/issues/[id]/triage/route');

const json = (url: string, method: string, body?: unknown) =>
  new NextRequest(`http://x${url}`, {
    method,
    headers: { 'content-type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  }) as never;
const params = (id: string) => ({ params: Promise.resolve({ id }) });
const app = { source: 'app' as const };

/** Team con owner, un miembro y un admin; la sesión de un miembro lleva el id del owner. */
async function teamSetup(label: string) {
  const owner = await makeUser(`${label}o`);
  const member = await makeUser(`${label}m`);
  const admin = await makeUser(`${label}a`);
  const team = await createTeam(owner.id, 'Team');
  await addMember(team.id, member.id, 'member');
  await addMember(team.id, admin.id, 'admin');
  const project = await createProject(owner.id, team.id, { name: 'Web' });
  const as = (u: typeof owner, role: string) =>
    u.id === owner.id ? { ...owner, team, role } : { ...owner, actingUser: u, team, role };
  return { owner, member, admin, team, project, as };
}

describe('Track: detalle de issue y workspace', () => {
  it('el detalle solo carga issues de proyectos del workspace activo', async () => {
    const a = await makeUser('pa');
    const b = await makeUser('pb');
    const project = await createProject(a.id, null, { name: 'Privado' });
    const issue = await createIssue(project.id, a.id, { title: 'secreto', description: [] }, app);
    const team = await createTeam(a.id, 'T');
    const teamProject = await createProject(a.id, team.id, { name: 'Del team' });
    const teamIssue = await createIssue(teamProject.id, a.id, { title: 'team', description: [] }, app);

    expect(await getAccessibleIssue(issue.id, null, b.id)).toBeNull();
    expect((await getAccessibleIssue(issue.id, null, a.id))?.project.id).toBe(project.id);
    // Quien ya no está en el team (u otro team) no lo ve.
    expect(await getAccessibleIssue(teamIssue.id, null, b.id)).toBeNull();
    expect(await getAccessibleIssue(teamIssue.id, 'otro-team', a.id)).toBeNull();
    expect((await getAccessibleIssue(teamIssue.id, team.id, a.id))?.issue.id).toBe(teamIssue.id);
    expect(await getAccessibleIssue('no-existe', null, a.id)).toBeNull();
  });
});

describe('Track: acciones de miembros del team', () => {
  it('comentarios, cambios y creación quedan a nombre del miembro real', async () => {
    const { owner, member, project, as } = await teamSetup('act');
    const issue = await createIssue(project.id, owner.id, { title: 'x', description: [] }, app);

    session.user = as(member, 'member');
    const c = await commentsRoute.POST(json('/c', 'POST', { body: 'hola' }), params(issue.id));
    expect(c.status).toBe(201);
    expect(((await c.json()) as { user_id: string }).user_id).toBe(member.id);

    // Autoasignarse no genera "<owner> te asignó".
    const r = await issueRoute.PATCH(json('/i', 'PATCH', { assigneeId: member.id }), params(issue.id));
    expect(r.status).toBe(200);
    const notes = await getDb()
      .prepare("SELECT COUNT(*) AS c FROM notifications WHERE user_id = ? AND type = 'assigned'")
      .get(member.id);
    expect((notes as { c: number }).c).toBe(0);
    const acts = await listIssueActivities(issue.id);
    expect(acts.find((x) => x.type === 'assignee_change')?.user_id).toBe(member.id);

    const created = await projectIssuesRoute.POST(json('/p', 'POST', { title: 'nuevo' }), params(project.id));
    expect(created.status).toBe(201);
    const row = (await created.json()) as { id: string; creator_id: string };
    expect(row.creator_id).toBe(member.id);
  });

  it('las vistas guardadas son de cada miembro', async () => {
    const { owner, member, project, as } = await teamSetup('vw');
    session.user = as(owner, 'owner');
    const res = await viewsRoute.POST(json('/v', 'POST', { name: 'Mía', viewType: 'list', sort: 'newest' }), params(project.id));
    expect(res.status).toBe(201);
    const view = (await res.json()) as { id: string };

    session.user = as(member, 'member');
    const list = (await (await viewsRoute.GET(json('/v', 'GET'), params(project.id))).json()) as { rows: unknown[] };
    expect(list.rows).toHaveLength(0);
    expect((await viewRoute.DELETE(json('/v', 'DELETE'), params(view.id))).status).toBe(404);
  });
});

describe('Track: referencias de un issue', () => {
  it('PATCH/POST rechazan status, cycle, assignee y parent ajenos', async () => {
    const { owner, member, project, as } = await teamSetup('ref');
    const outsider = await makeUser('refx');
    const other = await createProject(owner.id, null, { name: 'Personal' });
    const [foreignStatus] = await listStatuses(other.id);
    const foreignCycle = await createCycle(other.id, { name: 'C', startAt: '2026-01-01', endAt: '2026-01-14' });
    const foreignIssue = await createIssue(other.id, owner.id, { title: 'otro ws', description: [] }, app);
    const parent = await createIssue(project.id, owner.id, { title: 'padre', description: [] }, app);
    const child = await createIssue(project.id, owner.id, { title: 'hijo', description: [], parentId: parent.id }, app);

    session.user = as(member, 'member');
    const patch = (id: string, body: unknown) => issueRoute.PATCH(json('/i', 'PATCH', body), params(id));
    const err = async (res: Response) => ((await res.json()) as { error: string }).error;

    let res = await patch(parent.id, { statusId: foreignStatus.id });
    expect(res.status).toBe(400);
    expect(await err(res)).toBe('invalid_status');
    expect(await err(await patch(parent.id, { cycleId: foreignCycle.id }))).toBe('invalid_cycle');
    expect(await err(await patch(parent.id, { assigneeId: outsider.id }))).toBe('invalid_assignee');
    expect(await err(await patch(parent.id, { parentId: foreignIssue.id }))).toBe('invalid_parent');
    // Ciclos: el padre no puede colgar de su hijo ni de sí mismo.
    expect(await err(await patch(parent.id, { parentId: child.id }))).toBe('invalid_parent');
    expect(await err(await patch(parent.id, { parentId: parent.id }))).toBe('invalid_parent');
    expect((await getIssue(parent.id))?.parent_id).toBeNull();

    // Valores válidos siguen funcionando.
    const own = await createStatus(project.id, { name: 'QA', category: 'in_progress' });
    res = await patch(parent.id, { statusId: own.id, assigneeId: member.id, cycleId: null });
    expect(res.status).toBe(200);

    res = await projectIssuesRoute.POST(json('/p', 'POST', { title: 'x', assigneeId: outsider.id }), params(project.id));
    expect(res.status).toBe(400);
    expect(await err(res)).toBe('invalid_assignee');
    res = await projectIssuesRoute.POST(json('/p', 'POST', { title: 'x', parentId: parent.id }), params(project.id));
    expect(res.status).toBe(201);
  });

  it('DELETE individual es solo para owner/admin, igual que el masivo', async () => {
    const { owner, member, admin, project, as } = await teamSetup('del');
    const issue = await createIssue(project.id, owner.id, { title: 'x', description: [] }, app);

    session.user = as(member, 'member');
    expect((await issueRoute.DELETE(json('/i', 'DELETE'), params(issue.id))).status).toBe(403);
    expect(await getIssue(issue.id)).toBeTruthy();

    session.user = as(admin, 'admin');
    expect((await issueRoute.DELETE(json('/i', 'DELETE'), params(issue.id))).status).toBe(200);
    expect(await getIssue(issue.id)).toBeUndefined();
  });
});

describe('Track: color de labels', () => {
  it('solo acepta hex y la migración limpia los existentes', async () => {
    const a = await makeUser('lc');
    session.user = { ...a, team: null, role: 'owner' };
    expect((await labelsRoute.POST(json('/l', 'POST', { name: 'Track', color: 'url(//ev.il/p)' }))).status).toBe(400);
    expect((await labelsRoute.POST(json('/l', 'POST', { name: 'Ok', color: '#AbC' }))).status).toBe(201);

    // Datos viejos con un color peligroso.
    const bad = await createLabel(a.id, { name: 'Viejo' });
    if (!bad.ok) throw new Error('setup');
    await getDb().prepare("UPDATE track_labels SET color = 'url(//ev.il/p)' WHERE id = ?").run(bad.label.id);
    const p = await createProject(a.id, null, { name: 'Lc' });
    const issue = await createIssue(p.id, a.id, { title: 'x', description: [] }, app);
    await getDb()
      .prepare('UPDATE track_issues SET labels = ? WHERE id = ?')
      .run(JSON.stringify([{ id: bad.label.id, name: 'Viejo', color: 'url(//ev.il/p)' }]), issue.id);

    await MIGRATIONS.find((m) => m.id === '028_track_label_colors')!.up(getClient());
    expect((await listLabels(a.id)).find((l) => l.id === bad.label.id)?.color).toBe('#666666');
    expect(parseIssueLabels((await getIssue(issue.id))!.labels)[0].color).toBe('#666666');
  });
});

describe('Track: GitHub y triage', () => {
  it('solo las palabras clave de cierre mueven issues mencionados en el cuerpo', () => {
    const prefixes = ['ZER'];
    expect(parseClosingIdentifiers('Bloqueado por ZER-11, ver también ZER-40', prefixes)).toEqual([]);
    expect(parseClosingIdentifiers('Fixes ZER-1', prefixes)).toEqual(['ZER-1']);
    expect(parseClosingIdentifiers('closes: zer-2, ZER-3 and ZER-4. Ver ZER-5', prefixes)).toEqual([
      'ZER-2',
      'ZER-3',
      'ZER-4',
    ]);
    expect(parseClosingIdentifiers('Cierra ZER-6 y ZER-7', prefixes)).toEqual(['ZER-6', 'ZER-7']);
    expect(parseClosingIdentifiers('prefix ZER-8', prefixes)).toEqual([]);
  });

  it('triage: el duplicado se resuelve por identifier en todo el workspace', async () => {
    const a = await makeUser('td');
    const p1 = await createProject(a.id, null, { name: 'Uno' });
    const p2 = await createProject(a.id, null, { name: 'Dos' });
    await updateProject(p1.id, { triageEnabled: true });
    const original = await createIssue(p2.id, a.id, { title: 'original', description: [] }, app);
    const incoming = await createIssue(p1.id, a.id, { title: 'entrante', description: [] }, { source: 'api' });
    expect(incoming.triage).toBe(1);

    session.user = { ...a, team: null, role: 'owner' };
    const miss = await triageRoute.POST(
      json('/t', 'POST', { action: 'duplicate', duplicateOfIdentifier: 'NOPE-999' }),
      params(incoming.id),
    );
    expect(miss.status).toBe(400);
    expect(((await miss.json()) as { error: string }).error).toBe('invalid_duplicate');
    expect((await triageRoute.POST(json('/t', 'POST', { action: 'duplicate' }), params(incoming.id))).status).toBe(400);

    const ok = await triageRoute.POST(
      json('/t', 'POST', { action: 'duplicate', duplicateOfIdentifier: original.identifier.toLowerCase() }),
      params(incoming.id),
    );
    expect(ok.status).toBe(200);
    expect((await getIssue(incoming.id))?.status_category).toBe('cancelled');
  });
});
