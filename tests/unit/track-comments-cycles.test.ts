import { describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';
import {
  completeCycle,
  createCycle,
  createIssue,
  createIssueComment,
  createProject,
  listIssueActivities,
  listStatuses,
} from '@/lib/track-data';
import { commentCreateSchema } from '@/lib/track-schema';
import { addMember, createTeam } from '@/lib/teams';
import { getDb } from '@/lib/db';
import { makeUser } from './helpers';

const session = vi.hoisted(() => ({ user: null as null | Record<string, unknown> }));
vi.mock('@/lib/session', () => ({
  getCurrentUser: async () => session.user,
  realUserId: (u: { id: string; actingUser?: { id: string } }) => u.actingUser?.id ?? u.id,
  isWorkspaceAdmin: (u: { role?: string }) => u.role === 'owner' || u.role === 'admin',
}));
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

const commentRoute = await import('@/app/api/track/issues/[id]/comments/[commentId]/route');
const commentsRoute = await import('@/app/api/track/issues/[id]/comments/route');

const req = (method: string, body?: unknown) =>
  new NextRequest('http://x/c', {
    method,
    headers: { 'content-type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  }) as never;
const params = (id: string, commentId: string) => ({ params: Promise.resolve({ id, commentId }) });

async function teamIssue() {
  const owner = await makeUser('own');
  const member = await makeUser('mem');
  const team = await createTeam(owner.id, 'Team');
  await addMember(team.id, member.id);
  const project = await createProject(owner.id, team.id, { name: `P ${crypto.randomUUID().slice(0, 6)}` });
  const issue = await createIssue(project.id, owner.id, { title: 'Bug' });
  const as = (u: { id: string; email: string }, role: string) => ({ ...u, team: { id: team.id }, role });
  return { owner, member, project, issue, as };
}

const commentMetas = async (issueId: string) =>
  (await listIssueActivities(issueId))
    .filter((a) => a.type === 'comment')
    .map((a) => JSON.parse(a.meta) as { commentId: string; body: string; editedAt: string | null });

describe('Track: editar y borrar comentarios propios', () => {
  it('rechaza comentarios vacíos', async () => {
    expect(commentCreateSchema.safeParse({ body: '   ' }).success).toBe(false);
    const { owner, issue, as } = await teamIssue();
    session.user = as(owner, 'owner');
    const res = await commentsRoute.POST(req('POST', { body: '' }), { params: Promise.resolve({ id: issue.id }) });
    expect(res.status).toBe(400);
  });

  it('el autor edita: el timeline muestra el texto nuevo, marca editado y no guarda la versión vieja', async () => {
    const { owner, member, issue, as } = await teamIssue();
    const c = await createIssueComment(issue.id, member.id, { body: 'token: sk-secreto' });

    session.user = as(owner, 'owner');
    const forbidden = await commentRoute.PATCH(req('PATCH', { body: 'hack' }), params(issue.id, c.id));
    expect(forbidden.status).toBe(403);

    session.user = as(member, 'member');
    expect((await commentRoute.PATCH(req('PATCH', { body: '  ' }), params(issue.id, c.id))).status).toBe(400);
    const ok = await commentRoute.PATCH(req('PATCH', { body: 'sin secreto' }), params(issue.id, c.id));
    expect(ok.status).toBe(200);

    const metas = await commentMetas(issue.id);
    expect(metas).toHaveLength(1);
    expect(metas[0]).toMatchObject({ commentId: c.id, body: 'sin secreto' });
    expect(metas[0].editedAt).toBeTruthy();
    const raw = (await getDb()
      .prepare("SELECT meta FROM track_issue_activities WHERE issue_id = ? AND type = 'comment'")
      .all(issue.id)) as Array<{ meta: string }>;
    expect(raw.every((r) => !r.meta.includes('sk-secreto'))).toBe(true);
  });

  it('el autor borra: desaparece del timeline y del log; otro usuario no puede', async () => {
    const { owner, member, issue, as } = await teamIssue();
    const c = await createIssueComment(issue.id, member.id, { body: 'borrame' });
    // Fila legacy con el cuerpo copiado en meta.
    await getDb()
      .prepare(
        "INSERT INTO track_issue_activities (id, issue_id, user_id, type, meta, created_at) VALUES (?, ?, ?, 'comment', ?, datetime('now'))",
      )
      .run(crypto.randomUUID(), issue.id, member.id, JSON.stringify({ commentId: c.id, body: 'borrame' }));

    session.user = as(owner, 'owner');
    expect((await commentRoute.DELETE(req('DELETE'), params(issue.id, c.id))).status).toBe(403);

    session.user = as(member, 'member');
    expect((await commentRoute.DELETE(req('DELETE'), params(issue.id, c.id))).status).toBe(200);
    expect((await commentRoute.DELETE(req('DELETE'), params(issue.id, c.id))).status).toBe(404);
    expect(await commentMetas(issue.id)).toHaveLength(0);
    const left = (await getDb()
      .prepare("SELECT COUNT(*) AS n FROM track_issue_activities WHERE issue_id = ? AND type = 'comment'")
      .get(issue.id)) as { n: number };
    expect(left.n).toBe(0);
  });
});

describe('Track: completar un cycle deja actividad y eventos', () => {
  it('escribe cycle_change y emite issue.updated por cada issue movido', async () => {
    const u = await makeUser('cyc');
    const project = await createProject(u.id, null, { name: `P ${crypto.randomUUID().slice(0, 6)}` });
    const statuses = await listStatuses(project.id);
    const st = (cat: string) => statuses.find((s) => s.category === cat)!;
    const c1 = await createCycle(project.id, { name: 'Sprint 1', startAt: '2026-01-01', endAt: '2026-01-14' });
    const c2 = await createCycle(project.id, { name: 'Sprint 2', startAt: '2026-01-15', endAt: '2026-01-28' });
    const open = await createIssue(project.id, u.id, { title: 'abierto', cycleId: c1.id, statusId: st('todo').id });
    const done = await createIssue(project.id, u.id, { title: 'listo', cycleId: c1.id, statusId: st('done').id });

    emitted.length = 0;
    const res = await completeCycle(c1.id, undefined, u.id);
    expect(res).toEqual({ ok: true, moved: 1, targetCycleId: c2.id });
    await Promise.all(pending);

    const change = (await listIssueActivities(open.id)).find((a) => a.type === 'cycle_change');
    expect(change?.user_id).toBe(u.id);
    expect(JSON.parse(change!.meta)).toMatchObject({ from: 'Sprint 1', to: 'Sprint 2' });
    expect((await listIssueActivities(done.id)).some((a) => a.type === 'cycle_change')).toBe(false);

    const updated = emitted.filter((e) => e.type === 'issue.updated');
    expect(updated).toHaveLength(1);
    expect(updated[0].data).toMatchObject({ issue: { id: open.id }, changes: ['cycleId'] });
  });
});
