import { describe, expect, it } from 'vitest';
import { getClient, getDb } from '@/lib/db';
import { MIGRATIONS } from '@/lib/schema/migrations';
import {
  createCompany,
  createContact,
  createDeal,
  createPipeline,
  createStage,
  moveDeal,
  updateStage,
} from '@/lib/crm';
import { dealJourney, journeyMath, listStageHistory } from '@/lib/crm-stage-history';
import {
  applySplits,
  categoryFor,
  forecastMath,
  forecastPeriod,
  getForecast,
  setDealForecastCategory,
  submissionHistory,
  submitForecast,
  type ForecastDeal,
} from '@/lib/crm-forecast';
import { upsertQuota } from '@/lib/crm-quotas';
import {
  createCustomReport,
  deleteCustomReport,
  filterCondition,
  listCustomReports,
  runReport,
  searchCustomReports,
  updateCustomReport,
  ReportError,
} from '@/lib/crm-custom-reports';
import { configObjectsValid, defaultConfig, reportConfigSchema, toCsv } from '@/lib/crm-report-builder';
import { addWidget, createDashboard, getDashboard } from '@/lib/crm-dashboards';
import { addMember, createTeam } from '@/lib/teams';
import { makeUser } from './helpers';

async function pipelineWithStages(userId: string) {
  const p = await createPipeline(userId, 'Sales');
  const lead = (await createStage(userId, p.id, { name: 'Lead', probability: 10 }))!;
  const demo = (await createStage(userId, p.id, { name: 'Demo', probability: 50 }))!;
  const nego = (await createStage(userId, p.id, { name: 'Negotiation', probability: 80 }))!;
  const won = (await createStage(userId, p.id, { name: 'Won', probability: 100 }))!;
  const lost = (await createStage(userId, p.id, { name: 'Lost', probability: 0 }))!;
  await updateStage(userId, won.id, { isWon: true });
  await updateStage(userId, lost.id, { isLost: true });
  return { p, lead, demo, nego, won, lost };
}

const db = () => getDb();

describe('historial de etapas', () => {
  it('createDeal abre la primera etapa y moveDeal cierra la anterior', async () => {
    const u = await makeUser('hist');
    const { p, lead, demo, won } = await pipelineWithStages(u.id);
    const r = await createDeal(u.id, { pipelineId: p.id, stageId: lead.id, name: 'A' });
    if (!r.ok) throw new Error('create');
    await moveDeal(u.id, r.deal.id, demo.id);
    await moveDeal(u.id, r.deal.id, demo.id); // misma etapa: no agrega fila
    await moveDeal(u.id, r.deal.id, won.id);
    const h = await listStageHistory(u.id, r.deal.id);
    expect(h.map((e) => e.stage_id)).toEqual([lead.id, demo.id, won.id]);
    expect(h[0].exited_at).not.toBeNull();
    expect(h[1].exited_at).not.toBeNull();
    expect(h[2].exited_at).toBeNull();
  });
});

describe('migración 074: reconstruye el historial desde el audit trail', () => {
  it('usa los cambios de etapa (por nombre) y la fecha de creación', async () => {
    const u = await makeUser('bf');
    const { p, lead, demo, won } = await pipelineWithStages(u.id);
    const r = await createDeal(u.id, { pipelineId: p.id, stageId: lead.id, name: 'Viejo' });
    if (!r.ok) throw new Error('create');
    await moveDeal(u.id, r.deal.id, demo.id);
    await moveDeal(u.id, r.deal.id, won.id);
    // Como un deal de antes de la migración: sin historial, con su audit trail.
    await db().prepare('DELETE FROM crm_deal_stage_history WHERE deal_id = ?').run(r.deal.id);
    await db().prepare("UPDATE crm_deals SET created_at = '2026-01-01 10:00:00' WHERE id = ?").run(r.deal.id);
    await db().prepare("UPDATE crm_property_events SET created_at = '2026-01-03 10:00:00' WHERE entity_id = ? AND field = 'stage' AND new_value = 'Demo'").run(r.deal.id);
    await db().prepare("UPDATE crm_property_events SET created_at = '2026-01-08 10:00:00' WHERE entity_id = ? AND field = 'stage' AND new_value = 'Won'").run(r.deal.id);
    const m = MIGRATIONS.find((x) => x.id === '074_crm_reports')!;
    await m.up(getClient());
    await m.up(getClient()); // idempotente
    const h = await listStageHistory(u.id, r.deal.id);
    expect(h.map((e) => [e.stage_id, e.entered_at, e.exited_at])).toEqual([
      [lead.id, '2026-01-01 10:00:00', '2026-01-03 10:00:00'],
      [demo.id, '2026-01-03 10:00:00', '2026-01-08 10:00:00'],
      [won.id, '2026-01-08 10:00:00', null],
    ]);
  });
});

describe('recorrido de deals (journeyMath)', () => {
  const stages = [
    { id: 'l', name: 'Lead', is_won: 0, is_lost: 0 },
    { id: 'd', name: 'Demo', is_won: 0, is_lost: 0 },
    { id: 'w', name: 'Won', is_won: 1, is_lost: 0 },
    { id: 'x', name: 'Lost', is_won: 0, is_lost: 1 },
  ];
  const e = (stage_id: string, entered_at: string, exited_at: string | null = null) => ({ stage_id, entered_at, exited_at });
  const deals = [
    // Ganado: 2 días en Lead, 4 en Demo.
    { id: '1', stage_id: 'w', entries: [e('l', '2026-01-01 00:00:00', '2026-01-03 00:00:00'), e('d', '2026-01-03 00:00:00', '2026-01-07 00:00:00'), e('w', '2026-01-07 00:00:00')] },
    // Perdido en Demo.
    { id: '2', stage_id: 'x', entries: [e('l', '2026-01-01 00:00:00', '2026-01-05 00:00:00'), e('d', '2026-01-05 00:00:00', '2026-01-06 00:00:00'), e('x', '2026-01-06 00:00:00')] },
    // Perdido en Lead.
    { id: '3', stage_id: 'x', entries: [e('l', '2026-01-01 00:00:00', '2026-01-02 00:00:00'), e('x', '2026-01-02 00:00:00')] },
    // Abierto en Lead.
    { id: '4', stage_id: 'l', entries: [e('l', '2026-01-01 00:00:00')] },
    // Creado directo en Demo (en modo acumulado cuenta como que pasó por Lead).
    { id: '5', stage_id: 'd', entries: [e('d', '2026-01-01 00:00:00')] },
  ];

  it('acumulado: llegadas, conversión, caída y tiempo por etapa', () => {
    const r = journeyMath(stages, deals, 'cumulative');
    const [lead, demo, wonS] = r.stages;
    expect(r.stages.map((s) => s.id)).toEqual(['l', 'd', 'w']);
    expect(lead.reached).toBe(5);
    expect(demo.reached).toBe(3);
    expect(wonS.reached).toBe(1);
    expect(lead.nextRate).toBe(60);
    expect(demo.nextRate).toBe(33.3);
    expect(wonS.nextRate).toBeNull();
    expect(lead.lost).toBe(1);
    expect(demo.lost).toBe(1);
    expect(demo.lostRate).toBe(33.3);
    expect(lead.avgDays).toBe(2.3); // (2 + 4 + 1) / 3
    expect(demo.avgDays).toBe(2.5); // (4 + 1) / 2
    expect(lead.current).toBe(1);
    expect(demo.current).toBe(1);
    expect(r.total).toBe(5);
    expect(r.won).toBe(1);
    expect(r.lost).toBe(2);
    expect(r.open).toBe(2);
    expect(r.winRate).toBe(20);
    expect(r.avgDaysToWin).toBe(6);
  });

  it('estricto: solo cuenta las etapas en las que el deal entró', () => {
    const r = journeyMath(stages, deals, 'strict');
    expect(r.stages[0].reached).toBe(4);
    expect(r.stages[1].reached).toBe(3);
  });

  it('dealJourney usa el historial real y respeta el owner', async () => {
    const u = await makeUser('jr');
    const { p, lead, demo, won, lost } = await pipelineWithStages(u.id);
    const a = await createDeal(u.id, { pipelineId: p.id, stageId: lead.id, name: 'A' });
    const b = await createDeal(u.id, { pipelineId: p.id, stageId: lead.id, name: 'B' });
    if (!a.ok || !b.ok) throw new Error('create');
    await moveDeal(u.id, a.deal.id, demo.id);
    await moveDeal(u.id, a.deal.id, won.id);
    await moveDeal(u.id, b.deal.id, lost.id);
    const r = await dealJourney(u.id, { pipelineId: p.id, range: 'all' });
    expect(r.total).toBe(2);
    expect(r.stages.find((s) => s.id === lead.id)?.reached).toBe(2);
    expect(r.stages.find((s) => s.id === lead.id)?.lost).toBe(1);
    expect(r.stages.find((s) => s.id === won.id)?.reached).toBe(1);
    expect(r.biggestDropStageId).toBe(lead.id);
    const none = await dealJourney(u.id, { pipelineId: p.id, range: 'all', scope: [] });
    expect(none.total).toBe(0);
  });
});

describe('forecast', () => {
  it('categoría efectiva: la del deal o la de la probabilidad de la etapa', () => {
    expect(categoryFor({ forecast_category: '', probability: 80, is_won: 0, is_lost: 0 })).toBe('commit');
    expect(categoryFor({ forecast_category: '', probability: 50, is_won: 0, is_lost: 0 })).toBe('best_case');
    expect(categoryFor({ forecast_category: '', probability: 10, is_won: 0, is_lost: 0 })).toBe('pipeline');
    expect(categoryFor({ forecast_category: 'commit', probability: 10, is_won: 0, is_lost: 0 })).toBe('commit');
    expect(categoryFor({ forecast_category: 'pipeline', probability: 100, is_won: 1, is_lost: 0 })).toBe('closed_won');
    expect(categoryFor({ forecast_category: 'commit', probability: 0, is_won: 0, is_lost: 1 })).toBeNull();
  });

  it('forecastMath suma por categoría y pondera lo abierto', () => {
    const d = (amount: number, probability: number, extra: Partial<ForecastDeal> = {}): ForecastDeal => ({
      id: String(Math.random()), name: 'x', owner_id: 'o', amount, probability, stage_name: 's', close_date: null, closed_at: null,
      forecast_category: '', is_won: 0, is_lost: 0, ...extra,
    });
    const t = forecastMath([d(1000, 100, { is_won: 1 }), d(500, 80), d(400, 50), d(300, 10), d(200, 10, { forecast_category: 'omit' })], 3000);
    expect(t).toMatchObject({ goal: 3000, closedWon: 1000, commit: 500, bestCase: 400, pipeline: 300, mostLikely: 1500, deals: 4 });
    expect(t.weighted).toBe(1000 + 400 + 200 + 30);
  });

  it('applySplits: cada dueño suma su porcentaje; sin splits, todo al dueño', () => {
    const d = (id: string, owner: string, amount: number): ForecastDeal => ({
      id, name: id, owner_id: owner, amount, probability: 50, stage_name: 's', close_date: null, closed_at: null,
      forecast_category: '', is_won: 0, is_lost: 0,
    });
    const deals = [d('a', 'ana', 1000), d('b', 'ana', 400)];
    const splits = new Map([['a', [{ owner_id: 'ana', percent: 60 }, { owner_id: 'bob', percent: 40 }]]]);
    expect(applySplits(deals, splits, new Set(['bob'])).map((x) => [x.id, x.amount])).toEqual([['a', 400]]);
    expect(applySplits(deals, splits, new Set(['ana'])).map((x) => [x.id, x.amount])).toEqual([['a', 600], ['b', 400]]);
    expect(applySplits(deals, splits, new Set(['ana', 'bob'])).map((x) => x.amount)).toEqual([1000, 400]);
  });

  it('períodos: mes y trimestre desplazados', () => {
    const now = new Date(Date.UTC(2026, 9, 24));
    expect(forecastPeriod('month', 0, now).label).toBe('2026-10');
    expect(forecastPeriod('month', -1, now).label).toBe('2026-09');
    expect(forecastPeriod('month', 3, now).label).toBe('2027-01');
    expect(forecastPeriod('quarter', 0, now).label).toBe('2026-Q4');
    expect(forecastPeriod('quarter', 1, now).label).toBe('2027-Q1');
    expect(forecastPeriod('quarter', -1, now).elapsed).toBe(1);
  });

  it('getForecast por persona y equipo, meta, envío con historial y categoría por deal', async () => {
    const owner = await makeUser('fc-own');
    const rep = await makeUser('fc-rep');
    const team = await createTeam(owner.id, 'Sales');
    await addMember(team.id, rep.id, 'member');
    const { p, lead, nego, won } = await pipelineWithStages(owner.id);
    const now = new Date();
    const inMonth = `${now.getUTCFullYear()}-${String(now.getUTCMonth() + 1).padStart(2, '0')}-15`;
    const c1 = await createDeal(owner.id, { pipelineId: p.id, stageId: nego.id, name: 'Commit', amount: 800, closeDate: inMonth, ownerId: rep.id });
    const c2 = await createDeal(owner.id, { pipelineId: p.id, stageId: lead.id, name: 'Pipe', amount: 200, closeDate: inMonth, ownerId: rep.id });
    const c3 = await createDeal(owner.id, { pipelineId: p.id, stageId: lead.id, name: 'Won', amount: 1000, ownerId: rep.id });
    await createDeal(owner.id, { pipelineId: p.id, stageId: lead.id, name: 'Sin fecha', amount: 50, ownerId: rep.id });
    if (!c1.ok || !c2.ok || !c3.ok) throw new Error('create');
    await moveDeal(owner.id, c3.deal.id, won.id);
    await upsertQuota(owner.id, { personId: rep.id, metric: 'won_value', period: 'month', target: 4000 });

    const people = [{ id: owner.id, name: 'Owner' }, { id: rep.id, name: 'Rep' }];
    let f = await getForecast(owner.id, { period: 'month', people });
    const row = f.rows.find((r) => r.personId === rep.id)!;
    expect(row).toMatchObject({ goal: 4000, closedWon: 1000, commit: 800, pipeline: 200, attainment: 25 });
    expect(f.undated).toBe(1);
    expect(f.total.closedWon).toBe(1000);

    // El deal de pipeline pasa a commit a mano.
    expect(await setDealForecastCategory(owner.id, c2.deal.id, 'commit', 'a@b.c')).toBe(true);
    f = await getForecast(owner.id, { period: 'month', people });
    expect(f.rows.find((r) => r.personId === rep.id)?.commit).toBe(1000);
    const ev = await db().prepare("SELECT new_value FROM crm_property_events WHERE entity_id = ? AND field = 'forecast_category'").get(c2.deal.id) as { new_value: string };
    expect(ev.new_value).toBe('commit');

    // Envíos: vale el último, el resto queda en el historial.
    await submitForecast(owner.id, { personId: rep.id, period: 'month', periodLabel: f.periodLabel, amount: 1500, submittedBy: rep.id });
    await new Promise((r) => setTimeout(r, 1100));
    await submitForecast(owner.id, { personId: rep.id, period: 'month', periodLabel: f.periodLabel, amount: 1800, note: 'subió', submittedBy: rep.id });
    f = await getForecast(owner.id, { period: 'month', people });
    expect(f.rows.find((r) => r.personId === rep.id)?.submission?.amount).toBe(1800);
    expect(f.total.submitted).toBe(1800);
    const hist = await submissionHistory(owner.id, rep.id, 'month', f.periodLabel);
    expect(hist.map((h) => h.amount)).toEqual([1800, 1500]);
    await expect(submitForecast(owner.id, { personId: 'otro', period: 'month', periodLabel: f.periodLabel, amount: 1, submittedBy: rep.id })).rejects.toThrow('invalid_owner');
    await expect(submitForecast(owner.id, { personId: rep.id, period: 'month', periodLabel: '2026-Q1', amount: 1, submittedBy: rep.id })).rejects.toThrow('invalid_input');

    // Visibilidad: un scope sin el rep no lo muestra.
    const scoped = await getForecast(owner.id, { period: 'month', people, scope: [owner.id] });
    expect(scoped.rows.map((r) => r.personId)).toEqual([owner.id]);
  });
});

describe('reportes propios', () => {
  it('valida objetos asociados por fuente', () => {
    const ok = reportConfigSchema.parse({ source: 'deals', columns: ['deal.name', 'company.industry'] });
    expect(configObjectsValid(ok)).toBe(true);
    const bad = reportConfigSchema.parse({ source: 'companies', columns: ['activity.subject'] });
    expect(configObjectsValid(bad)).toBe(false);
  });

  it('filtros: known/unknown, últimos N días y booleanos', () => {
    expect(filterCondition({ expr: 'x', type: 'text' }, { o: 'known' })?.sql).toContain('IS NOT NULL');
    expect(filterCondition({ expr: 'x', type: 'date' }, { o: 'last', v: '30' })?.args).toEqual(['-29 days']);
    expect(filterCondition({ expr: 'x', type: 'boolean' }, { o: 'is', v: '1' })?.args).toEqual([1]);
    expect(filterCondition({ expr: 'x', type: 'number' }, { o: 'gt', v: 'abc' })).toBeNull();
    expect(filterCondition({ expr: 'x', type: 'select' }, { o: 'contains', v: 'a' })).toBeNull();
  });

  it('CRUD, ⌘K y widgets que caen al borrar', async () => {
    const u = await makeUser('cr');
    const r = await createCustomReport(u.id, { name: 'Deals por etapa', config: defaultConfig('deals'), createdBy: u.id });
    expect((await listCustomReports(u.id)).map((x) => x.id)).toEqual([r.id]);
    const renamed = await updateCustomReport(u.id, r.id, { name: 'Pipeline por etapa' });
    expect(renamed?.name).toBe('Pipeline por etapa');
    expect((await searchCustomReports(u.id, 'pipeline')).map((x) => x.id)).toEqual([r.id]);
    const other = await makeUser('cr-other');
    expect(await updateCustomReport(other.id, r.id, { name: 'x' })).toBeNull();
    const dash = await createDashboard(u.id, 'Main');
    await addWidget(u.id, dash.id, { type: 'custom_report', config: { reportId: r.id } });
    expect((await getDashboard(u.id, dash.id))?.widgets.length).toBe(1);
    expect(await deleteCustomReport(other.id, r.id)).toBe(false);
    expect(await deleteCustomReport(u.id, r.id)).toBe(true);
    expect((await getDashboard(u.id, dash.id))?.widgets.length).toBe(0);
  });

  it('entre objetos: suma de deals por industria de la empresa sin contar doble', async () => {
    const u = await makeUser('xobj');
    const { p, lead, won } = await pipelineWithStages(u.id);
    const acme = await createCompany(u.id, { name: 'Acme', industry: 'Software' });
    const globex = await createCompany(u.id, { name: 'Globex', industry: 'Retail' });
    const ann = await createContact(u.id, { firstName: 'Ann', email: 'ann@acme.com', companyId: acme.id });
    const bob = await createContact(u.id, { firstName: 'Bob', email: 'bob@acme.com', companyId: acme.id });
    // Un deal con dos contactos: no debe sumar dos veces.
    const d1 = await createDeal(u.id, { pipelineId: p.id, stageId: lead.id, name: 'D1', amount: 100, companyId: acme.id, contactIds: [ann.id, bob.id] });
    await createDeal(u.id, { pipelineId: p.id, stageId: won.id, name: 'D2', amount: 50, companyId: acme.id });
    await createDeal(u.id, { pipelineId: p.id, stageId: lead.id, name: 'D3', amount: 30, companyId: globex.id });
    if (!d1.ok) throw new Error('create');

    const byIndustry = await runReport(u.id, reportConfigSchema.parse({
      source: 'deals',
      dimensions: [{ field: 'company.industry' }],
      metric: { agg: 'sum', field: 'deal.amount' },
      // El join con contactos duplica filas de D1: la métrica igual lo cuenta una vez.
      objects: ['contact'],
      filters: [{ f: 'deal.amount', o: 'gt', v: '0' }],
      viz: 'bar',
    }));
    if (byIndustry.kind !== 'aggregate') throw new Error('kind');
    expect(byIndustry.rows).toEqual([{ keys: ['Software'], value: 150 }, { keys: ['Retail'], value: 30 }]);
    expect(byIndustry.total).toBe(180);

    // Contactos como fuente con deals asociados: cuenta deals distintos por contacto.
    const withContacts = await runReport(u.id, reportConfigSchema.parse({
      source: 'deals',
      dimensions: [{ field: 'deal.stage' }],
      metric: { agg: 'count' },
      filters: [{ f: 'contact.email', o: 'contains', v: 'acme.com' }],
      viz: 'table',
    }));
    if (withContacts.kind !== 'aggregate') throw new Error('kind');
    expect(withContacts.rows).toEqual([{ keys: [lead.id], value: 1 }]);
    expect(withContacts.labels[`stage:${lead.id}`]).toBe('Lead');

    // Agrupado por fecha (mes) y KPI.
    const kpi = await runReport(u.id, reportConfigSchema.parse({ source: 'deals', metric: { agg: 'avg', field: 'deal.amount' }, viz: 'kpi' }));
    expect(kpi.kind === 'aggregate' && kpi.total).toBe(60);
    const byMonth = await runReport(u.id, reportConfigSchema.parse({ source: 'companies', dimensions: [{ field: 'company.created', bucket: 'month' }], viz: 'line' }));
    if (byMonth.kind !== 'aggregate') throw new Error('kind');
    expect(byMonth.rows[0].keys[0]).toMatch(/^\d{4}-\d{2}$/);
    expect(byMonth.rows[0].value).toBe(2);

    // Tabla de registros con campos de la empresa asociada.
    const records = await runReport(u.id, reportConfigSchema.parse({ source: 'contacts', columns: ['contact.name', 'company.name'] }));
    if (records.kind !== 'records') throw new Error('kind');
    expect(records.total).toBe(2);
    expect(records.rows.map((r) => r.cells[1])).toEqual(['Acme', 'Acme']);
    expect(records.rows[0].href).toMatch(/^\/app\/crm\/contacts\//);

    // Métrica inválida y campo inexistente.
    await expect(runReport(u.id, reportConfigSchema.parse({ source: 'deals', metric: { agg: 'sum', field: 'deal.name' }, viz: 'bar', dimensions: [{ field: 'deal.stage' }] }))).rejects.toBeInstanceOf(ReportError);
    await expect(runReport(u.id, reportConfigSchema.parse({ source: 'deals', columns: ['deal.custom:nope'] }))).rejects.toBeInstanceOf(ReportError);
  });

  it('campos propios y visibilidad por owner', async () => {
    const owner = await makeUser('cf');
    const member = await makeUser('cf-m');
    await db()
      .prepare("INSERT INTO crm_custom_fields (id, user_id, entity, name, label, type, options, position) VALUES (?, ?, 'contacts', 'plan', 'Plan', 'select', '[\"pro\",\"free\"]', 0)")
      .run(crypto.randomUUID(), owner.id);
    await createContact(owner.id, { firstName: 'A', custom: { plan: 'pro' } });
    await createContact(owner.id, { firstName: 'B', custom: { plan: 'free' } });
    const mine = await createContact(owner.id, { firstName: 'C', custom: { plan: 'pro' }, ownerId: owner.id });
    const cfg = reportConfigSchema.parse({ source: 'contacts', dimensions: [{ field: 'contact.custom:plan' }], viz: 'pie' });
    const all = await runReport(owner.id, cfg);
    if (all.kind !== 'aggregate') throw new Error('kind');
    expect(all.rows).toEqual([{ keys: ['pro'], value: 2 }, { keys: ['free'], value: 1 }]);
    const scoped = await runReport(owner.id, cfg, { scope: [member.id] });
    expect(scoped.kind === 'aggregate' && scoped.total).toBe(0);
    expect(mine.id).toBeTruthy();
  });

  it('CSV escapa comas, comillas y fórmulas', () => {
    expect(toCsv(['a', 'b'], [['x,y', '=SUM(A1)'], ['"q"', -5]])).toBe('a,b\r\n"x,y",\'=SUM(A1)\r\n"""q""",-5');
  });
});
