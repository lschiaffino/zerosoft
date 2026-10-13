import { describe, expect, it } from 'vitest';
import { getDb } from '@/lib/db';
import { createActivity, createDeal, createPipeline, createStage, updateStage } from '@/lib/crm';
import {
  funnelConversion,
  reportActivityLeaderboard,
  reportByOwner,
  reportFunnel,
  reportOwnerPerformance,
  reportRange,
} from '@/lib/crm-reports';
import { seedUserIfNeeded } from '@/lib/seed';
import { addMember, createTeam } from '@/lib/teams';
import { workflowCreateSchema } from '@/lib/crm-workflows-schema';
import { makeUser } from './helpers';

async function pipelineWithStages(userId: string) {
  const p = await createPipeline(userId, 'Sales');
  const lead = (await createStage(userId, p.id, { name: 'Lead' }))!;
  const demo = (await createStage(userId, p.id, { name: 'Demo' }))!;
  const won = (await createStage(userId, p.id, { name: 'Won' }))!;
  const lost = (await createStage(userId, p.id, { name: 'Lost' }))!;
  await updateStage(userId, won.id, { isWon: true });
  await updateStage(userId, lost.id, { isLost: true });
  return { p, lead, demo, won, lost };
}

describe('CRM reports: funnel', () => {
  it('la conversión acumulada nunca supera 100% (aunque Won tenga más deals que la etapa previa)', () => {
    const rows = [
      { id: 'a', count: 2, is_won: 0 as const, is_lost: 0 as const },
      { id: 'b', count: 1, is_won: 0 as const, is_lost: 0 as const },
      { id: 'w', count: 7, is_won: 1 as const, is_lost: 0 as const },
      { id: 'l', count: 5, is_won: 0 as const, is_lost: 1 as const },
    ];
    const out = funnelConversion(rows);
    // reached: a = 2+1+7 = 10, b = 1+7 = 8, won = 7.
    expect(out.map((r) => r.conversionRate)).toEqual([null, 80, 88, null]);
    for (const r of out) if (r.conversionRate !== null) expect(r.conversionRate).toBeLessThanOrEqual(100);
  });

  it('reportFunnel con deals reales: Won no muestra >100%', async () => {
    const u = await makeUser('funnel');
    const { p, lead, demo, won } = await pipelineWithStages(u.id);
    await createDeal(u.id, { pipelineId: p.id, stageId: lead.id, name: 'L1' });
    await createDeal(u.id, { pipelineId: p.id, stageId: demo.id, name: 'D1' });
    for (let i = 0; i < 4; i++) await createDeal(u.id, { pipelineId: p.id, stageId: won.id, name: `W${i}` });
    const funnel = await reportFunnel(u.id, p.id);
    const rates = funnel.map((s) => s.conversionRate).filter((r): r is number => r !== null);
    expect(rates.length).toBeGreaterThan(0);
    expect(Math.max(...rates)).toBeLessThanOrEqual(100);
    // Lead→Demo: 5 de 6 deals pasaron por Demo (1 en Demo + 4 ganados).
    expect(funnel.find((s) => s.id === demo.id)?.conversionRate).toBe(83);
  });
});

describe('CRM reports: por owner → actividades', () => {
  it('cuenta las actividades de cada owner (antes siempre 0)', async () => {
    const owner = await makeUser('ws');
    const member = await makeUser('member');
    const team = await createTeam(owner.id, 'Sales');
    await addMember(team.id, member.id, 'member');
    const call = await createActivity(owner.id, { type: 'call', subject: 'c1', ownerId: member.id });
    await getDb().prepare("UPDATE crm_activities SET done = 1, done_at = datetime('now') WHERE id = ?").run(call.id);
    await createActivity(owner.id, { type: 'note', subject: 'n1', ownerId: member.id });
    await createActivity(owner.id, { type: 'note', subject: 'n2' });
    const range = reportRange('30d');
    const owners = [
      { id: owner.id, email: owner.email, name: owner.name },
      { id: member.id, email: member.email, name: member.name },
    ];

    const byOwner = await reportByOwner(owner.id, range, {}, owners);
    expect(byOwner.find((o) => o.id === member.id)?.activities).toBe(2);
    expect(byOwner.find((o) => o.id === owner.id)?.activities).toBe(1);

    const perf = await reportOwnerPerformance(owner.id, range, {}, owners);
    expect(perf.find((o) => o.id === member.id)?.activities).toBe(1); // solo las completadas

    const board = await reportActivityLeaderboard(owner.id, range, owners);
    expect(board.find((o) => o.id === member.id)?.completed).toBe(1);
  });

  it('no mezcla actividades de otro workspace', async () => {
    const a = await makeUser('wsa');
    const b = await makeUser('wsb');
    await createActivity(b.id, { type: 'note', subject: 'ajena' });
    const rows = await reportByOwner(a.id, reportRange('30d'), {}, [{ id: b.id, email: b.email, name: b.name }]);
    expect(rows[0].activities).toBe(0);
  });
});

describe('seed idempotente', () => {
  it('seedUserIfNeeded no crea un "Sales" duplicado si el workspace ya tiene pipelines', async () => {
    const u = await makeUser('seeded');
    await createPipeline(u.id, 'Sales');
    await seedUserIfNeeded(u.id);
    const rows = (await getDb()
      .prepare("SELECT COUNT(*) AS c FROM crm_pipelines WHERE user_id = ? AND name = 'Sales'")
      .get(u.id)) as { c: number };
    expect(rows.c).toBe(1);
  });
});

describe('workflows: alta rápida', () => {
  it('acepta un borrador sin acciones solo si está deshabilitado', () => {
    const base = { name: 'Nuevo', triggers: [{ type: 'deal_created' as const }], actions: [] };
    expect(workflowCreateSchema.safeParse({ ...base, enabled: false }).success).toBe(true);
    expect(workflowCreateSchema.safeParse(base).success).toBe(false);
    expect(workflowCreateSchema.safeParse({ ...base, enabled: true }).success).toBe(false);
  });
});
