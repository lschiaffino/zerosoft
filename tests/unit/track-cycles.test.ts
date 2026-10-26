import { describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';
import {
  completeCycle,
  createCycle,
  createIssue,
  createProject,
  deleteStatusWithReassign,
  getIssue,
  listCyclesWithProgress,
  listStatuses,
} from '@/lib/track-data';
import { cycleCreateSchema } from '@/lib/track-schema';
import { makeUser } from './helpers';

const session = vi.hoisted(() => ({ user: null as null | Record<string, unknown> }));
vi.mock('@/lib/session', () => ({
  getCurrentUser: async () => session.user,
  realUserId: (u: { id: string; actingUser?: { id: string } }) => u.actingUser?.id ?? u.id,
  isWorkspaceAdmin: (u: { role?: string }) => u.role === 'owner' || u.role === 'admin',
}));

const cycleRoute = await import('@/lib/routes/track/cycles/[id]/route');
const completeRoute = await import('@/lib/routes/track/cycles/[id]/complete/route');
const statusRoute = await import('@/lib/routes/track/statuses/[id]/route');
const cyclesRoute = await import('@/lib/routes/track/projects/[id]/cycles/route');

const json = (url: string, method: string, body?: unknown) =>
  new NextRequest(url, {
    method,
    headers: { 'content-type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  }) as never;
const params = (id: string) => ({ params: Promise.resolve({ id }) });

async function setup() {
  const u = await makeUser('trk');
  const project = await createProject(u.id, null, { name: `P ${crypto.randomUUID().slice(0, 6)}` });
  const statuses = await listStatuses(project.id);
  const st = (cat: string) => statuses.find((s) => s.category === cat)!;
  const c1 = await createCycle(project.id, { name: 'Sprint 1', startAt: '2026-01-01', endAt: '2026-01-14' });
  const c2 = await createCycle(project.id, { name: 'Sprint 2', startAt: '2026-01-15', endAt: '2026-01-28' });
  const open = await createIssue(project.id, u.id, { title: 'abierto', cycleId: c1.id, statusId: st('todo').id });
  const doing = await createIssue(project.id, u.id, { title: 'en curso', cycleId: c1.id, statusId: st('in_progress').id });
  const done = await createIssue(project.id, u.id, { title: 'listo', cycleId: c1.id, statusId: st('done').id });
  return { u, project, statuses, st, c1, c2, open, doing, done };
}

describe('Track cycles', () => {
  it('progreso: terminados / totales por cycle', async () => {
    const { project, c1, c2 } = await setup();
    const rows = await listCyclesWithProgress(project.id);
    expect(rows.find((c) => c.id === c1.id)).toMatchObject({ total: 3, done: 1 });
    expect(rows.find((c) => c.id === c2.id)).toMatchObject({ total: 0, done: 0 });
  });

  it('completar mueve los issues sin terminar al siguiente cycle', async () => {
    const { c1, c2, open, doing, done } = await setup();
    const res = await completeCycle(c1.id);
    expect(res).toEqual({ ok: true, moved: 2, targetCycleId: c2.id });
    expect((await getIssue(open.id))?.cycle_id).toBe(c2.id);
    expect((await getIssue(doing.id))?.cycle_id).toBe(c2.id);
    expect((await getIssue(done.id))?.cycle_id).toBe(c1.id);
  });

  it('sin cycle siguiente (o null explícito) los saca del cycle; target de otro proyecto = error', async () => {
    const { c2, open, project } = await setup();
    const other = await setup();
    expect(await completeCycle(c2.id, other.c1.id)).toEqual({ ok: false, reason: 'invalid_target' });
    // c2 no tiene issues; el último cycle sin siguiente:
    const last = await completeCycle(c2.id);
    expect(last).toMatchObject({ ok: true, moved: 0, targetCycleId: null });
    expect((await getIssue(open.id))?.project_id).toBe(project.id);
  });

  it('valida el rango de fechas', () => {
    expect(cycleCreateSchema.safeParse({ name: 'x', startAt: '2026-02-10', endAt: '2026-02-01' }).success).toBe(false);
    expect(cycleCreateSchema.safeParse({ name: 'x', startAt: '2026-02-01', endAt: '2026-02-10' }).success).toBe(true);
  });

  it('API: editar y completar; otro usuario recibe 404', async () => {
    const { u, c1, c2, project } = await setup();
    const stranger = await makeUser('stranger');

    session.user = { ...stranger, team: null };
    expect((await cycleRoute.PATCH(json('http://x/api', 'PATCH', { name: 'hack' }), params(c1.id))).status).toBe(404);
    expect((await completeRoute.POST(json('http://x/api', 'POST', {}), params(c1.id))).status).toBe(404);
    expect((await cyclesRoute.GET(json('http://x/api', 'GET'), params(project.id))).status).toBe(404);

    session.user = { ...u, team: null };
    const bad = await cycleRoute.PATCH(json('http://x/api', 'PATCH', { endAt: '2025-01-01' }), params(c1.id));
    expect(bad.status).toBe(400);
    const ok = await cycleRoute.PATCH(json('http://x/api', 'PATCH', { name: 'Sprint uno' }), params(c1.id));
    expect(ok.status).toBe(200);
    expect(((await ok.json()) as { name: string }).name).toBe('Sprint uno');

    const done = await completeRoute.POST(json('http://x/api', 'POST', { targetCycleId: c2.id }), params(c1.id));
    expect(done.status).toBe(200);
    expect(await done.json()).toMatchObject({ ok: true, moved: 2, targetCycleId: c2.id });

    const list = await cyclesRoute.GET(json('http://x/api', 'GET'), params(project.id));
    const rows = ((await list.json()) as { rows: Array<{ id: string; total: number }> }).rows;
    expect(rows.find((c) => c.id === c2.id)?.total).toBe(2);
    session.user = null;
  });
});

describe('Track statuses: borrar con reasignación', () => {
  it('reasigna los issues al status elegido y borra', async () => {
    const { project, st, open } = await setup();
    const res = await deleteStatusWithReassign(st('todo').id, st('backlog').id);
    expect(res).toEqual({ ok: true, reassigned: 1 });
    expect((await getIssue(open.id))?.status_id).toBe(st('backlog').id);
    expect((await listStatuses(project.id)).some((s) => s.id === st('todo').id)).toBe(false);
  });

  it('no reasigna a un status de otro proyecto', async () => {
    const a = await setup();
    const b = await setup();
    expect(await deleteStatusWithReassign(a.st('todo').id, b.st('todo').id)).toEqual({
      ok: false,
      reason: 'invalid_target',
    });
  });

  it('API: renombrar/categoría, borrar con reassignTo y aislamiento', async () => {
    const { u, st, project } = await setup();
    const stranger = await makeUser('stranger');

    session.user = { ...stranger, team: null, role: 'owner' };
    expect((await statusRoute.PATCH(json('http://x/api', 'PATCH', { name: 'x' }), params(st('todo').id))).status).toBe(404);
    expect(
      (await statusRoute.DELETE(json('http://x/api', 'DELETE', { reassignTo: st('done').id }), params(st('todo').id))).status,
    ).toBe(404);

    session.user = { ...u, team: null, role: 'owner' };
    const ren = await statusRoute.PATCH(json('http://x/api', 'PATCH', { name: 'Por hacer', category: 'backlog' }), params(st('todo').id));
    expect(ren.status).toBe(200);
    expect(await ren.json()).toMatchObject({ name: 'Por hacer', category: 'backlog' });

    expect((await statusRoute.DELETE(json('http://x/api', 'DELETE', {}), params(st('todo').id))).status).toBe(400);
    const del = await statusRoute.DELETE(json('http://x/api', 'DELETE', { reassignTo: st('done').id }), params(st('todo').id));
    expect(del.status).toBe(200);
    expect((await listStatuses(project.id)).length).toBe(4);
    session.user = null;
  });
});
