import { describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';
import { bulkEditIssues, resolveTriage } from '@/lib/track-bulk';
import { branchNameFor } from '@/lib/track-branch';
import { branchNameFor as serverBranchNameFor } from '@/lib/track-github';
import { createIssue, createProject, getIssue, listStatuses, updateProject } from '@/lib/track-data';
import { createLabel, deleteLabel, parseIssueLabels } from '@/lib/track-labels';
import { makeUser } from './helpers';

const session = vi.hoisted(() => ({ user: null as null | Record<string, unknown> }));
vi.mock('@/lib/session', () => ({
  getCurrentUser: async () => session.user,
  realUserId: (u: { id: string; actingUser?: { id: string } }) => u.actingUser?.id ?? u.id,
  isWorkspaceAdmin: (u: { role?: string }) => u.role === 'owner' || u.role === 'admin',
}));

const relationsRoute = await import('@/lib/routes/track/issues/[id]/relations/route');

const json = (method: string, body?: unknown) =>
  new NextRequest('http://x/api', {
    method,
    headers: { 'content-type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  }) as never;
const params = (id: string) => ({ params: Promise.resolve({ id }) });
const app = { source: 'app' as const };
const uid = () => crypto.randomUUID().slice(0, 6);

describe('Track gauntlet r4: triage', () => {
  it('dos resoluciones a la vez: la segunda responde not_in_triage y no pisa la primera', async () => {
    const a = await makeUser('r4tr');
    const p = await createProject(a.id, null, { name: 'Triage r4' });
    await updateProject(p.id, { triageEnabled: true });
    const issue = await createIssue(p.id, a.id, { title: 'externo', description: [] }, { source: 'flow' });
    expect(issue.triage).toBe(1);
    const inProgress = (await listStatuses(p.id)).find((s) => s.category === 'in_progress')!;

    // Las dos requests leyeron el issue en triage antes de resolver.
    const stale = (await getIssue(issue.id))!;
    const first = await resolveTriage(stale, { action: 'accept', statusId: inProgress.id }, a.id);
    expect(first.ok).toBe(true);
    const second = await resolveTriage(stale, { action: 'decline' }, a.id);
    expect(second).toEqual({ ok: false, reason: 'not_in_triage' });

    const after = (await getIssue(issue.id))!;
    expect([after.triage, after.status_id]).toEqual([0, inProgress.id]);
  });
});

describe('Track gauntlet r4: relaciones', () => {
  it('acepta identifiers de slugs largos (36+ caracteres)', async () => {
    const a = await makeUser('r4rl');
    const p1 = await createProject(a.id, null, { name: 'Plataforma', slug: `plataforma-de-pagos-internacionales-${uid()}` });
    const p2 = await createProject(a.id, null, { name: 'Corto r4' });
    const target = await createIssue(p1.id, a.id, { title: 'largo', description: [] }, app);
    const from = await createIssue(p2.id, a.id, { title: 'origen', description: [] }, app);
    expect(target.identifier.length).toBeGreaterThanOrEqual(36);
    session.user = { ...a, team: null, role: 'owner' };

    const res = await relationsRoute.POST(
      json('POST', { relatedIssueId: target.identifier.toLowerCase(), type: 'related' }),
      params(from.id),
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as { rows: Array<{ related_issue_id?: string; issue_id?: string }> };
    expect(JSON.stringify(body.rows)).toContain(target.id);
  });
});

describe('Track gauntlet r4: edición masiva', () => {
  it('agregar un label borrado se informa como salteado, no como actualizado', async () => {
    const a = await makeUser('r4bl');
    const p = await createProject(a.id, null, { name: 'Bulk r4' });
    const issue = await createIssue(p.id, a.id, { title: 'x', description: [] }, app);
    const bug = await createLabel(a.id, { name: `bug-${uid()}` });
    if (!bug.ok) throw new Error('setup');
    await deleteLabel(a.id, bug.label.id);

    const res = await bulkEditIssues(
      { action: 'update', issueIds: [issue.id], patch: { addLabelIds: [bug.label.id] } },
      { teamId: null, ownerId: a.id, actorId: a.id },
    );
    expect(res.updated).toEqual([]);
    expect(res.skipped).toEqual([{ id: issue.id, reason: 'invalid_label' }]);
    expect(parseIssueLabels((await getIssue(issue.id))!.labels)).toEqual([]);
  });
});

describe('Track gauntlet r4: branch', () => {
  it('el nombre de branch se calcula igual en cliente y server', () => {
    expect(branchNameFor('ZER-12', 'Arreglar login')).toBe('zer-12-arreglar-login');
    expect(serverBranchNameFor('ZER-12', 'Ácido')).toBe(branchNameFor('ZER-12', 'Ácido'));
    expect(branchNameFor('ZER-12', 'Ácido')).toBe('zer-12-acido');
  });
});
