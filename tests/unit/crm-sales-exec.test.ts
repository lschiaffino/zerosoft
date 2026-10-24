import { describe, expect, it } from 'vitest';
import { getDb } from '@/lib/db';
import {
  createActivity,
  createContact,
  createCustomField,
  createDeal,
  createPipeline,
  createStage,
  getContact,
  listContacts,
  listTimeline,
  moveDeal,
  updateContact,
} from '@/lib/crm';
import { countQueueTasks, listQueueTasks, snoozeUntil } from '@/lib/crm-work-queue';
import { createPlaybook, listPlaybooks, runPlaybook } from '@/lib/crm-playbooks';
import { answersText, isPropertyTarget, propertyPatch, type PlaybookQuestion } from '@/lib/crm-playbooks-schema';
import { renderPlaybookMarkdown } from '@/lib/crm-playbook-markdown';
import { createScore, createScoreRule, deleteScore, listScores, recalcContactScore, updateScore } from '@/lib/crm-scoring';
import { decayedPoints, evaluateScore, parseTierFilter, scoreTier, tierRanges, type ScoreRule } from '@/lib/crm-scoring-schema';
import { createWorkflow } from '@/lib/crm-workflows';
import { addLineItem } from '@/lib/crm-products';
import {
  checkApproval,
  createApprovalRule,
  decideApproval,
  listApprovals,
  requestApproval,
  ruleApplies,
} from '@/lib/crm-approvals';
import { getSplits, setSplits, splitAmounts, validateSplits } from '@/lib/crm-splits';
import { reportForecast, reportOwnerPerformance, reportRange } from '@/lib/crm-reports';
import { quotaActual } from '@/lib/crm-quotas';
import { addMember, createTeam } from '@/lib/teams';
import { MIGRATIONS } from '@/lib/schema/migrations';
import { makeUser } from './helpers';

const now = () => new Date().toISOString().slice(0, 19).replace('T', ' ');

async function pipeline(userId: string) {
  const p = await createPipeline(userId, 'Sales');
  const a = (await createStage(userId, p.id, { name: 'Qualified' }))!;
  const b = (await createStage(userId, p.id, { name: 'Contract' }))!;
  const won = (await createStage(userId, p.id, { name: 'Won' }))!;
  await getDb().prepare('UPDATE crm_stages SET is_won = 1, probability = 100 WHERE id = ?').run(won.id);
  await getDb().prepare('UPDATE crm_stages SET probability = 50 WHERE id = ?').run(b.id);
  return { pipelineId: p.id, a: a.id, b: b.id, won: won.id };
}

describe('migración 073', () => {
  it('está al final de la lista con su id reservado', () => {
    expect(MIGRATIONS.some((m) => m.id === '073_crm_sales_exec')).toBe(true);
    expect(new Set(MIGRATIONS.map((m) => m.id)).size).toBe(MIGRATIONS.length);
  });
});

describe('cola de trabajo', () => {
  it('trae vencidas y de hoy de la persona, con el contexto del registro y el paso de secuencia', async () => {
    const ws = await makeUser('queue');
    const c = await createContact(ws.id, { firstName: 'Ana', lastName: 'Paz', email: 'ana@q.io', phone: '+54 11 5555 0000', jobTitle: 'CTO' });
    const past = new Date(Date.now() - 2 * 86_400_000).toISOString().slice(0, 19).replace('T', ' ');
    const later = new Date(Date.now() + 5 * 86_400_000).toISOString().slice(0, 19).replace('T', ' ');
    const overdue = await createActivity(ws.id, { type: 'task', subject: 'Call Ana', dueAt: past, contactId: c.id });
    const today = await createActivity(ws.id, { type: 'task', subject: 'Send deck', dueAt: now(), contactId: c.id });
    await createActivity(ws.id, { type: 'task', subject: 'Next week', dueAt: later, contactId: c.id });
    await createActivity(ws.id, { type: 'note', subject: 'Not a task', contactId: c.id });
    const seq = { id: crypto.randomUUID() };
    await getDb()
      .prepare("INSERT INTO crm_sequences (id, user_id, name, timezone) VALUES (?, ?, 'Outbound Q4', 'UTC')")
      .run(seq.id, ws.id);
    await getDb().prepare('UPDATE crm_activities SET sequence_id = ? WHERE id = ?').run(seq.id, today.id);

    const due = await listQueueTasks(ws.id, { ownerId: ws.id });
    expect(due.map((x) => x.id)).toEqual([overdue.id, today.id]);
    expect(due[0]).toMatchObject({ overdue: true, contact: { name: 'Ana Paz', job_title: 'CTO', phone: '+54 11 5555 0000' } });
    expect(due[1].sequence).toEqual({ id: seq.id, name: 'Outbound Q4' });
    expect((await listQueueTasks(ws.id, { scope: 'overdue' })).map((x) => x.id)).toEqual([overdue.id]);
    expect((await listQueueTasks(ws.id, { scope: 'today' })).map((x) => x.id)).toEqual([today.id]);
    expect(await countQueueTasks(ws.id, { ownerId: ws.id })).toBe(2);
    // De otra persona: no entra en mi cola.
    expect(await listQueueTasks(ws.id, { ownerId: 'someone-else' })).toEqual([]);
  });

  it('posponer: mañana y la semana que viene a las 9:00 locales', () => {
    const at = new Date('2026-10-24T15:30:00Z');
    expect(snoozeUntil('1h', 'UTC', at).toISOString()).toBe('2026-10-24T16:30:00.000Z');
    expect(snoozeUntil('tomorrow', 'UTC', at).toISOString()).toBe('2026-10-25T09:00:00.000Z');
    expect(snoozeUntil('next_week', 'America/Argentina/Buenos_Aires', at).toISOString()).toBe('2026-10-31T12:00:00.000Z');
  });
});

describe('playbooks', () => {
  const questions: PlaybookQuestion[] = [
    { id: 'role', label: 'What is your role?', type: 'text', options: [], property: 'contact:jobTitle' },
    { id: 'stage', label: 'Lifecycle', type: 'select', options: [], property: 'contact:lifecycleStage' },
    { id: 'budget', label: 'Budget', type: 'number', options: [], property: 'contact:custom.budget' },
    { id: 'pain', label: 'Main pain', type: 'longtext', options: [], property: '' },
  ];

  it('puro: destinos válidos, respuestas a propiedades y texto para el timeline', () => {
    expect(isPropertyTarget('contact:jobTitle')).toBe(true);
    expect(isPropertyTarget('deal:custom.budget')).toBe(true);
    expect(isPropertyTarget('deal:jobTitle')).toBe(false);
    expect(isPropertyTarget('contact:custom.bad name')).toBe(false);
    const patch = propertyPatch(questions, { role: 'CFO', stage: 'nope', budget: '5000', pain: 'Too many tools' }, 'contact');
    expect(patch).toEqual({ standard: { jobTitle: 'CFO' }, custom: { budget: '5000' } });
    expect(propertyPatch(questions, { role: 'CFO' }, 'deal')).toEqual({ standard: {}, custom: {} });
    expect(answersText(questions, { role: 'CFO', pain: 'Too many tools' })).toBe('What is your role?\nCFO\n\nMain pain\nToo many tools');
    const html = renderPlaybookMarkdown('## Open\n\n<script>x</script>\n\nSee [ok](https://a.io) and [no](javascript:alert(1))');
    expect(html).not.toMatch(/<script|href="javascript/);
    expect(html).toContain('<a href="https://a.io"');
  });

  it('usarlo en un contacto actualiza propiedades, deja la nota o la llamada en el timeline y suma el uso', async () => {
    const ws = await makeUser('pb');
    await createCustomField(ws.id, { entity: 'contacts', name: 'budget', label: 'Budget', type: 'number' });
    const pb = await createPlaybook(ws.id, { name: 'Discovery call', body: '## Hi', questions, entities: ['contact'] }, ws.id);
    const c = await createContact(ws.id, { email: 'lead@pb.io' });
    const run = await runPlaybook(ws.id, pb.id, { entity: 'contact', entityId: c.id, answers: { role: 'CFO', stage: 'sql', budget: '5000', pain: 'Too many tools' }, logAs: 'note' }, { id: ws.id, email: ws.email });
    expect(run.ok).toBe(true);
    const after = (await getContact(ws.id, c.id))!.contact;
    expect(after.job_title).toBe('CFO');
    expect(after.lifecycle_stage).toBe('sql');
    expect(JSON.parse(after.custom).budget).toBe(5000);
    const notes = await listTimeline(ws.id, { contactId: c.id, type: 'note' });
    expect(notes.find((n) => n.subject === 'Playbook: Discovery call')?.body).toContain('Too many tools');

    const call = await runPlaybook(
      ws.id,
      pb.id,
      { entity: 'contact', entityId: c.id, answers: { pain: 'Price' }, logAs: 'call', call: { outcome: 'connected', durationMin: 12 } },
      { id: ws.id, email: ws.email },
    );
    expect(call.ok).toBe(true);
    const calls = await listTimeline(ws.id, { contactId: c.id, type: 'call' });
    expect(calls[0]).toMatchObject({ subject: 'Playbook: Discovery call', outcome: 'connected', duration_min: 12 });

    // Un playbook solo de contactos no corre en un deal.
    const wrong = await runPlaybook(ws.id, pb.id, { entity: 'deal', entityId: 'x', answers: {}, logAs: 'note' }, { id: ws.id, email: ws.email });
    expect(wrong).toEqual({ ok: false, reason: 'wrong_entity' });
    // Otro workspace no lo ve.
    const other = await makeUser('pb2');
    expect(await runPlaybook(other.id, pb.id, { entity: 'contact', entityId: c.id, answers: {}, logAs: 'note' }, { id: other.id, email: other.email })).toEqual({
      ok: false,
      reason: 'not_found',
    });
    const [listed] = await listPlaybooks(ws.id, { entity: 'contact' });
    expect(listed).toMatchObject({ name: 'Discovery call', uses: 2 });
    expect(await listPlaybooks(ws.id, { entity: 'deal' })).toEqual([]);
  });
});

describe('lead scoring: varios scores, umbrales y decaimiento', () => {
  it('puro: tramos, filtro por tramo y decaimiento de actividad vieja', () => {
    const th = [
      { label: 'Hot', min: 60 },
      { label: 'Cold', min: 0 },
      { label: 'Warm', min: 30 },
    ];
    expect(scoreTier(45, th)).toBe('Warm');
    expect(scoreTier(-5, th)).toBeNull();
    expect(tierRanges(th)).toEqual([
      { label: 'Cold', min: 0, max: 30 },
      { label: 'Warm', min: 30, max: 60 },
      { label: 'Hot', min: 60, max: null },
    ]);
    expect(parseTierFilter('30|60')).toEqual({ min: 30, max: 60 });
    expect(parseTierFilter('60|')).toEqual({ min: 60, max: null });
    expect(parseTierFilter('x')).toBeNull();
    expect(decayedPoints(20, 50)).toBe(10);
    const rules: ScoreRule[] = [{ id: 'r', name: 'Opens', kind: 'activity', config: { activity: 'email_opened', days: 90, min: 1 }, points: 20, enabled: true, position: 0 }];
    expect(evaluateScore(rules, {}, { 'email_opened:90': 2 }, { pct: 50, recent: { 'email_opened:90': 0 } })).toMatchObject({
      score: 10,
      breakdown: [{ decayed: true }],
    });
    expect(evaluateScore(rules, {}, { 'email_opened:90': 2 }, { pct: 50, recent: { 'email_opened:90': 1 } }).score).toBe(20);
  });

  it('un segundo score con sus reglas, filtros por puntos y tramo, workflow por score y borrado', async () => {
    const ws = await makeUser('scores');
    const primary = (await listScores(ws.id)).find((s) => s.isPrimary)!;
    await updateScore(ws.id, primary.id, { thresholds: [{ label: 'Cold', min: 0 }, { label: 'Hot', min: 20 }] });
    await createScoreRule(ws.id, { kind: 'property', name: 'MQL', config: { field: 'lifecycleStage', op: 'equals', value: 'mql' }, points: 20 });
    const created = await createScore(ws.id, { name: 'Engagement', decayDays: 30, decayPct: 50 });
    if (!created.ok) throw new Error('score');
    const eng = created.score;
    await createScoreRule(ws.id, { kind: 'activity', scoreId: eng.id, name: 'Calls', config: { activity: 'call_logged', days: 90, min: 1 }, points: 40 });
    await createWorkflow(ws.id, {
      name: 'Engaged',
      enabled: true,
      triggers: [{ type: 'score_changed', config: { scoreId: eng.id, threshold: 30, direction: 'up' } }],
      actions: [{ type: 'create_task', config: { subject: 'Engaged lead', dueInDays: 0 } }],
    });

    const c = await createContact(ws.id, { email: 'two@scores.io', lifecycleStage: 'mql' });
    expect((await getContact(ws.id, c.id))!.contact.score).toBe(20);
    await createActivity(ws.id, { type: 'call', subject: 'Intro', contactId: c.id });
    const r = await recalcContactScore(ws.id, c.id);
    expect(r?.score).toBe(20);
    expect(r?.others).toEqual([{ scoreId: eng.id, oldScore: 40, score: 40, changed: false }]);
    const tasks = (await listTimeline(ws.id, { contactId: c.id, type: 'task' })).filter((x) => x.subject === 'Engaged lead');
    expect(tasks).toHaveLength(1);

    // 40 días después la llamada es vieja para el decaimiento (30 días): vale la mitad.
    const later = await recalcContactScore(ws.id, c.id, { now: new Date(Date.now() + 40 * 86_400_000) });
    expect(later?.others[0]).toMatchObject({ score: 20, changed: true });

    // Filtros: por puntos del segundo score y por tramo del principal.
    const byEng = await listContacts(ws.id, { filters: [{ f: `score:${eng.id}`, o: 'gt', v: '10' }] });
    expect(byEng.rows.map((x) => x.id)).toEqual([c.id]);
    const hot = await listContacts(ws.id, { filters: [{ f: `scoreTier:${primary.id}`, o: 'is', v: '20|' }] });
    expect(hot.rows.map((x) => x.id)).toEqual([c.id]);
    const cold = await listContacts(ws.id, { filters: [{ f: `scoreTier:${primary.id}`, o: 'is', v: '0|20' }] });
    expect(cold.rows).toEqual([]);
    await updateContact(ws.id, c.id, { lifecycleStage: 'lead' });
    expect((await listContacts(ws.id, { filters: [{ f: `scoreTier:${primary.id}`, o: 'is', v: '0|20' }] })).rows.map((x) => x.id)).toEqual([c.id]);

    expect(await deleteScore(ws.id, primary.id)).toBe(false);
    expect(await deleteScore(ws.id, eng.id)).toBe(true);
    expect((await listScores(ws.id)).map((s) => s.name)).toEqual(['Lead score']);
  });
});

describe('aprobaciones de pipeline', () => {
  it('la etapa pide aprobación desde un monto; el pedido avisa, se aprueba y el deal se mueve una vez', async () => {
    const owner = await makeUser('appr-owner');
    const rep = await makeUser('appr-rep');
    const team = await createTeam(owner.id, 'Sales');
    await addMember(team.id, rep.id, 'member');
    const p = await pipeline(owner.id);
    expect((await createApprovalRule(owner.id, { pipelineId: p.pipelineId, stageId: p.b, minAmount: 1000, approverIds: [owner.id] })).ok).toBe(true);
    expect(ruleApplies({ minAmount: 1000, minDiscount: null, enabled: true }, { amountBase: 999, discountPct: 0 })).toBe(false);

    const small = await createDeal(owner.id, { name: 'Small', pipelineId: p.pipelineId, stageId: p.a, amount: 500 });
    const big = await createDeal(owner.id, { name: 'Big', pipelineId: p.pipelineId, stageId: p.a, amount: 5000 });
    if (!small.ok || !big.ok) throw new Error('deal');
    expect((await moveDeal(owner.id, small.deal.id, p.b, null, undefined, '', { actorId: rep.id })).ok).toBe(true);

    const blocked = await moveDeal(owner.id, big.deal.id, p.b, null, undefined, '', { actorId: rep.id });
    expect(blocked).toEqual({ ok: false, reason: 'approval_required', approverIds: [owner.id], pendingId: null });
    // Sin persona (automatización) tampoco pasa; quien aprueba, sí.
    expect((await moveDeal(owner.id, big.deal.id, p.b)).ok).toBe(false);
    expect((await checkApproval(owner.id, big.deal, p.b, owner.id)).needed).toBe(false);

    const req = await requestApproval(owner.id, big.deal.id, p.b, { id: rep.id, name: 'Rep' }, 'Big logo');
    if (!req.ok) throw new Error('request');
    const again = await requestApproval(owner.id, big.deal.id, p.b, { id: rep.id, name: 'Rep' });
    expect(again).toMatchObject({ ok: true, created: false });
    const notif = (await getDb().prepare("SELECT title FROM notifications WHERE user_id = ? AND type = 'crm_approval'").all(owner.id)) as Array<{ title: string }>;
    expect(notif[0].title).toContain('Big');
    expect((await moveDeal(owner.id, big.deal.id, p.b, null, undefined, '', { actorId: rep.id })).ok).toBe(false);

    // El rep no puede decidir; quien aprueba, sí, y el deal pasa solo.
    expect(await decideApproval(owner.id, req.approval.id, { id: rep.id, name: 'Rep', email: rep.email }, 'approve')).toEqual({ ok: false, reason: 'forbidden' });
    const decided = await decideApproval(owner.id, req.approval.id, { id: owner.id, name: 'Boss', email: owner.email }, 'approve', 'Go');
    expect(decided).toMatchObject({ ok: true, moved: true });
    const stage = (await getDb().prepare('SELECT stage_id FROM crm_deals WHERE id = ?').get(big.deal.id)) as { stage_id: string };
    expect(stage.stage_id).toBe(p.b);
    const [row] = await listApprovals(owner.id, { dealId: big.deal.id });
    expect(row).toMatchObject({ status: 'approved', decision_note: 'Go' });
    expect(row.consumed_at).not.toBeNull();
    // La aprobación sirve para un solo movimiento: volver y entrar de nuevo pide otra.
    await moveDeal(owner.id, big.deal.id, p.a, null, undefined, '', { actorId: rep.id });
    expect((await moveDeal(owner.id, big.deal.id, p.b, null, undefined, '', { actorId: rep.id })).ok).toBe(false);

    // Rechazo: avisa a quien pidió y el deal no se mueve.
    const second = await requestApproval(owner.id, big.deal.id, p.b, { id: rep.id, name: 'Rep' });
    if (!second.ok) throw new Error('request');
    expect(await decideApproval(owner.id, second.approval.id, { id: owner.id, name: 'Boss', email: owner.email }, 'reject', 'No')).toMatchObject({ ok: true, moved: false });
    const repNotifs = (await getDb().prepare("SELECT title FROM notifications WHERE user_id = ? AND type = 'crm_approval'").all(rep.id)) as Array<{ title: string }>;
    expect(repNotifs.some((n) => n.title.includes('rejected'))).toBe(true);
  });

  it('por descuento de los productos del deal', async () => {
    const ws = await makeUser('appr-disc');
    const p = await pipeline(ws.id);
    const other = await makeUser('appr-disc-2');
    await createApprovalRule(ws.id, { pipelineId: p.pipelineId, stageId: p.won, minDiscount: 20, approverIds: [other.id] }).then((r) => expect(r).toEqual({ ok: false, reason: 'invalid_approver' }));
    const team = await createTeam(ws.id, 'T');
    await addMember(team.id, other.id, 'member');
    expect((await createApprovalRule(ws.id, { pipelineId: p.pipelineId, stageId: p.won, minDiscount: 20, approverIds: [other.id] })).ok).toBe(true);
    const d = await createDeal(ws.id, { name: 'Disc', pipelineId: p.pipelineId, stageId: p.a, amount: 100 });
    if (!d.ok) throw new Error('deal');
    await addLineItem(ws.id, d.deal.id, { name: 'Seat', quantity: 1, unitPrice: 100, discountPct: 10 });
    expect((await checkApproval(ws.id, d.deal, p.won, ws.id)).needed).toBe(false);
    await addLineItem(ws.id, d.deal.id, { name: 'Seat 2', quantity: 1, unitPrice: 100, discountPct: 50 });
    expect((await checkApproval(ws.id, d.deal, p.won, ws.id)).needed).toBe(true);
    // El import y los presupuestos aceptados no lo exigen.
    expect((await moveDeal(ws.id, d.deal.id, p.won, null, undefined, '', { enforceRequired: false })).ok).toBe(true);
  });
});

describe('splits de deals', () => {
  it('puro: validación y montos', () => {
    expect(validateSplits([{ ownerId: 'a', percent: 60 }, { ownerId: 'b', percent: 40 }])).toMatchObject({ ok: true });
    expect(validateSplits([{ ownerId: 'a', percent: 60 }, { ownerId: 'b', percent: 30 }])).toEqual({ ok: false, reason: 'sum_not_100' });
    expect(validateSplits([{ ownerId: 'a', percent: 50 }, { ownerId: 'a', percent: 50 }])).toEqual({ ok: false, reason: 'duplicate_owner' });
    expect(validateSplits([{ ownerId: 'a', percent: 0 }, { ownerId: 'b', percent: 100 }])).toEqual({ ok: false, reason: 'invalid_percent' });
    expect(validateSplits([])).toEqual({ ok: true, splits: [] });
    expect(splitAmounts(1000, 'a', [])).toEqual([{ ownerId: 'a', percent: 100, amount: 1000 }]);
    expect(splitAmounts(1000, 'a', [{ ownerId: 'a', percent: 70 }, { ownerId: 'b', percent: 30 }]).map((x) => x.amount)).toEqual([700, 300]);
  });

  it('reparten lo ganado en los reportes por persona, las cuotas y el forecast por owner', async () => {
    const owner = await makeUser('split-owner');
    const rep = await makeUser('split-rep');
    const team = await createTeam(owner.id, 'Sales');
    await addMember(team.id, rep.id, 'member');
    const p = await pipeline(owner.id);
    const won = await createDeal(owner.id, { name: 'Won', pipelineId: p.pipelineId, stageId: p.a, amount: 1000, ownerId: owner.id });
    const open = await createDeal(owner.id, { name: 'Open', pipelineId: p.pipelineId, stageId: p.b, amount: 400, ownerId: owner.id });
    if (!won.ok || !open.ok) throw new Error('deal');
    expect((await setSplits(owner.id, won.deal.id, [{ ownerId: owner.id, percent: 70 }, { ownerId: 'stranger', percent: 30 }])).ok).toBe(false);
    expect((await setSplits(owner.id, won.deal.id, [{ ownerId: owner.id, percent: 70 }, { ownerId: rep.id, percent: 30 }])).ok).toBe(true);
    await setSplits(owner.id, open.deal.id, [{ ownerId: owner.id, percent: 50 }, { ownerId: rep.id, percent: 50 }]);
    expect(await getSplits(owner.id, won.deal.id)).toEqual([
      { ownerId: owner.id, percent: 70 },
      { ownerId: rep.id, percent: 30 },
    ]);
    await moveDeal(owner.id, won.deal.id, p.won);

    const range = reportRange('30d');
    const perf = await reportOwnerPerformance(owner.id, range, {}, [
      { id: owner.id, email: owner.email, name: 'Owner' },
      { id: rep.id, email: rep.email, name: 'Rep' },
    ]);
    expect(perf.find((x) => x.id === owner.id)).toMatchObject({ wonDeals: 1, wonAmount: 700 });
    expect(perf.find((x) => x.id === rep.id)).toMatchObject({ wonDeals: 1, wonAmount: 300 });

    const start = new Date(Date.now() - 86_400_000).toISOString().slice(0, 19).replace('T', ' ');
    const end = new Date(Date.now() + 86_400_000).toISOString().slice(0, 19).replace('T', ' ');
    expect(await quotaActual(owner.id, rep.id, 'won_value', { start, end })).toBe(300);
    expect(await quotaActual(owner.id, rep.id, 'won_count', { start, end })).toBe(1);

    const forecast = await reportForecast(owner.id, p.pipelineId, [rep.id]);
    expect(forecast.find((s) => s.id === p.b)).toMatchObject({ count: 1, amount: 200, forecast: 100 });
    const all = await reportForecast(owner.id, p.pipelineId);
    expect(all.find((s) => s.id === p.b)).toMatchObject({ amount: 400 });

    // Historial del deal con nombres.
    const ev = (await getDb().prepare("SELECT new_value FROM crm_property_events WHERE entity_id = ? AND field = 'splits'").all(won.deal.id)) as Array<{ new_value: string }>;
    expect(ev).toHaveLength(1);
    // Vacío = vuelve al 100% del owner.
    expect(await setSplits(owner.id, won.deal.id, [])).toEqual({ ok: true, splits: [] });
    expect(await getSplits(owner.id, won.deal.id)).toEqual([]);
  });
});
