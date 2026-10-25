import { describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';
import { getClient, getDb } from '@/lib/db';
import { MIGRATIONS } from '@/lib/schema/migrations';
import {
  createCycle,
  createIssue,
  createProject,
  getIssue,
  listIssues,
  listStatuses,
  updateProject,
} from '@/lib/track-data';
import { createLabel, listLabels, parseIssueLabels } from '@/lib/track-labels';
import { makeUser } from './helpers';

const session = vi.hoisted(() => ({ user: null as null | Record<string, unknown> }));
vi.mock('@/lib/session', () => ({
  getCurrentUser: async () => session.user,
  realUserId: (u: { id: string; actingUser?: { id: string } }) => u.actingUser?.id ?? u.id,
  isWorkspaceAdmin: (u: { role?: string }) => u.role === 'owner' || u.role === 'admin',
}));

const labelsRoute = await import('@/app/api/track/labels/route');
const labelRoute = await import('@/app/api/track/labels/[id]/route');
const bulkRoute = await import('@/app/api/track/issues/bulk/route');
const triageRoute = await import('@/app/api/track/issues/[id]/triage/route');
const triageListRoute = await import('@/app/api/track/projects/[id]/triage/route');

const json = (url: string, method: string, body?: unknown) =>
  new NextRequest(`http://x${url}`, {
    method,
    headers: { 'content-type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  }) as never;
const params = (id: string) => ({ params: Promise.resolve({ id }) });
const app = { source: 'app' as const };

describe('Track: labels del workspace', () => {
  it('migración: copia labels libres a labels del workspace sin perder datos', async () => {
    const a = await makeUser('lm');
    const p = await createProject(a.id, null, { name: 'Mig' });
    const i1 = await createIssue(p.id, a.id, { title: 'uno', description: [] }, app);
    const i2 = await createIssue(p.id, a.id, { title: 'dos', description: [] }, app);
    // Labels libres como los guardaba la versión anterior (ids sueltos por issue).
    await getDb().prepare('UPDATE track_issues SET labels = ? WHERE id = ?').run(
      JSON.stringify([
        { id: 'old-1', name: 'Bug', color: '#ff0000' },
        { id: 'old-2', name: 'UI', color: '#000000' },
      ]),
      i1.id,
    );
    await getDb().prepare('UPDATE track_issues SET labels = ? WHERE id = ?').run(
      JSON.stringify([{ id: 'old-3', name: 'bug', color: '#00ff00' }]),
      i2.id,
    );
    const mig = MIGRATIONS.find((m) => m.id === '027_track_labels')!;
    await mig.up(getClient());
    await mig.up(getClient()); // idempotente

    const labels = await listLabels(a.id, true);
    expect(labels.map((l) => [l.name, l.issue_count])).toEqual([
      ['Bug', 2],
      ['UI', 1],
    ]);
    const bug = labels.find((l) => l.name === 'Bug')!;
    expect(bug.id).toBe('old-1');
    expect(parseIssueLabels((await getIssue(i2.id))!.labels)).toEqual([{ id: 'old-1', name: 'Bug', color: '#ff0000' }]);
    // El filtro por label encuentra ambos.
    expect((await listIssues(p.id, { labelIds: [bug.id] })).total).toBe(2);
  });

  it('labels libres en el payload se resuelven a labels del workspace', async () => {
    const a = await makeUser('ln');
    const b = await makeUser('ln2');
    const p = await createProject(a.id, null, { name: 'Norm' });
    const own = await createLabel(a.id, { name: 'Backend', color: '#123456' });
    const foreign = await createLabel(b.id, { name: 'Secreto' });
    if (!own.ok || !foreign.ok) throw new Error('setup');
    const issue = await createIssue(
      p.id,
      a.id,
      {
        title: 'x',
        description: [],
        labels: [{ id: own.label.id, name: 'ignored', color: '#000' }, { name: 'backend' }, { id: foreign.label.id, name: 'Nuevo' }],
      },
      app,
    );
    const labels = parseIssueLabels(issue.labels);
    expect(labels.map((l) => l.name)).toEqual(['Backend', 'Nuevo']);
    // El label ajeno no se filtró: se creó uno propio llamado "Nuevo".
    expect(labels.some((l) => l.id === foreign.label.id)).toBe(false);
    expect((await listLabels(b.id)).map((l) => l.name)).toEqual(['Secreto']);
  });

  it('API: CRUD, duplicados, borrar es de admin y aislamiento', async () => {
    const a = await makeUser('la');
    const b = await makeUser('lb');
    const p = await createProject(a.id, null, { name: 'Api' });

    session.user = null;
    expect((await labelsRoute.GET(json('/api/track/labels', 'GET'))).status).toBe(401);

    session.user = { ...a, team: null, role: 'owner' };
    expect((await labelsRoute.POST(json('/api/track/labels', 'POST', { name: '' }))).status).toBe(400);
    const res = await labelsRoute.POST(json('/api/track/labels', 'POST', { name: 'Bug', color: '#ff0000' }));
    expect(res.status).toBe(201);
    const label = (await res.json()) as { id: string };
    expect((await labelsRoute.POST(json('/api/track/labels', 'POST', { name: 'bug' }))).status).toBe(409);

    const issue = await createIssue(p.id, a.id, { title: 'x', description: [], labels: [{ id: label.id }] }, app);

    // Renombrar actualiza la copia en el issue.
    const renamed = await labelRoute.PATCH(json('/x', 'PATCH', { name: 'Defecto' }), params(label.id));
    expect(renamed.status).toBe(200);
    expect(parseIssueLabels((await getIssue(issue.id))!.labels)[0].name).toBe('Defecto');

    // Otro workspace: no ve ni toca.
    session.user = { ...b, team: null, role: 'owner' };
    const listB = (await (await labelsRoute.GET(json('/api/track/labels', 'GET'))).json()) as { rows: unknown[] };
    expect(listB.rows).toHaveLength(0);
    expect((await labelRoute.PATCH(json('/x', 'PATCH', { name: 'hack' }), params(label.id))).status).toBe(404);
    expect((await labelRoute.DELETE(json('/x', 'DELETE'), params(label.id))).status).toBe(404);

    // Un miembro no admin no borra.
    session.user = { ...a, team: null, role: 'member' };
    expect((await labelRoute.DELETE(json('/x', 'DELETE'), params(label.id))).status).toBe(403);

    session.user = { ...a, team: null, role: 'owner' };
    expect((await labelRoute.DELETE(json('/x', 'DELETE'), params(label.id))).status).toBe(200);
    expect(parseIssueLabels((await getIssue(issue.id))!.labels)).toEqual([]);
  });
});

describe('Track: edición masiva', () => {
  async function setup() {
    const a = await makeUser('ba');
    const b = await makeUser('bb');
    const p = await createProject(a.id, null, { name: 'Bulk' });
    const p2 = await createProject(a.id, null, { name: 'Bulk 2' });
    const pb = await createProject(b.id, null, { name: 'Ajeno' });
    const i1 = await createIssue(p.id, a.id, { title: 'uno', description: [] }, app);
    const i2 = await createIssue(p.id, a.id, { title: 'dos', description: [] }, app);
    const i3 = await createIssue(p2.id, a.id, { title: 'tres', description: [] }, app);
    const ib = await createIssue(pb.id, b.id, { title: 'ajeno', description: [] }, app);
    return { a, b, p, p2, i1, i2, i3, ib };
  }

  it('actualiza status, prioridad, assignee, cycle y labels; saltea ajenos y valores de otro proyecto', async () => {
    const { a, b, p, i1, i2, i3, ib } = await setup();
    const statuses = await listStatuses(p.id);
    const done = statuses.find((s) => s.category === 'done')!;
    const cycle = await createCycle(p.id, { name: 'C1', startAt: '2026-01-01', endAt: '2026-01-14' });
    const bug = await createLabel(a.id, { name: 'Bug' });
    if (!bug.ok) throw new Error('setup');

    session.user = null;
    expect((await bulkRoute.POST(json('/b', 'POST', { action: 'update', issueIds: [i1.id], patch: { priority: 'low' } }))).status).toBe(401);

    session.user = { ...a, team: null, role: 'member' };
    expect((await bulkRoute.POST(json('/b', 'POST', { action: 'update', issueIds: [i1.id], patch: {} }))).status).toBe(400);
    expect((await bulkRoute.POST(json('/b', 'POST', { action: 'update', issueIds: [], patch: { priority: 'low' } }))).status).toBe(400);

    const res = await bulkRoute.POST(
      json('/b', 'POST', {
        action: 'update',
        issueIds: [i1.id, i2.id, i3.id, ib.id],
        patch: { statusId: done.id, priority: 'urgent', assigneeId: a.id, cycleId: cycle.id, addLabelIds: [bug.label.id] },
      }),
    );
    const body = (await res.json()) as { updated: string[]; skipped: Array<{ id: string; reason: string }> };
    expect(body.updated.sort()).toEqual([i1.id, i2.id].sort());
    expect(body.skipped).toEqual([
      { id: i3.id, reason: 'invalid_status' },
      { id: ib.id, reason: 'not_found' },
    ]);
    const u1 = (await getIssue(i1.id))!;
    expect([u1.status_id, u1.priority, u1.assignee_id, u1.cycle_id]).toEqual([done.id, 'urgent', a.id, cycle.id]);
    expect(parseIssueLabels(u1.labels).map((l) => l.name)).toEqual(['Bug']);
    expect((await getIssue(ib.id))!.priority).toBe('none');

    // Assignee ajeno al workspace: se saltea.
    const bad = (await (
      await bulkRoute.POST(json('/b', 'POST', { action: 'update', issueIds: [i1.id], patch: { assigneeId: b.id } }))
    ).json()) as { skipped: Array<{ reason: string }> };
    expect(bad.skipped[0].reason).toBe('invalid_assignee');

    // Quitar label y desasignar en varios proyectos a la vez.
    const multi = (await (
      await bulkRoute.POST(
        json('/b', 'POST', { action: 'update', issueIds: [i1.id, i3.id], patch: { removeLabelIds: [bug.label.id], assigneeId: null } }),
      )
    ).json()) as { updated: string[] };
    expect(multi.updated).toHaveLength(2);
    expect(parseIssueLabels((await getIssue(i1.id))!.labels)).toEqual([]);
    expect((await getIssue(i1.id))!.assignee_id).toBeNull();
  });

  it('borrar en masa: solo admin y solo del workspace', async () => {
    const { a, i1, i2, ib } = await setup();
    session.user = { ...a, team: null, role: 'member' };
    expect((await bulkRoute.POST(json('/b', 'POST', { action: 'delete', issueIds: [i1.id] }))).status).toBe(403);

    session.user = { ...a, team: null, role: 'owner' };
    const res = (await (await bulkRoute.POST(json('/b', 'POST', { action: 'delete', issueIds: [i1.id, i2.id, ib.id] }))).json()) as {
      updated: string[];
    };
    expect(res.updated).toHaveLength(2);
    expect(await getIssue(i1.id)).toBeUndefined();
    expect(await getIssue(ib.id)).toBeDefined();
  });
});

describe('Track: triage', () => {
  it('issues externos entran a triage; aceptar, rechazar y duplicado', async () => {
    const a = await makeUser('ta');
    const b = await makeUser('tb');
    const p = await createProject(a.id, null, { name: 'Triage' });

    // Sin triage activo, un issue externo va directo a la lista.
    const before = await createIssue(p.id, a.id, { title: 'flow sin triage', description: [] }, { source: 'flow' });
    expect(before.triage).toBe(0);

    await updateProject(p.id, { triageEnabled: true });
    const fromApp = await createIssue(p.id, a.id, { title: 'miembro', description: [] }, app);
    const fromFlow = await createIssue(p.id, a.id, { title: 'flow', description: [] }, { source: 'flow' });
    const fromChat = await createIssue(p.id, a.id, { title: 'chat', description: [] }, { source: 'chat' });
    const fromApi = await createIssue(p.id, a.id, { title: 'api', description: [] });
    expect([fromApp.triage, fromFlow.triage, fromChat.triage, fromApi.triage]).toEqual([0, 1, 1, 1]);
    expect(fromApi.source).toBe('api');

    // Fuera de la lista normal.
    const listed = (await listIssues(p.id)).rows.map((r) => r.id);
    expect(listed).toContain(fromApp.id);
    expect(listed).not.toContain(fromFlow.id);

    session.user = { ...a, team: null, role: 'member' };
    const queue = (await (await triageListRoute.GET(json('/q', 'GET'), params(p.id))).json()) as {
      rows: Array<{ id: string }>;
      enabled: boolean;
    };
    expect(queue.enabled).toBe(true);
    expect(queue.rows.map((r) => r.id).sort()).toEqual([fromFlow.id, fromChat.id, fromApi.id].sort());

    const statuses = await listStatuses(p.id);
    const inProgress = statuses.find((s) => s.category === 'in_progress')!;
    const foreignProject = await createProject(b.id, null, { name: 'Ajeno' });
    const foreignStatus = (await listStatuses(foreignProject.id))[0];

    // Validaciones.
    expect((await triageRoute.POST(json('/t', 'POST', { action: 'nope' }), params(fromFlow.id))).status).toBe(400);
    expect(
      (await triageRoute.POST(json('/t', 'POST', { action: 'accept', statusId: foreignStatus.id }), params(fromFlow.id))).status,
    ).toBe(400);
    expect((await triageRoute.POST(json('/t', 'POST', { action: 'accept' }), params(fromApp.id))).status).toBe(409);

    // Aceptar con status elegido.
    const accepted = await triageRoute.POST(json('/t', 'POST', { action: 'accept', statusId: inProgress.id }), params(fromFlow.id));
    expect(accepted.status).toBe(200);
    const acc = (await getIssue(fromFlow.id))!;
    expect([acc.triage, acc.status_id]).toEqual([0, inProgress.id]);

    // Rechazar → cancelado.
    expect((await triageRoute.POST(json('/t', 'POST', { action: 'decline' }), params(fromChat.id))).status).toBe(200);
    expect((await getIssue(fromChat.id))!.status_category).toBe('cancelled');

    // Duplicado: no puede apuntar a un issue ajeno ni a sí mismo.
    const foreignIssue = await createIssue(foreignProject.id, b.id, { title: 'x', description: [] }, app);
    expect(
      (await triageRoute.POST(json('/t', 'POST', { action: 'duplicate', duplicateOfId: foreignIssue.id }), params(fromApi.id))).status,
    ).toBe(400);
    expect(
      (await triageRoute.POST(json('/t', 'POST', { action: 'duplicate', duplicateOfId: fromApi.id }), params(fromApi.id))).status,
    ).toBe(400);
    expect(
      (await triageRoute.POST(json('/t', 'POST', { action: 'duplicate', duplicateOfId: fromApp.id }), params(fromApi.id))).status,
    ).toBe(200);
    const dup = (await getIssue(fromApi.id))!;
    expect([dup.triage, dup.status_category]).toEqual([0, 'cancelled']);
    const rel = await getDb()
      .prepare("SELECT type FROM track_issue_relations WHERE issue_id = ? AND related_issue_id = ?")
      .get(fromApi.id, fromApp.id);
    expect(rel).toEqual({ type: 'duplicates' });

    // Otro workspace: 404 en la cola y en las acciones.
    session.user = { ...b, team: null, role: 'owner' };
    expect((await triageListRoute.GET(json('/q', 'GET'), params(p.id))).status).toBe(404);
    const again = await createIssue(p.id, a.id, { title: 'otro', description: [] }, { source: 'github' });
    expect((await triageRoute.POST(json('/t', 'POST', { action: 'decline' }), params(again.id))).status).toBe(404);
  });
});
