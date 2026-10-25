import { describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';
import { getDb } from '@/lib/db';
import {
  createCycle,
  createIssue,
  createIssueActivity,
  createProject,
  getIssue,
  listIssues,
  listStatuses,
  updateIssue,
} from '@/lib/track-data';
import {
  aggregateInsight,
  computeCycleMetrics,
  computeProgress,
  healthState,
  insightCsv,
  nextReminderAt,
  velocity,
  capacityPercent,
  type InsightIssue,
} from '@/lib/track-planning-core';
import { createPlan, getPlanSummary, listPlans, setPlanIssues, updatePlan, listPlanEvents, planRecipients, setPlanFollow } from '@/lib/track-plans';
import { createPlanUpdate, runPlanUpdateReminders } from '@/lib/track-plan-updates';
import { createInitiative, listInitiatives, worstHealth } from '@/lib/track-initiatives';
import { autoArchiveIssues, autoCloseIssues, autoCompleteCycles, getAutomation, restoreIssues, setAutomation } from '@/lib/track-housekeeping';
import { cycleMetrics } from '@/lib/track-cycle-metrics';
import { runInsight, mergeFilters } from '@/lib/track-insights';
import { canSeeDashboard, createDashboard, listDashboards } from '@/lib/track-dashboards';
import { searchPlanning } from '@/lib/track-planning-search';
import { makeUser } from './helpers';

const session = vi.hoisted(() => ({ user: null as null | Record<string, unknown> }));
vi.mock('@/lib/session', () => ({
  getCurrentUser: async () => session.user,
  realUserId: (u: { id: string; actingUser?: { id: string } }) => u.actingUser?.id ?? u.id,
  isWorkspaceAdmin: (u: { role?: string }) => u.role === 'owner' || u.role === 'admin',
}));

const plansRoute = await import('@/app/api/track/plans/route');
const planRoute = await import('@/app/api/track/plans/[id]/route');
const planUpdatesRoute = await import('@/app/api/track/plans/[id]/updates/route');
const updateRoute = await import('@/app/api/track/plan-updates/[id]/route');
const dashboardRoute = await import('@/app/api/track/dashboards/[id]/route');

const json = (url: string, method: string, body?: unknown) =>
  new NextRequest(url, {
    method,
    headers: { 'content-type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  }) as never;
const params = (id: string) => ({ params: Promise.resolve({ id }) });

async function setup() {
  const u = await makeUser('plan');
  const scope = { teamId: null, ownerId: u.id };
  const project = await createProject(u.id, null, { name: `T ${crypto.randomUUID().slice(0, 6)}` });
  const statuses = await listStatuses(project.id);
  const st = (cat: string) => statuses.find((s) => s.category === cat)!;
  return { u, scope, project, statuses, st };
}

describe('planificación: cálculos puros', () => {
  it('progreso: sin cancelados; por puntos si hay estimaciones', () => {
    expect(computeProgress([{ category: 'done', estimate: null }, { category: 'todo', estimate: null }, { category: 'cancelled', estimate: null }])).toMatchObject({
      total: 2,
      done: 1,
      percent: 50,
      byPoints: false,
    });
    const p = computeProgress([{ category: 'done', estimate: 3 }, { category: 'in_progress', estimate: 1 }, { category: 'todo', estimate: null }]);
    expect(p).toMatchObject({ byPoints: true, points: 5, donePoints: 3, percent: 60, started: 1 });
  });

  it('salud: último update, o "falta el update" pasado el ciclo + 3 días', () => {
    const now = new Date('2026-10-25T12:00:00Z');
    expect(healthState({ status: 'in_progress', cadence: 'weekly', lastUpdateHealth: 'at_risk', lastUpdateAt: '2026-10-20T00:00:00Z', since: '2026-01-01', now })).toBe('at_risk');
    expect(healthState({ status: 'in_progress', cadence: 'weekly', lastUpdateHealth: 'on_track', lastUpdateAt: '2026-10-10T00:00:00Z', since: '2026-01-01', now })).toBe('missing');
    expect(healthState({ status: 'planned', cadence: 'weekly', lastUpdateHealth: null, lastUpdateAt: null, since: '2026-01-01', now })).toBe('none');
    expect(healthState({ status: 'in_progress', cadence: 'off', lastUpdateHealth: null, lastUpdateAt: null, since: '2026-01-01', now })).toBe('none');
  });

  it('recordatorio: el próximo viernes a las 9 en la zona del lead', () => {
    // Domingo 25/10/2026 en Buenos Aires (UTC-3): viernes 30 a las 9 = 12:00 UTC.
    const at = nextReminderAt({ after: new Date('2026-10-25T15:00:00Z'), day: 5, cadence: 'weekly', timeZone: 'America/Argentina/Buenos_Aires' });
    expect(at?.toISOString()).toBe('2026-10-30T12:00:00.000Z');
    // Viernes después de las 9: pasa al viernes siguiente.
    const later = nextReminderAt({ after: new Date('2026-10-30T13:00:00Z'), day: 5, cadence: 'weekly', timeZone: 'America/Argentina/Buenos_Aires' });
    expect(later?.toISOString()).toBe('2026-11-06T12:00:00.000Z');
    expect(nextReminderAt({ after: new Date(), day: 5, cadence: 'off' })).toBeNull();
    const bi = nextReminderAt({ after: new Date('2026-10-25T15:00:00Z'), day: 5, cadence: 'biweekly', lastReminderAt: new Date('2026-10-23T12:00:00Z') });
    expect(bi?.toISOString().slice(0, 10)).toBe('2026-11-06');
  });

  it('burn-up del cycle: alcance, scope creep, terminados y rollover', () => {
    const m = computeCycleMetrics({
      start: '2026-10-01',
      end: '2026-10-05',
      today: '2026-10-10',
      issues: [
        // Estaba desde antes y se terminó el día 3.
        { id: 'a', estimate: null, createdAt: '2026-09-20T10:00:00Z', category: 'done', inCycle: true, moves: [{ at: '2026-09-25T10:00:00Z', kind: 'join' }], statusChanges: [{ at: '2026-10-03T10:00:00Z', from: 'todo', to: 'done' }] },
        // Agregado el día 2 (scope creep), quedó sin terminar y pasó al siguiente al cerrar.
        { id: 'b', estimate: null, createdAt: '2026-09-20T10:00:00Z', category: 'in_progress', inCycle: false, moves: [{ at: '2026-10-02T09:00:00Z', kind: 'join' }, { at: '2026-10-06T00:00:00Z', kind: 'leave', rollover: true }], statusChanges: [{ at: '2026-10-04T10:00:00Z', from: 'todo', to: 'in_progress' }] },
        // Sacado el día 2.
        { id: 'c', estimate: null, createdAt: '2026-09-20T10:00:00Z', category: 'todo', inCycle: false, moves: [{ at: '2026-09-25T10:00:00Z', kind: 'join' }, { at: '2026-10-02T12:00:00Z', kind: 'leave' }], statusChanges: [] },
      ],
    });
    expect(m.points.map((p) => p.scope)).toEqual([2, 2, 2, 2, 2]);
    expect(m.points.map((p) => p.completed)).toEqual([0, 0, 1, 1, 1]);
    expect(m.points[3].started).toBe(1);
    expect(m).toMatchObject({ initialScope: 2, added: 1, removed: 1, carriedOver: 1, scopeCreepPercent: 50, completionPercent: 50 });
  });

  it('velocidad y capacidad', () => {
    expect(velocity([])).toBeNull();
    expect(velocity([10, 4, 6, 8])).toBe(6);
    expect(capacityPercent(9, 6)).toBe(150);
    expect(capacityPercent(9, null)).toBeNull();
  });

  it('insights: cantidad por tipo de estado segmentada por prioridad, tiempos y CSV', () => {
    const base: Omit<InsightIssue, 'id' | 'category' | 'priority' | 'createdAt' | 'startedAt' | 'completedAt'> = {
      identifier: 'X-1', title: 't', projectId: 'p', projectName: 'P', statusName: 's', assigneeId: null, assigneeName: null,
      labels: [], planId: null, planName: null, cycleId: null, cycleName: null, estimate: 2,
    };
    const issues: InsightIssue[] = [
      { ...base, id: '1', category: 'done', priority: 'high', createdAt: '2026-10-01T00:00:00Z', startedAt: '2026-10-02T00:00:00Z', completedAt: '2026-10-04T00:00:00Z' },
      { ...base, id: '2', category: 'done', priority: 'low', createdAt: '2026-10-01T00:00:00Z', startedAt: '2026-10-03T00:00:00Z', completedAt: '2026-10-11T00:00:00Z' },
      { ...base, id: '3', category: 'todo', priority: 'high', createdAt: '2026-10-05T00:00:00Z', startedAt: null, completedAt: null },
    ];
    const count = aggregateInsight(issues, { measure: 'count', slice: 'status_type', segment: 'priority' });
    expect(count.buckets.map((b) => [b.key, b.value])).toEqual([['todo', 1], ['done', 2]]);
    expect(count.segmentKeys.map((s) => s.key)).toEqual(['high', 'low']);
    expect(count.buckets.find((b) => b.key === 'done')!.segments).toHaveLength(2);
    const effort = aggregateInsight(issues, { measure: 'effort', slice: 'priority', segment: 'none' });
    expect(effort.total).toBe(6);
    const cycle = aggregateInsight(issues, { measure: 'cycle_time', slice: 'status_type', segment: 'priority' });
    expect(cycle.segment).toBe('none');
    expect(cycle.issueCount).toBe(2);
    expect(cycle.buckets[0]).toMatchObject({ key: 'done', value: 2, p90: 8 });
    const burn = aggregateInsight(issues, { measure: 'count', slice: 'burnup', segment: 'none', interval: 'week' });
    expect(burn.burnup?.at(-1)).toMatchObject({ scope: 3, completed: 2 });
    expect(insightCsv(count).split('\n')[0]).toBe('slice,issues,issues,high,low');
  });

  it('salud de una initiative: la peor entre sus plans en curso', () => {
    expect(worstHealth([{ status: 'in_progress', health: 'on_track' }, { status: 'in_progress', health: 'at_risk' }, { status: 'completed', health: 'off_track' }])).toBe('at_risk');
    expect(worstHealth([{ status: 'planned', health: 'on_track' }])).toBe('none');
  });

  it('filtros de dashboard + widget se intersectan', () => {
    expect(mergeFilters({ teamIds: ['a', 'b'], createdAfter: '2026-01-01' }, { teamIds: ['b'], createdAfter: '2026-03-01' })).toMatchObject({
      teamIds: ['b'],
      createdAfter: '2026-03-01',
    });
  });
});

describe('plans', () => {
  it('crear, sumar issues (el team se suma solo), progreso y milestones por issues', async () => {
    const { u, scope, project, st } = await setup();
    const res = await createPlan(scope, u.id, { name: 'Checkout', status: 'in_progress', leadId: u.id, targetDate: '2026-12-01' });
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    const a = await createIssue(project.id, u.id, { title: 'a', statusId: st('done').id });
    const b = await createIssue(project.id, u.id, { title: 'b', statusId: st('todo').id });
    expect(await setPlanIssues(res.plan, scope, 'add', [a.id, b.id])).toBe(2);
    const sum = await getPlanSummary(res.plan.id, scope);
    expect(sum?.teams.map((t) => t.id)).toEqual([project.id]);
    expect(sum?.progress).toMatchObject({ total: 2, done: 1, percent: 50 });
    // Un plan con fecha de inicio pasada y sin updates: falta el update.
    expect((await listPlans(scope, { status: ['in_progress'] })).map((p) => p.id)).toContain(res.plan.id);
  });

  it('valida rango de fechas y lead del workspace, y registra el historial', async () => {
    const { u, scope } = await setup();
    const stranger = await makeUser('x');
    expect(await createPlan(scope, u.id, { name: 'r', startDate: '2026-02-01', targetDate: '2026-01-01' })).toEqual({ ok: false, error: 'invalid_range' });
    expect(await createPlan(scope, u.id, { name: 'r', leadId: stranger.id })).toEqual({ ok: false, error: 'invalid_lead' });
    const res = await createPlan(scope, u.id, { name: 'r' });
    if (!res.ok) throw new Error('create');
    await updatePlan(res.plan, scope, u.id, { targetDate: '2026-12-24', status: 'in_progress' });
    const types = (await listPlanEvents(res.plan.id)).map((e) => e.type);
    expect(types).toEqual(expect.arrayContaining(['created', 'target_date', 'status']));
  });

  it('otro workspace no ve ni edita el plan (API)', async () => {
    const { u, scope } = await setup();
    const res = await createPlan(scope, u.id, { name: 'privado' });
    if (!res.ok) throw new Error('create');
    const other = await makeUser('o');
    session.user = { ...other, role: 'owner', team: null };
    expect((await planRoute.GET(json('http://x/api/track/plans/1', 'GET'), params(res.plan.id))).status).toBe(404);
    expect((await planRoute.PATCH(json('http://x', 'PATCH', { name: 'hack' }), params(res.plan.id))).status).toBe(404);
    expect((await planRoute.DELETE(json('http://x', 'DELETE'), params(res.plan.id))).status).toBe(404);
    const list = await (await plansRoute.GET(json('http://x/api/track/plans', 'GET'))).json();
    expect(list.rows.map((r: { id: string }) => r.id)).not.toContain(res.plan.id);
    session.user = null;
  });
});

describe('updates de plans', () => {
  it('publicar avisa a lead, miembros y seguidores (menos al autor); solo el autor edita', async () => {
    const { u, scope } = await setup();
    const res = await createPlan(scope, u.id, { name: 'Upd', status: 'in_progress', leadId: u.id });
    if (!res.ok) throw new Error('create');
    const follower = await makeUser('f');
    await setPlanFollow(res.plan.id, follower.id, true);
    expect(await planRecipients(res.plan.id)).toEqual(expect.arrayContaining([u.id, follower.id]));
    session.user = { ...u, role: 'owner', team: null };
    const post = await planUpdatesRoute.POST(json('http://x', 'POST', { health: 'at_risk', body: 'Atrasado' }), params(res.plan.id));
    expect(post.status).toBe(201);
    const update = await post.json();
    const notes = (await getDb()
      .prepare("SELECT user_id, type FROM notifications WHERE source_type = 'track_plan' AND source_id = ?")
      .all(res.plan.id)) as Array<{ user_id: string; type: string }>;
    expect(notes).toEqual([{ user_id: follower.id, type: 'project_update' }]);
    expect((await getPlanSummary(res.plan.id, scope))?.health).toBe('at_risk');
    session.user = { ...follower, role: 'member', team: null, id: u.id, actingUser: follower };
    expect((await updateRoute.PATCH(json('http://x', 'PATCH', { body: 'x' }), params(update.id)))?.status).toBe(403);
    session.user = null;
  });

  it('recordatorio al lead por el tick, una sola vez (claim)', async () => {
    const { u, scope } = await setup();
    const res = await createPlan(scope, u.id, { name: 'Rem', status: 'in_progress', leadId: u.id });
    if (!res.ok) throw new Error('create');
    await getDb().prepare('UPDATE track_plans SET next_reminder_at = ? WHERE id = ?').run('2026-01-01T00:00:00.000Z', res.plan.id);
    const now = new Date('2026-01-02T00:00:00Z');
    const [a, b] = await Promise.all([runPlanUpdateReminders({ now }), runPlanUpdateReminders({ now })]);
    const sent = (await getDb()
      .prepare("SELECT COUNT(*) AS c FROM notifications WHERE source_id = ? AND type = 'track_reminder'")
      .get(res.plan.id)) as { c: number };
    expect(Number(sent.c)).toBe(1);
    expect(a + b).toBeGreaterThanOrEqual(1);
    const plan = (await getDb().prepare('SELECT next_reminder_at FROM track_plans WHERE id = ?').get(res.plan.id)) as { next_reminder_at: string };
    expect(plan.next_reminder_at > '2026-01-02').toBe(true);
    // Con un update reciente no avisa.
    await createPlanUpdate((await getPlanSummary(res.plan.id, scope))!, u.id, { health: 'on_track', body: '' });
    await getDb().prepare('UPDATE track_plans SET next_reminder_at = ? WHERE id = ?').run(new Date(Date.now() - 1000).toISOString(), res.plan.id);
    expect(await runPlanUpdateReminders()).toBe(0);
  });
});

describe('initiatives', () => {
  it('agrega el progreso de sus plans y de las sub-initiatives', async () => {
    const { u, scope, project, st } = await setup();
    const p1 = await createPlan(scope, u.id, { name: 'p1', status: 'in_progress' });
    const p2 = await createPlan(scope, u.id, { name: 'p2' });
    if (!p1.ok || !p2.ok) throw new Error('create');
    const i1 = await createIssue(project.id, u.id, { title: 'i1', statusId: st('done').id });
    const i2 = await createIssue(project.id, u.id, { title: 'i2', statusId: st('todo').id });
    await setPlanIssues(p1.plan, scope, 'add', [i1.id]);
    await setPlanIssues(p2.plan, scope, 'add', [i2.id]);
    const parent = await createInitiative(scope, u.id, { name: 'Goal', planIds: [p1.plan.id] });
    await createInitiative(scope, u.id, { name: 'Sub', parentId: parent.id, planIds: [p2.plan.id] });
    const row = (await listInitiatives(scope)).find((i) => i.id === parent.id)!;
    expect(row.plans.map((p) => p.id).sort()).toEqual([p1.plan.id, p2.plan.id].sort());
    expect(row.percent).toBe(50);
    expect(row.child_ids).toHaveLength(1);
  });
});

describe('cycles: métricas desde la actividad', () => {
  it('scope creep y terminados', async () => {
    const { u, project, st } = await setup();
    const today = new Date().toISOString().slice(0, 10);
    const start = new Date(Date.now() - 3 * 86_400_000).toISOString().slice(0, 10);
    const end = new Date(Date.now() + 7 * 86_400_000).toISOString().slice(0, 10);
    const cycle = await createCycle(project.id, { name: 'S1', startAt: start, endAt: end });
    const a = await createIssue(project.id, u.id, { title: 'a', statusId: st('todo').id, cycleId: cycle.id });
    await getDb().prepare('UPDATE track_issues SET created_at = ? WHERE id = ?').run(`${start}T00:00:00.000Z`, a.id);
    const b = await createIssue(project.id, u.id, { title: 'b', statusId: st('todo').id });
    await updateIssue(b.id, { cycleId: cycle.id }, u.id);
    await updateIssue(a.id, { statusId: st('done').id }, u.id);
    const m = await cycleMetrics(cycle, today);
    expect(m).toMatchObject({ scope: 2, completed: 1, added: 1, state: 'active' });
  });
});

describe('auto-cierre, auto-archivo y cierre de cycles', () => {
  it('cierra lo viejo sin actividad, archiva lo terminado viejo y lo restaura', async () => {
    const { u, project, st } = await setup();
    const stale = await createIssue(project.id, u.id, { title: 'viejo', statusId: st('backlog').id });
    const fresh = await createIssue(project.id, u.id, { title: 'nuevo', statusId: st('todo').id });
    const done = await createIssue(project.id, u.id, { title: 'hecho', statusId: st('done').id });
    const old = new Date(Date.now() - 200 * 86_400_000).toISOString();
    await getDb().prepare('UPDATE track_issues SET updated_at = ? WHERE id IN (?, ?)').run(old, stale.id, done.id);
    expect(await setAutomation(project.id, { autoCloseMonths: 3, autoArchiveMonths: 6 })).toEqual({ ok: true });
    const conf = (await getAutomation(project.id))!;
    expect(await autoCloseIssues(conf, new Date())).toBe(1);
    expect((await getIssue(stale.id))?.status_category).toBe('cancelled');
    expect((await getIssue(fresh.id))?.status_category).toBe('todo');
    expect(await autoArchiveIssues(conf, new Date())).toBe(1);
    const listed = await listIssues(project.id, { pageSize: 100 });
    expect(listed.rows.map((r) => r.id)).not.toContain(done.id);
    expect(await restoreIssues([project.id], [done.id])).toBe(1);
    expect((await listIssues(project.id, { pageSize: 100 })).rows.map((r) => r.id)).toContain(done.id);
  });

  it('un cycle vencido se completa solo y pasa lo sin terminar al siguiente', async () => {
    const { u, project, st } = await setup();
    const c1 = await createCycle(project.id, { name: 'Old', startAt: '2026-01-01', endAt: '2026-01-14' });
    const c2 = await createCycle(project.id, { name: 'Next', startAt: '2099-01-15', endAt: '2099-01-28' });
    const open = await createIssue(project.id, u.id, { title: 'abierto', statusId: st('todo').id, cycleId: c1.id });
    const conf = (await getAutomation(project.id))!;
    expect(await autoCompleteCycles(conf, new Date())).toEqual({ completed: 1, moved: 1 });
    expect((await getIssue(open.id))?.cycle_id).toBe(c2.id);
    expect(await autoCompleteCycles(conf, new Date())).toEqual({ completed: 0, moved: 0 });
  });
});

describe('insights y dashboards', () => {
  it('insights con datos reales: cycle time desde la actividad', async () => {
    const { u, scope, project, st } = await setup();
    const i = await createIssue(project.id, u.id, { title: 'ct', statusId: st('todo').id });
    await createIssueActivity(i.id, u.id, 'status_change', { toCategory: 'in_progress' });
    await updateIssue(i.id, { statusId: st('done').id }, u.id);
    const r = await runInsight(scope, { measure: 'cycle_time', slice: 'team', segment: 'none', interval: 'week', filters: { teamIds: [project.id] } });
    expect(r.issueCount).toBe(1);
    const c = await runInsight(scope, { measure: 'count', slice: 'status_type', segment: 'none', interval: 'week', filters: { teamIds: [project.id] } });
    expect(c.total).toBe(1);
  });

  it('dashboards personales solo para su dueño; la API devuelve widgets con resultado', async () => {
    const { u, scope } = await setup();
    const mate = await makeUser('m');
    const pub = await createDashboard(scope, u.id, { name: 'Equipo' });
    const mine = await createDashboard(scope, u.id, { name: 'Mío', visibility: 'personal' });
    expect(canSeeDashboard(mine, scope, mate.id)).toBe(false);
    expect((await listDashboards(scope, mate.id)).map((d) => d.id)).toEqual([pub.id]);
    expect((await searchPlanning(scope, mate.id, 'Mío')).length).toBe(0);
    session.user = { ...u, role: 'owner', team: null };
    const res = await dashboardRoute.GET(json('http://x', 'GET'), params(pub.id));
    expect(res.status).toBe(200);
    session.user = null;
  });
});
