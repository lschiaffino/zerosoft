import { describe, expect, it } from 'vitest';
import { getDb } from '@/lib/db';
import { createIssue, createProject, getIssue, listStatuses, updateIssue } from '@/lib/track-data';
import { createPlan, createPlanMilestone, getPlanSummary, updatePlan } from '@/lib/track-plans';
import { createPlanUpdate, createUpdateComment, getPlanUpdate, listPlanUpdates, listUpdateReactions, togglePlanUpdateReaction } from '@/lib/track-plan-updates';
import { loadPlanProgressSeries } from '@/lib/track-plan-metrics';
import { makeUser } from './helpers';

async function setup() {
  const u = await makeUser('pp');
  const scope = { teamId: null, ownerId: u.id };
  const team = await createProject(u.id, null, { name: `PP ${crypto.randomUUID().slice(0, 6)}` });
  const statuses = await listStatuses(team.id);
  const st = (cat: string) => statuses.find((s) => s.category === cat)!;
  const res = await createPlan(scope, u.id, { name: 'Página', status: 'in_progress', teamIds: [team.id] });
  if (!res.ok) throw new Error('plan');
  return { u, scope, team, st, plan: res.plan };
}

describe('página de project', () => {
  it('el alta desde un grupo de milestone guarda el milestone (solo si es de ese project)', async () => {
    const { u, team, plan } = await setup();
    const ms = { id: await createPlanMilestone(plan.id, u.id, { name: 'Beta' }) };
    const a = await createIssue(team.id, u.id, { title: 'en beta', planId: plan.id, planMilestoneId: ms.id }, { source: 'app' });
    expect((await getIssue(a.id))?.plan_milestone_id).toBe(ms.id);
    const other = await setup();
    const b = await createIssue(team.id, u.id, { title: 'otro', planId: other.plan.id, planMilestoneId: ms.id }, { source: 'app' });
    expect((await getIssue(b.id))?.plan_milestone_id ?? null).toBeNull();
  });

  it('resources: los links se guardan en el project', async () => {
    const { u, scope, plan } = await setup();
    const res = await updatePlan(plan, scope, u.id, { links: [{ url: 'https://figma.com/x', title: 'Diseño' }] });
    expect(res.ok).toBe(true);
    const sum = await getPlanSummary(plan.id, scope);
    expect(JSON.parse(sum!.links ?? '[]')).toEqual([{ url: 'https://figma.com/x', title: 'Diseño' }]);
  });

  it('reacciones en un update y en sus comentarios: poner y sacar', async () => {
    const { u, plan } = await setup();
    const up = await createPlanUpdate(plan, u.id, { health: 'at_risk', body: 'falta diseño' });
    const full = (await getPlanUpdate(up.id))!;
    const c = await createUpdateComment(full, u.id, 'ok');
    expect(await togglePlanUpdateReaction(up.id, up.id, u.id, '👍')).toBe(true);
    expect(await togglePlanUpdateReaction(up.id, c.id, u.id, '🎉')).toBe(true);
    expect(await togglePlanUpdateReaction(up.id, 'no-es-de-este-update', u.id, '🎉')).toBeNull();
    expect((await listUpdateReactions(up.id)).map((r) => [r.target_id === up.id ? 'update' : 'comment', r.emoji])).toEqual([
      ['update', '👍'],
      ['comment', '🎉'],
    ]);
    expect((await listPlanUpdates(plan.id))[0].reactions).toHaveLength(2);
    expect(await togglePlanUpdateReaction(up.id, up.id, u.id, '👍')).toBe(false);
    expect(await listUpdateReactions(up.id)).toHaveLength(1);
  });

  it('gráfico de progreso: alcance y terminados desde la actividad', async () => {
    const { u, team, st, plan } = await setup();
    const a = await createIssue(team.id, u.id, { title: 'a', planId: plan.id, statusId: st('todo').id }, { source: 'app' });
    await createIssue(team.id, u.id, { title: 'b', planId: plan.id, statusId: st('todo').id }, { source: 'app' });
    await updateIssue(a.id, { statusId: st('done').id }, u.id);
    const today = new Date().toISOString().slice(0, 10);
    const s = await loadPlanProgressSeries((await getDb().prepare('SELECT * FROM track_plans WHERE id = ?').get(plan.id)) as typeof plan, today);
    const last = s.points[s.points.length - 1];
    expect(last).toMatchObject({ day: today, scope: 2, completed: 1 });
  });
});
