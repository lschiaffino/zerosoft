import { describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';
import { getClient, getDb } from '@/lib/db';
import { MIGRATIONS } from '@/lib/schema/migrations';
import { bulkEditIssues, listTriageIssues } from '@/lib/track-bulk';
import { safeHexColor } from '@/lib/track-color';
import {
  createIssue,
  createIssueRelation,
  createProject,
  deleteIssue,
  getIssue,
  listIssueActivities,
  listStatuses,
  updateProject,
} from '@/lib/track-data';
import { signGithubPayload } from '@/lib/track-github';
import { projectCreateSchema, statusCreateSchema, statusUpdateSchema } from '@/lib/track-schema';
import { makeUser } from './helpers';

const session = vi.hoisted(() => ({ user: null as null | Record<string, unknown> }));
vi.mock('@/lib/session', () => ({
  getCurrentUser: async () => session.user,
  realUserId: (u: { id: string; actingUser?: { id: string } }) => u.actingUser?.id ?? u.id,
  isWorkspaceAdmin: (u: { role?: string }) => u.role === 'owner' || u.role === 'admin',
}));
// after() corre la tarea en el momento; se guardan las promesas para esperarlas.
const pending = vi.hoisted(() => [] as Array<Promise<unknown>>);
vi.mock('next/server', async (orig) => ({
  ...(await orig<typeof import('next/server')>()),
  after: (task: () => Promise<void>) => {
    pending.push(task().catch(() => {}));
  },
}));
const emitted = vi.hoisted(() => [] as Array<{ ws: string; type: string; data: Record<string, unknown> }>);
vi.mock('@/lib/events', () => ({
  emitEvent: async (ws: string, type: string, data: Record<string, unknown>) => {
    emitted.push({ ws, type, data });
  },
}));

const relationsRoute = await import('@/app/api/track/issues/[id]/relations/route');
const githubConfigRoute = await import('@/app/api/track/github/route');
const webhookRoute = await import('@/app/api/track/github/webhook/[hookId]/route');

const json = (url: string, method: string, body?: unknown) =>
  new NextRequest(`http://x${url}`, {
    method,
    headers: { 'content-type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  }) as never;
const params = (id: string) => ({ params: Promise.resolve({ id }) });
const app = { source: 'app' as const };
const flush = async () => {
  while (pending.length) await pending.shift();
};

describe('Track gauntlet r2: colores de proyectos y statuses', () => {
  it('el schema solo acepta hex y el render descarta lo demás', () => {
    expect(statusUpdateSchema.safeParse({ color: 'url(//ev.il/a)' }).success).toBe(false);
    expect(statusCreateSchema.safeParse({ name: 'X', color: 'red;background:url(x)' }).success).toBe(false);
    expect(projectCreateSchema.safeParse({ name: 'X', color: 'url(//ev.il/a)' }).success).toBe(false);
    expect(statusUpdateSchema.safeParse({ color: '#AbC' }).success).toBe(true);
    expect(projectCreateSchema.safeParse({ name: 'X', color: '#112233' }).success).toBe(true);
    expect(safeHexColor('url(//ev.il/a)', '#666666')).toBe('#666666');
    expect(safeHexColor(' #fff ', '#666666')).toBe('#fff');
    expect(safeHexColor(null, '#000000')).toBe('#000000');
  });

  it('migración: los colores que no son hex vuelven al default', async () => {
    const a = await makeUser('col');
    const p = await createProject(a.id, null, { name: 'Colores' });
    const [status] = await listStatuses(p.id);
    await getDb().prepare('UPDATE track_projects SET color = ? WHERE id = ?').run('url(//ev.il/p)', p.id);
    await getDb().prepare('UPDATE track_statuses SET color = ? WHERE id = ?').run('url(//ev.il/s)', status.id);
    const mig = MIGRATIONS.find((m) => m.id === '029_track_project_status_colors')!;
    await mig.up(getClient());
    const project = (await getDb().prepare('SELECT color FROM track_projects WHERE id = ?').get(p.id)) as {
      color: string;
    };
    const st = (await getDb().prepare('SELECT color FROM track_statuses WHERE id = ?').get(status.id)) as {
      color: string;
    };
    expect(project.color).toBe('#000000');
    expect(st.color).toBe('#666666');
  });
});

describe('Track gauntlet r2: relaciones', () => {
  it('DELETE no borra una relación que no cuelga del issue de la URL', async () => {
    const a = await makeUser('rela');
    const b = await makeUser('relb');
    const pa = await createProject(a.id, null, { name: 'A' });
    const pb = await createProject(b.id, null, { name: 'B' });
    const mine = await createIssue(pa.id, a.id, { title: 'mío', description: [] }, app);
    const b1 = await createIssue(pb.id, b.id, { title: 'b1', description: [] }, app);
    const b2 = await createIssue(pb.id, b.id, { title: 'b2', description: [] }, app);
    const [rel] = await createIssueRelation(b1.id, b.id, b2.id, 'blocks');

    session.user = { ...a, team: null, role: 'owner' };
    const res = await relationsRoute.DELETE(
      json(`/api/track/issues/${mine.id}/relations?relationId=${rel.id}`, 'DELETE'),
      params(mine.id),
    );
    expect(res.status).toBe(404);
    const still = await getDb().prepare('SELECT id FROM track_issue_relations WHERE id = ?').get(rel.id);
    expect(still).toBeTruthy();
    // Tampoco se escribió actividad en el issue ajeno.
    const acts = await listIssueActivities(b1.id);
    expect(acts.some((x) => x.type === 'relation_removed')).toBe(false);
  });

  it('POST resuelve identifiers de otro proyecto del workspace y rechaza duplicados y self', async () => {
    const a = await makeUser('relc');
    const p1 = await createProject(a.id, null, { name: 'Uno' });
    const p2 = await createProject(a.id, null, { name: 'Dos' });
    const i1 = await createIssue(p1.id, a.id, { title: 'uno', description: [] }, app);
    const i2 = await createIssue(p2.id, a.id, { title: 'dos', description: [] }, app);
    session.user = { ...a, team: null, role: 'owner' };

    const post = (body: unknown) =>
      relationsRoute.POST(json(`/api/track/issues/${i1.id}/relations`, 'POST', body), params(i1.id));

    const ok = await post({ relatedIssueId: i2.identifier.toLowerCase(), type: 'related' });
    expect(ok.status).toBe(200);
    const dup = await post({ relatedIssueId: i2.id, type: 'blocks' });
    expect(dup.status).toBe(409);
    expect(await dup.json()).toEqual({ error: 'duplicate_relation' });
    // La relación inversa también cuenta como duplicada.
    const reverse = await relationsRoute.POST(
      json(`/api/track/issues/${i2.id}/relations`, 'POST', { relatedIssueId: i1.id }),
      params(i2.id),
    );
    expect(reverse.status).toBe(409);
    const self = await post({ relatedIssueId: i1.id });
    expect(self.status).toBe(400);
    expect(await self.json()).toEqual({ error: 'invalid_relation' });
  });
});

describe('Track gauntlet r2: borrado de subtasks', () => {
  it('borrar un issue borra todos sus descendientes', async () => {
    const a = await makeUser('del');
    const p = await createProject(a.id, null, { name: 'Del' });
    const epic = await createIssue(p.id, a.id, { title: 'E', description: [] }, app);
    const sub = await createIssue(p.id, a.id, { title: 'S', description: [], parentId: epic.id }, app);
    const grand = await createIssue(p.id, a.id, { title: 'T', description: [], parentId: sub.id }, app);
    const other = await createIssue(p.id, a.id, { title: 'O', description: [] }, app);

    expect(await deleteIssue(epic.id)).toBe(true);
    expect(await getIssue(sub.id)).toBeUndefined();
    expect(await getIssue(grand.id)).toBeUndefined();
    expect(await getIssue(other.id)).toBeTruthy();
    expect(await deleteIssue(epic.id)).toBe(false);
  });

  it('el borrado masivo cuenta como borrados los hijos que cayeron con el padre', async () => {
    const a = await makeUser('bdel');
    const p = await createProject(a.id, null, { name: 'BDel' });
    const parent = await createIssue(p.id, a.id, { title: 'P', description: [] }, app);
    const child = await createIssue(p.id, a.id, { title: 'C', description: [], parentId: parent.id }, app);
    const res = await bulkEditIssues(
      { action: 'delete', issueIds: [parent.id, child.id] },
      { teamId: null, ownerId: a.id, actorId: a.id },
    );
    expect(res.skipped).toEqual([]);
    expect(res.updated.sort()).toEqual([parent.id, child.id].sort());
  });

  it('hay índice sobre track_issues(parent_id)', async () => {
    const rows = (await getClient().execute('PRAGMA index_list(track_issues)')).rows.map((r) => String(r.name));
    expect(rows).toContain('idx_track_issues_parent');
  });
});

describe('Track gauntlet r2: eventos issue.*', () => {
  it('la edición masiva emite issue.updated e issue.status_changed por issue', async () => {
    const a = await makeUser('evt');
    const p = await createProject(a.id, null, { name: 'Evt' });
    const statuses = await listStatuses(p.id);
    const done = statuses.find((s) => s.category === 'done')!;
    const i1 = await createIssue(p.id, a.id, { title: 'uno', description: [] }, app);
    const i2 = await createIssue(p.id, a.id, { title: 'dos', description: [] }, app);
    emitted.length = 0;

    await bulkEditIssues(
      { action: 'update', issueIds: [i1.id, i2.id], patch: { statusId: done.id } },
      { teamId: null, ownerId: a.id, actorId: a.id },
    );
    await flush();
    const changed = emitted.filter((e) => e.type === 'issue.status_changed');
    expect(changed.map((e) => (e.data.issue as { id: string }).id).sort()).toEqual([i1.id, i2.id].sort());
    expect(changed.every((e) => e.ws === a.id && e.data.to === done.name)).toBe(true);
    expect(emitted.filter((e) => e.type === 'issue.updated')).toHaveLength(2);
  });
});

describe('Track gauntlet r2: triage', () => {
  it('listTriageIssues devuelve la cola completa en una query', async () => {
    const a = await makeUser('tri');
    const p = await createProject(a.id, null, { name: 'Tri' });
    await updateProject(p.id, { triageEnabled: true });
    const t1 = await createIssue(p.id, a.id, { title: 't1', description: [] }, { source: 'api' });
    const t2 = await createIssue(p.id, a.id, { title: 't2', description: [] }, { source: 'api' });
    await createIssue(p.id, a.id, { title: 'normal', description: [] }, app);
    const rows = await listTriageIssues(p.id);
    expect(rows.map((r) => r.id).sort()).toEqual([t1.id, t2.id].sort());
    expect(rows[0].status_name).toBeTruthy();
    expect(rows[0].child_count).toBe(0);
  });
});

describe('Track gauntlet r2: GitHub', () => {
  it('no mueve issues en triage y firma los cambios como GitHub', async () => {
    const a = await makeUser('ghr2');
    const project = await createProject(a.id, null, { name: 'Web', slug: `ghr-${crypto.randomUUID().slice(0, 6)}` });
    const issue = await createIssue(project.id, a.id, { title: 'Normal', description: [] }, app);
    await updateProject(project.id, { triageEnabled: true });
    const inTriage = await createIssue(project.id, a.id, { title: 'Bug externo', description: [] }, { source: 'api' });
    expect(inTriage.triage).toBe(1);

    session.user = { ...a, team: null, role: 'owner' };
    const conf = (await (
      await githubConfigRoute.PUT(json('/api/track/github', 'PUT', { repos: ['acme/web'] }))
    ).json()) as { secret: string; config: { id: string } };
    const raw = JSON.stringify({
      action: 'opened',
      repository: { full_name: 'acme/web' },
      pull_request: {
        number: 7,
        html_url: 'https://github.com/acme/web/pull/7',
        title: `Fix ${issue.identifier} y ${inTriage.identifier}`,
        body: '',
        head: { ref: 'fix' },
        user: { login: 'octo' },
        author_association: 'OWNER',
        merged: false,
      },
    });
    const res = await webhookRoute.POST(
      new NextRequest(`http://x/api/track/github/webhook/${conf.config.id}`, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'x-github-event': 'pull_request',
          'x-hub-signature-256': signGithubPayload(conf.secret, raw),
        },
        body: raw,
      }) as never,
      { params: Promise.resolve({ hookId: conf.config.id }) },
    );
    expect(await res.json()).toEqual({ linked: 2, moved: 1 });
    expect((await getIssue(issue.id))?.status_category).toBe('in_progress');
    const still = await getIssue(inTriage.id);
    expect(still?.triage).toBe(1);
    expect(still?.status_category).not.toBe('in_progress');

    const change = (await listIssueActivities(issue.id)).find((x) => x.type === 'status_change')!;
    expect(JSON.parse(change.meta)).toMatchObject({ via: 'github', viaAuthor: 'octo', viaRef: '#7' });
  });
});
