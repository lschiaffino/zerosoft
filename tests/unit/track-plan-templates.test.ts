import { describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';
import { getDb } from '@/lib/db';
import { createIssue, createProject, listStatuses } from '@/lib/track-data';
import { createPlan, createPlanMilestone, getPlan, listPlanMilestones } from '@/lib/track-plans';
import { setProjectVisibility } from '@/lib/track-access';
import { addDays, applyTemplateToPlan, captureTemplateData, createPlanTemplateFromPlan, dayOffset, listPlanTemplates, parseTemplateData, topoSort } from '@/lib/track-plan-templates';
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

const plansRoute = await import('@/app/api/track/plans/route');
const templatesRoute = await import('@/app/api/track/plan-templates/route');
const templateRoute = await import('@/lib/routes/track/plan-templates/[id]/route');

const json = (method: string, body?: unknown) =>
  new NextRequest('http://x', { method, headers: { 'content-type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body) }) as never;
const params = (id: string) => ({ params: Promise.resolve({ id }) });

async function setup() {
  const u = await makeUser('tpl');
  const scope = { teamId: null, ownerId: u.id };
  const team = await createProject(u.id, null, { name: `Web ${crypto.randomUUID().slice(0, 6)}` });
  const statuses = await listStatuses(team.id);
  const st = (cat: string) => statuses.find((s) => s.category === cat)!;
  return { u, scope, team, st };
}

describe('templates de projects: cálculos', () => {
  it('días entre fechas y fecha + días', () => {
    expect(dayOffset('2026-11-01', '2026-11-15')).toBe(14);
    expect(dayOffset('2026-11-15', '2026-11-01')).toBe(-14);
    expect(addDays('2026-12-25', 10)).toBe('2027-01-04');
    expect(addDays('2026-03-01', -1)).toBe('2026-02-28');
  });

  it('padres antes que hijos a cualquier profundidad, sin repetir', () => {
    const rows = [
      { id: 'c', parent_id: 'b' },
      { id: 'a', parent_id: null },
      { id: 'b', parent_id: 'a' },
      { id: 'd', parent_id: null },
    ];
    expect(topoSort(rows).map((r) => r.id)).toEqual(['a', 'b', 'c', 'd']);
    // Un ciclo no cuelga ni duplica.
    expect(topoSort([{ id: 'x', parent_id: 'y' }, { id: 'y', parent_id: 'x' }]).map((r) => r.id).sort()).toEqual(['x', 'y']);
  });

  it('un template roto se lee vacío', () => {
    expect(parseTemplateData('not json')).toMatchObject({ milestones: [], issues: [], teamIds: [] });
  });
});

describe('templates de projects: guardar y aplicar', () => {
  it('guarda milestones con su distancia al inicio y los issues abiertos con milestone, padre y labels', async () => {
    const { u, scope, team, st } = await setup();
    const res = await createPlan(scope, u.id, { name: 'Launch', status: 'in_progress', priority: 'high', summary: 'Ship it', description: '## Goal', teamIds: [team.id], startDate: '2026-11-01' });
    if (!res.ok) throw new Error('plan');
    const plan = res.plan;
    const beta = await createPlanMilestone(plan.id, u.id, { name: 'Beta', targetDate: '2026-11-15' });
    await createPlanMilestone(plan.id, u.id, { name: 'GA' });
    const parent = await createIssue(team.id, u.id, { title: 'Landing page', priority: 'high', planId: plan.id, planMilestoneId: beta, labels: [{ name: 'Marketing', color: '#ff0000' }] }, { source: 'app' });
    await createIssue(team.id, u.id, { title: 'Hero copy', parentId: parent.id, planId: plan.id, estimate: 3 }, { source: 'app' });
    await createIssue(team.id, u.id, { title: 'Dropped idea', planId: plan.id, statusId: st('cancelled').id }, { source: 'app' });

    const data = await captureTemplateData((await getPlan(plan.id))!, u.id);
    expect(data).toMatchObject({ summary: 'Ship it', description: '## Goal', priority: 'high', teamIds: [team.id] });
    expect(data.milestones).toEqual([
      { name: 'Beta', description: '', offsetDays: 14 },
      { name: 'GA', description: '', offsetDays: null },
    ]);
    expect(data.issues.map((i) => i.title)).toEqual(['Landing page', 'Hero copy']);
    expect(data.issues[0]).toMatchObject({ milestone: 0, parent: null, priority: 'high' });
    expect(data.issues[0].labels.map((l) => l.name)).toEqual(['Marketing']);
    expect(data.issues[1]).toMatchObject({ parent: 0, estimate: 3 });

    // Aplicar a un project que empieza el 1 de diciembre: Beta cae el 15.
    const next = await createPlan(scope, u.id, { name: 'Launch 2', teamIds: [team.id], startDate: '2026-12-01' });
    if (!next.ok) throw new Error('plan2');
    expect(await applyTemplateToPlan(next.plan.id, data, u.id)).toEqual({ milestones: 2, issues: 2, skippedIssues: 0 });
    const ms = await listPlanMilestones(next.plan.id);
    expect(ms.map((m) => [m.name, m.target_date])).toEqual([
      ['Beta', '2026-12-15'],
      ['GA', null],
    ]);
    const issues = (await getDb()
      .prepare('SELECT id, title, parent_id, plan_milestone_id, priority, labels FROM track_issues WHERE plan_id = ? ORDER BY created_at')
      .all(next.plan.id)) as Array<{ id: string; title: string; parent_id: string | null; plan_milestone_id: string | null; priority: string; labels: string }>;
    expect(issues.map((i) => i.title)).toEqual(['Landing page', 'Hero copy']);
    expect(issues[0].plan_milestone_id).toBe(ms[0].id);
    expect(issues[1].parent_id).toBe(issues[0].id);
    expect(JSON.parse(issues[0].labels).map((l: { name: string }) => l.name)).toEqual(['Marketing']);
  });

  it('nunca guarda issues de un team privado que quien guarda no ve, ni los crea ahí', async () => {
    const owner = await makeUser('tpl-own');
    const member = await makeUser('tpl-mem');
    const scope = { teamId: null, ownerId: owner.id };
    const open = await createProject(owner.id, null, { name: `Open ${crypto.randomUUID().slice(0, 6)}` });
    const secret = await createProject(owner.id, null, { name: `Secret ${crypto.randomUUID().slice(0, 6)}` });
    await setProjectVisibility(secret.id, 'private', owner.id);
    const res = await createPlan(scope, owner.id, { name: 'Mixed', teamIds: [open.id, secret.id] });
    if (!res.ok) throw new Error('plan');
    await createIssue(open.id, owner.id, { title: 'Public task', planId: res.plan.id }, { source: 'app' });
    await createIssue(secret.id, owner.id, { title: 'Secret task', planId: res.plan.id }, { source: 'app' });

    const asMember = await captureTemplateData(res.plan, member.id);
    expect(asMember.issues.map((i) => i.title)).toEqual(['Public task']);
    expect(asMember.teamIds).toEqual([open.id]);
    const asOwner = await captureTemplateData(res.plan, owner.id);
    expect(asOwner.issues.map((i) => i.title).sort()).toEqual(['Public task', 'Secret task']);
  });

  it('sin team, crea los milestones y avisa cuántos issues quedaron afuera', async () => {
    const { u, scope } = await setup();
    const res = await createPlan(scope, u.id, { name: 'No team' });
    if (!res.ok) throw new Error('plan');
    const data = { ...parseTemplateData('{}'), milestones: [{ name: 'M1', description: '', offsetDays: 3 }], issues: [{ title: 'x', description: '', priority: 'none', estimate: null, labels: [], milestone: 0, parent: null }] };
    expect(await applyTemplateToPlan(res.plan.id, data, u.id)).toEqual({ milestones: 1, issues: 0, skippedIssues: 1 });
    // Sin fecha de inicio, el milestone queda sin fecha.
    expect((await listPlanMilestones(res.plan.id))[0].target_date).toBeNull();
  });
});

describe('templates de projects: API', () => {
  it('guardar, crear un project desde el template, renombrar y borrar con permisos', async () => {
    const { u, scope, team } = await setup();
    const other = await makeUser('tpl-other');
    const stranger = await makeUser('tpl-stranger');
    const res = await createPlan(scope, u.id, { name: 'Onboarding', priority: 'medium', description: 'Welcome a customer', teamIds: [team.id], startDate: '2026-11-01' });
    if (!res.ok) throw new Error('plan');
    const kickoff = await createPlanMilestone(res.plan.id, u.id, { name: 'Kickoff', targetDate: '2026-11-03' });
    await createIssue(team.id, u.id, { title: 'Send welcome email', planId: res.plan.id, planMilestoneId: kickoff }, { source: 'app' });

    session.user = { id: u.id, team: null, role: 'owner' };
    const saved = await templatesRoute.POST(json('POST', { planId: res.plan.id, name: 'Customer onboarding' }));
    expect(saved.status).toBe(201);
    const tpl = (await saved.json()) as { id: string; milestones: number; issues: number; teams: number };
    expect(tpl).toMatchObject({ milestones: 1, issues: 1, teams: 1 });
    expect((await templatesRoute.POST(json('POST', { planId: 'nope', name: 'x' }))).status).toBe(404);

    // Proyecto nuevo desde el template: hereda prioridad, descripción y team; crea milestone e issue.
    const created = await plansRoute.POST(json('POST', { name: 'Acme onboarding', templateId: tpl.id, startDate: '2026-12-01' }));
    expect(created.status).toBe(201);
    const plan = (await created.json()) as { id: string; priority: string; description: string; template: { milestones: number; issues: number } };
    expect(plan).toMatchObject({ priority: 'medium', description: 'Welcome a customer', template: { milestones: 1, issues: 1 } });
    expect((await listPlanMilestones(plan.id)).map((m) => m.target_date)).toEqual(['2026-12-03']);
    // Lo que el formulario eligió gana sobre el template.
    const chosen = (await (await plansRoute.POST(json('POST', { name: 'Urgent onboarding', templateId: tpl.id, priority: 'urgent' }))).json()) as { priority: string };
    expect(chosen.priority).toBe('urgent');

    // Otro workspace no ve ni usa el template.
    session.user = { id: stranger.id, team: null, role: 'owner' };
    expect(((await (await templatesRoute.GET()).json()) as { rows: unknown[] }).rows).toEqual([]);
    expect((await plansRoute.POST(json('POST', { name: 'Steal', templateId: tpl.id }))).status).toBe(404);
    expect((await templateRoute.GET(json('GET'), params(tpl.id))).status).toBe(404);

    // Un miembro que no lo creó no lo renombra ni lo borra; un admin sí.
    session.user = { id: u.id, team: null, role: 'member', actingUser: { id: other.id } };
    expect((await templateRoute.PATCH(json('PATCH', { name: 'Mine' }), params(tpl.id))).status).toBe(403);
    expect((await templateRoute.DELETE(json('DELETE'), params(tpl.id))).status).toBe(403);
    session.user = { id: u.id, team: null, role: 'owner' };
    const renamed = await templateRoute.PATCH(json('PATCH', { name: 'Onboarding v2' }), params(tpl.id));
    expect(((await renamed.json()) as { name: string }).name).toBe('Onboarding v2');
    session.user = { id: u.id, team: null, role: 'admin', actingUser: { id: other.id } };
    expect((await templateRoute.DELETE(json('DELETE'), params(tpl.id))).status).toBe(200);
    expect(await listPlanTemplates(scope)).toEqual([]);
  });
});
