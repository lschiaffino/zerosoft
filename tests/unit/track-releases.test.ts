import { describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';
import { getDb } from '@/lib/db';
import { addMember, createTeam } from '@/lib/teams';
import { createIssue, createProject, getIssue, listAllIssues, listStatuses, moveIssueToTeam, updateIssue } from '@/lib/track-data';
import { runAsTrackViewer, setGuest, setProjectVisibility } from '@/lib/track-access';
import { attachMergedIssue, createRelease, generateReleaseNotes, listReleases } from '@/lib/track-releases';
import { bulkEditIssues } from '@/lib/track-bulk';
import { groupIssues } from '@/lib/track-views';
import { makeUser } from './helpers';

const session = vi.hoisted(() => ({ user: null as null | Record<string, unknown> }));
vi.mock('@/lib/session', () => ({
  getCurrentUser: async () => session.user,
  realUserId: (u: { id: string; actingUser?: { id: string } }) => u.actingUser?.id ?? u.id,
  isWorkspaceAdmin: (u: { role?: string }) => u.role === 'owner' || u.role === 'admin',
}));
vi.mock('next/server', async (orig) => ({
  ...(await orig<typeof import('next/server')>()),
  after: () => {},
}));
vi.mock('@/lib/events', () => ({ emitEvent: async () => {}, emitEventSoon: async () => {} }));

const listRoute = await import('@/app/api/track/releases/route');
const oneRoute = await import('@/lib/routes/track/releases/[id]/route');
const issuesRoute = await import('@/lib/routes/track/releases/[id]/issues/route');
const issueRoute = await import('@/lib/routes/track/issues/[id]/route');
const params = (id: string) => ({ params: Promise.resolve({ id }) });
const json = (method: string, body?: unknown) =>
  new NextRequest('http://x/api/track/releases', {
    method,
    headers: { 'content-type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  }) as never;

const uid = () => crypto.randomUUID().slice(0, 6);

async function setup() {
  const owner = await makeUser('rel-own');
  const member = await makeUser('rel-mem');
  const guest = await makeUser('rel-gst');
  const stranger = await makeUser('rel-str');
  const team = await createTeam(owner.id, 'Acme');
  await addMember(team.id, member.id);
  await addMember(team.id, guest.id);
  const web = await createProject(owner.id, team.id, { name: 'Web', slug: `we-${uid()}` });
  const api = await createProject(owner.id, team.id, { name: 'Api', slug: `ap-${uid()}` });
  const secret = await createProject(owner.id, team.id, { name: 'Secret', slug: `se-${uid()}` });
  await setProjectVisibility(secret.id, 'private', owner.id);
  await setGuest(team.id, guest.email, [web.id], owner.id);
  const as = {
    owner: { ...owner, team, role: 'owner' },
    member: { ...member, id: owner.id, actingUser: member, team, role: 'member' },
    guest: { ...guest, id: owner.id, actingUser: guest, team, role: 'member' },
    stranger: { ...stranger, team: null, role: 'owner' },
  };
  return { owner, member, guest, stranger, team, web, api, secret, as };
}

describe('Track: Releases', () => {
  it('crear, listar, editar, sumar issues, notas y borrar; avance como Linear', async () => {
    const s = await setup();
    session.user = s.as.member;
    const created = await listRoute.POST(json('POST', { projectId: s.web.id, name: 'Mobile', version: '2.1', targetDate: '2026-12-01' }));
    expect(created.status).toBe(201);
    const release = (await created.json()) as { id: string; status: string; notes: string | null };
    expect(release.status).toBe('planned');

    const statuses = await listStatuses(s.web.id);
    const done = statuses.find((x) => x.category === 'done')!;
    const cancelled = statuses.find((x) => x.category === 'cancelled')!;
    const a = await createIssue(s.web.id, s.owner.id, { title: 'Dark mode', labels: [{ name: 'Feature' }] }, { source: 'app' });
    const b = await createIssue(s.web.id, s.owner.id, { title: 'Crash on login', labels: [{ name: 'Bug' }] }, { source: 'app' });
    const c = await createIssue(s.web.id, s.owner.id, { title: 'Faster search' }, { source: 'app' });
    const d = await createIssue(s.web.id, s.owner.id, { title: 'Dropped idea' }, { source: 'app' });
    const other = await createIssue(s.api.id, s.owner.id, { title: 'Other team' }, { source: 'app' });

    // Sumar desde el release: el de otro team se saltea.
    const add = await issuesRoute.POST(json('POST', { issueIds: [a.id, b.id, c.id, d.id, other.id] }), params(release.id));
    expect(add.status).toBe(200);
    const addBody = (await add.json()) as { updated: string[]; skipped: string[] };
    expect(addBody.updated.sort()).toEqual([a.id, b.id, c.id, d.id].sort());
    expect(addBody.skipped).toEqual([other.id]);
    expect((await getIssue(other.id))!.release_id ?? null).toBeNull();

    await updateIssue(a.id, { statusId: done.id }, s.owner.id);
    await updateIssue(b.id, { statusId: done.id }, s.owner.id);
    await updateIssue(d.id, { statusId: cancelled.id }, s.owner.id);
    const got = (await (await oneRoute.GET(json('GET'), params(release.id))).json()) as {
      release: { total: number; done: number; cancelled: number };
      issues: Array<{ id: string; release_name: string }>;
    };
    expect([got.release.total, got.release.done, got.release.cancelled].map(Number)).toEqual([4, 2, 1]);
    expect(got.issues.map((i) => i.release_name)).toEqual(['Mobile', 'Mobile', 'Mobile', 'Mobile']);

    // Notas generadas: los terminados, por tipo según el label.
    const notes = generateReleaseNotes({ name: 'Mobile', version: '2.1' }, got.issues as never, { features: 'New', improvements: 'Improvements', fixes: 'Fixes', empty: '-' });
    expect(notes).toContain('# Mobile 2.1');
    expect(notes).toContain(`## New\n\n- Dark mode (${a.identifier})`);
    expect(notes).toContain(`## Fixes\n\n- Crash on login (${b.identifier})`);
    expect(notes).not.toContain('Dropped idea');
    expect(notes).not.toContain('Faster search');

    // Editar: nombre, estado (released deja la fecha), notas a mano y de vuelta a generadas.
    const patched = await oneRoute.PATCH(json('PATCH', { name: 'Mobile app', status: 'released', notes: '# Hand written' }), params(release.id));
    expect(patched.status).toBe(200);
    const after = (await patched.json()) as { name: string; status: string; released_at: string | null; notes: string | null };
    expect([after.name, after.status, after.notes]).toEqual(['Mobile app', 'released', '# Hand written']);
    expect(after.released_at).toBeTruthy();
    const reset = (await (await oneRoute.PATCH(json('PATCH', { notes: null }), params(release.id))).json()) as { notes: string | null };
    expect(reset.notes).toBeNull();

    // Sacar un issue y borrar el release: los issues quedan sin release.
    expect((await issuesRoute.POST(json('POST', { issueIds: [c.id], remove: true }), params(release.id))).status).toBe(200);
    expect((await getIssue(c.id))!.release_id ?? null).toBeNull();
    expect((await oneRoute.DELETE(json('DELETE'), params(release.id))).status).toBe(200);
    expect((await getIssue(a.id))!.release_id ?? null).toBeNull();
    expect((await oneRoute.GET(json('GET'), params(release.id))).status).toBe(404);
    session.user = null;
  });

  it('acceso: anónimo, otro workspace, team privado sin acceso, invitado, miembro y owner', async () => {
    const s = await setup();
    const secretRelease = await createRelease(s.secret.id, s.owner.id, { name: 'Secret 1' });
    const webRelease = await createRelease(s.web.id, s.owner.id, { name: 'Web 1' });
    const apiRelease = await createRelease(s.api.id, s.owner.id, { name: 'Api 1' });

    session.user = null;
    expect((await listRoute.GET(json('GET'))).status).toBe(401);
    expect((await oneRoute.GET(json('GET'), params(webRelease.id))).status).toBe(401);
    expect((await listRoute.POST(json('POST', { projectId: s.web.id, name: 'x' }))).status).toBe(401);

    session.user = s.as.stranger;
    expect(((await (await listRoute.GET(json('GET'))).json()) as { rows: unknown[] }).rows).toEqual([]);
    expect((await oneRoute.GET(json('GET'), params(webRelease.id))).status).toBe(404);
    expect((await oneRoute.PATCH(json('PATCH', { name: 'hacked' }), params(webRelease.id))).status).toBe(404);
    expect((await oneRoute.DELETE(json('DELETE'), params(webRelease.id))).status).toBe(404);
    expect((await listRoute.POST(json('POST', { projectId: s.web.id, name: 'x' }))).status).toBe(400);

    // Miembro sin acceso al privado: no lo lista, no lo abre, no crea ahí.
    session.user = s.as.member;
    const memberRows = ((await (await listRoute.GET(json('GET'))).json()) as { rows: Array<{ id: string }> }).rows.map((r) => r.id);
    expect(memberRows).toEqual(expect.arrayContaining([webRelease.id, apiRelease.id]));
    expect(memberRows).not.toContain(secretRelease.id);
    expect((await oneRoute.GET(json('GET'), params(secretRelease.id))).status).toBe(404);
    expect((await issuesRoute.POST(json('POST', { issueIds: ['x'] }), params(secretRelease.id))).status).toBe(404);
    expect((await listRoute.POST(json('POST', { projectId: s.secret.id, name: 'x' }))).status).toBe(400);

    // Invitado: solo los releases de sus teams.
    session.user = s.as.guest;
    const guestRows = ((await (await listRoute.GET(json('GET'))).json()) as { rows: Array<{ id: string }> }).rows.map((r) => r.id);
    expect(guestRows).toEqual([webRelease.id]);
    expect((await oneRoute.GET(json('GET'), params(apiRelease.id))).status).toBe(404);
    expect((await oneRoute.GET(json('GET'), params(webRelease.id))).status).toBe(200);

    // Owner: todos, el privado incluido (es miembro), y la búsqueda del API no se sale del workspace.
    session.user = s.as.owner;
    const ownerRows = ((await (await listRoute.GET(json('GET'))).json()) as { rows: Array<{ id: string }> }).rows.map((r) => r.id);
    expect(ownerRows).toEqual(expect.arrayContaining([webRelease.id, apiRelease.id, secretRelease.id]));
    const strangerRelease = await createRelease((await createProject(s.stranger.id, null, { name: 'Theirs' })).id, s.stranger.id, { name: 'Theirs 1' });
    expect((await oneRoute.GET(json('GET'), params(strangerRelease.id))).status).toBe(404);
    expect(await runAsTrackViewer(s.member.id, () => listReleases(s.team.id, s.owner.id, { projectId: s.secret.id }))).toEqual([]);
    session.user = null;
  });

  it('el issue solo va a un release de su team; mover de team lo saca; propiedad, filtro y agrupado', async () => {
    const s = await setup();
    const webRelease = await createRelease(s.web.id, s.owner.id, { name: 'Web', version: '1.0' });
    const apiRelease = await createRelease(s.api.id, s.owner.id, { name: 'Api' });
    const issue = await createIssue(s.web.id, s.owner.id, { title: 'Thing' }, { source: 'app' });
    session.user = s.as.member;
    // PATCH del issue: un release de otro team es 400; el propio sí.
    const bad = await issueRoute.PATCH(json('PATCH', { releaseId: apiRelease.id }), params(issue.id));
    expect(bad.status).toBe(400);
    expect(((await bad.json()) as { error: string }).error).toBe('invalid_release');
    expect((await issueRoute.PATCH(json('PATCH', { releaseId: webRelease.id }), params(issue.id))).status).toBe(200);
    const withRelease = (await getIssue(issue.id))!;
    expect([withRelease.release_id, withRelease.release_name, withRelease.release_version]).toEqual([webRelease.id, 'Web', '1.0']);
    // Actividad del cambio.
    const act = (await getDb().prepare("SELECT meta FROM track_issue_activities WHERE issue_id = ? AND type = 'cycle_change'").all(issue.id)) as Array<{ meta: string }>;
    expect(act.map((a) => JSON.parse(a.meta)).find((m) => m.field === 'release')).toMatchObject({ to: 'Web 1.0' });

    // Filtro por release y agrupado.
    const filtered = await runAsTrackViewer(s.member.id, () =>
      listAllIssues(s.team.id, s.owner.id, { projectId: s.web.id, filter: { match: 'and', rules: [{ field: 'release', op: 'is', values: [webRelease.id] }] } } as never),
    );
    expect(filtered.rows.map((r) => r.id)).toEqual([issue.id]);
    const groups = groupIssues([withRelease], 'release');
    expect(groups.map((g) => [g.key, g.name])).toEqual([[webRelease.id, 'Web 1.0']]);

    // Bulk: también valida el team.
    const bulk = await bulkEditIssues(
      { action: 'update', issueIds: [issue.id], patch: { releaseId: apiRelease.id } },
      { teamId: s.team.id, ownerId: s.owner.id, actorId: s.member.id },
    );
    expect(bulk.skipped).toEqual([{ id: issue.id, reason: 'invalid_release' }]);

    // Mover de team: sale del release.
    await moveIssueToTeam(issue.id, s.api.id, s.owner.id);
    expect((await getIssue(issue.id))!.release_id ?? null).toBeNull();
    session.user = null;
  });

  it('GitHub: un PR mergeado suma el issue al release en curso del team (una vez)', async () => {
    const s = await setup();
    const planned = await createRelease(s.web.id, s.owner.id, { name: 'Later', targetDate: '2027-01-01' });
    const current = await createRelease(s.web.id, s.owner.id, { name: 'Now', status: 'in_progress' });
    await createRelease(s.web.id, s.owner.id, { name: 'Shipped', status: 'released' });
    const issue = await createIssue(s.web.id, s.owner.id, { title: 'Merged work' }, { source: 'app' });
    expect(await attachMergedIssue(issue.id, s.owner.id)).toBe(current.id);
    expect(await attachMergedIssue(issue.id, s.owner.id)).toBeNull();
    expect((await getIssue(issue.id))!.release_id).toBe(current.id);
    // Sin release en curso: el planeado con la fecha más cercana; un release sin la opción no recibe.
    await getDb().prepare("UPDATE track_releases SET status = 'released' WHERE id = ?").run(current.id);
    const second = await createIssue(s.web.id, s.owner.id, { title: 'Second' }, { source: 'app' });
    expect(await attachMergedIssue(second.id, s.owner.id)).toBe(planned.id);
    await getDb().prepare('UPDATE track_releases SET auto_github = 0 WHERE id = ?').run(planned.id);
    const third = await createIssue(s.web.id, s.owner.id, { title: 'Third' }, { source: 'app' });
    expect(await attachMergedIssue(third.id, s.owner.id)).toBeNull();
    // Un team sin releases: nada.
    const apiIssue = await createIssue(s.api.id, s.owner.id, { title: 'Api' }, { source: 'app' });
    expect(await attachMergedIssue(apiIssue.id, s.owner.id)).toBeNull();
  });
});
