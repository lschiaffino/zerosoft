import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { AiError, setAiModelOverride } from '@/lib/ai';
import { getDb } from '@/lib/db';
import {
  addListMembers,
  createActivity,
  createCompany,
  createContact,
  createDeal,
  createList,
  createPipeline,
  createStage,
} from '@/lib/crm';
import {
  baselineDealScore,
  buildRecordContext,
  CrmAiError,
  dealScoresFor,
  generateCallSummary,
  generateDealScore,
  generateRecordSummary,
  getRecordSummary,
  transcriptText,
  type DealSignals,
} from '@/lib/crm-ai';
import { coerceFieldValue, runAssistant } from '@/lib/crm-ai-assistant';
import { applyItem, createRun, getRun, htmlText, namesFromEmail, stepRun } from '@/lib/crm-ai-agents';
import { actionMissing } from '@/lib/crm-workflow-catalog';
import { apiFieldKey, createWorkflow, runWorkflowsForEvent } from '@/lib/crm-workflows';
import { makeUser } from './helpers';
import { mockModel, scriptedModel } from './ai-mock';

const ENV_KEYS = ['AI_GATEWAY_API_KEY', 'VERCEL_OIDC_TOKEN', 'VERCEL', 'AI_ENABLED', 'AI_FREE_TOKENS_PER_MONTH', 'CRM_AI_FAKE', 'RATE_LIMIT_DISABLED'];
const saved: Record<string, string | undefined> = {};

beforeEach(() => {
  for (const k of ENV_KEYS) {
    saved[k] = process.env[k];
    delete process.env[k];
  }
  process.env.RATE_LIMIT_DISABLED = 'true';
});

afterEach(() => {
  setAiModelOverride(null);
  for (const k of ENV_KEYS) {
    if (saved[k] === undefined) delete process.env[k];
    else process.env[k] = saved[k];
  }
});

async function pipeline(ws: string) {
  const p = await createPipeline(ws, `P ${crypto.randomUUID().slice(0, 4)}`);
  const open = (await createStage(ws, p.id, { name: 'Proposal', probability: 40 }))!;
  const won = (await createStage(ws, p.id, { name: 'Won', probability: 100 }))!;
  await getDb().prepare('UPDATE crm_stages SET is_won = 1 WHERE id = ?').run(won.id);
  return { p, open, won };
}

async function dealWith(ws: string, name = 'Acme renewal') {
  const { p, open, won } = await pipeline(ws);
  const contact = await createContact(ws, { firstName: 'Ana', lastName: 'Gómez', email: `ana-${crypto.randomUUID().slice(0, 4)}@acme.test` });
  const res = await createDeal(ws, { pipelineId: p.id, stageId: open.id, name, amount: 5000, contactIds: [contact.id] });
  if (!res.ok) throw new Error(res.reason);
  return { deal: res.deal, contact, open, won, pipelineId: p.id };
}

async function usageCount(ws: string, feature: string): Promise<number> {
  const r = (await getDb().prepare('SELECT COUNT(*) AS c FROM ai_usage WHERE user_id = ? AND feature = ?').get(ws, feature)) as { c: number };
  return Number(r.c);
}

describe('resumen de registro', () => {
  it('sin IA configurada tira ai_disabled y no guarda nada', async () => {
    const u = await makeUser('ai-off');
    const c = await createContact(u.id, { firstName: 'Leo', email: 'leo@x.test' });
    await expect(generateRecordSummary({ workspaceId: u.id, entity: 'contact', id: c.id, scope: null, locale: 'en', actorId: u.id })).rejects.toMatchObject({
      code: 'ai_disabled',
    });
    expect(await getRecordSummary(u.id, 'contact', c.id, null)).toBeNull();
  });

  it('genera, cachea, mide en ai_usage y se marca viejo con actividad nueva', async () => {
    const u = await makeUser('ai-sum');
    const { deal, contact } = await dealWith(u.id);
    await createActivity(u.id, { type: 'note', subject: 'Kickoff', body: 'They want a pilot in March.', dealId: deal.id, contactId: contact.id });
    setAiModelOverride(mockModel(JSON.stringify({ summary: 'Pilot planned for March.', highlights: ['5000 USD'], nextSteps: ['Send the pilot plan'] })));
    const view = await generateRecordSummary({ workspaceId: u.id, entity: 'deal', id: deal.id, scope: null, locale: 'es', actorId: u.id });
    expect(view.content.summary).toBe('Pilot planned for March.');
    expect(view.stale).toBe(false);
    expect(await usageCount(u.id, 'crm_record_summary')).toBe(1);

    const cached = await getRecordSummary(u.id, 'deal', deal.id, null);
    expect(cached?.content.nextSteps).toEqual(['Send the pilot plan']);
    expect(cached?.stale).toBe(false);

    await createActivity(u.id, { type: 'call', subject: 'Follow-up', body: 'Budget approved.', dealId: deal.id });
    expect((await getRecordSummary(u.id, 'deal', deal.id, null))?.stale).toBe(true);
  });

  it('el contexto incluye timeline y deals y respeta la visibilidad', async () => {
    const u = await makeUser('ai-ctx');
    const { contact, deal } = await dealWith(u.id, 'Big deal');
    await createActivity(u.id, { type: 'meeting', subject: 'Demo', body: 'Showed the dashboard', contactId: contact.id });
    const ctx = await buildRecordContext(u.id, 'contact', contact.id, null);
    expect(ctx?.lines.join('\n')).toContain('Big deal');
    expect(ctx?.lines.join('\n')).toContain('Showed the dashboard');
    // Un viewer que solo ve sus registros (otro owner) no lo ve.
    expect(await buildRecordContext(u.id, 'contact', contact.id, ['someone-else'])).toBeNull();
    expect(await buildRecordContext(u.id, 'deal', deal.id, [u.id])).not.toBeNull();
  });
});

describe('score del deal', () => {
  const base: DealSignals = {
    stageName: 'Proposal',
    stageProbability: 40,
    daysOpen: 20,
    daysSinceActivity: 2,
    daysToClose: 10,
    openTasks: 1,
    overdueTasks: 0,
    hasNextTask: true,
    contacts: 2,
    inboundEmails30: 1,
    outboundEmails30: 2,
    meetings30: 1,
    calls30: 0,
  };

  it('el baseline sube con señales buenas y baja con un deal frío', () => {
    const good = baselineDealScore(base);
    const cold = baselineDealScore({ ...base, daysSinceActivity: 45, overdueTasks: 2, hasNextTask: false, daysToClose: -5, contacts: 0, inboundEmails30: 0, meetings30: 0 });
    expect(good.score).toBeGreaterThan(60);
    expect(cold.score).toBeLessThan(15);
    expect(cold.reasons.some((r) => r.effect === 'negative' && r.text.includes('45 days'))).toBe(true);
    expect(good.score).toBeLessThanOrEqual(99);
    expect(cold.score).toBeGreaterThanOrEqual(1);
  });

  it('guarda score y plan, limita valores y no puntúa deals cerrados', async () => {
    const u = await makeUser('ai-score');
    const { deal, won, pipelineId } = await dealWith(u.id);
    setAiModelOverride(
      mockModel(
        JSON.stringify({
          score: 140,
          reasons: [{ text: 'Buyer replied', effect: 'positive' }],
          plan: [{ title: 'Send proposal', dueInDays: 90 }],
        }),
      ),
    );
    const view = await generateDealScore({ workspaceId: u.id, id: deal.id, scope: null, locale: 'en', actorId: u.id });
    expect(view.content.score).toBe(100);
    expect(view.content.plan[0].dueInDays).toBe(30);
    const scores = await dealScoresFor(u.id, [deal.id]);
    expect(scores.get(deal.id)).toEqual({ score: 100, reason: 'Buyer replied' });

    const closed = await createDeal(u.id, { pipelineId, stageId: won.id, name: 'Done deal' });
    if (!closed.ok) throw new Error('no deal');
    await expect(generateDealScore({ workspaceId: u.id, id: closed.deal.id, scope: null, locale: 'en', actorId: u.id })).rejects.toBeInstanceOf(CrmAiError);
  });
});

describe('resumen de llamadas', () => {
  it('pide contenido y resume las notas de la llamada', async () => {
    const u = await makeUser('ai-call');
    const c = await createContact(u.id, { firstName: 'Iván', email: 'ivan@x.test' });
    const empty = await createActivity(u.id, { type: 'call', subject: '', body: '', contactId: c.id });
    await expect(generateCallSummary({ workspaceId: u.id, activityId: empty.id, scope: null, locale: 'en', actorId: u.id })).rejects.toMatchObject({ code: 'no_content' });

    const note = await createActivity(u.id, { type: 'note', subject: 'x', body: 'not a call at all, long enough text', contactId: c.id });
    await expect(generateCallSummary({ workspaceId: u.id, activityId: note.id, scope: null, locale: 'en', actorId: u.id })).rejects.toMatchObject({ code: 'not_found' });

    const call = await createActivity(u.id, { type: 'call', subject: 'Discovery', body: 'They use spreadsheets today. We will send pricing on Friday.', contactId: c.id });
    setAiModelOverride(mockModel(JSON.stringify({ summary: 'Discovery call.', nextSteps: ['Send pricing on Friday'], sentiment: 'positive' })));
    const view = await generateCallSummary({ workspaceId: u.id, activityId: call.id, scope: null, locale: 'en', actorId: u.id });
    expect(view.content.nextSteps).toEqual(['Send pricing on Friday']);
    expect(view.content.sentiment).toBe('positive');
  });

  it('limpia tiempos y cues de VTT/SRT', () => {
    const vtt = 'WEBVTT\n\n1\n00:00:01.000 --> 00:00:03.000\nAna: Hola\n\n2\n00:00:04.000 --> 00:00:06.000\nLeo: ¿Cómo va?';
    expect(transcriptText(vtt)).toBe('Ana: Hola\n\nLeo: ¿Cómo va?');
  });
});

describe('asistente', () => {
  it('busca y propone mover la etapa sin tocar el deal', async () => {
    const u = await makeUser('ai-asst');
    const { deal, won } = await dealWith(u.id, 'Globex expansion');
    setAiModelOverride(
      scriptedModel((i) =>
        i === 0
          ? { tool: 'search_records', input: { query: 'Globex', type: 'deal' } }
          : i === 1
            ? { tool: 'propose_move_deal', input: { dealId: deal.id, stage: 'won' } }
            : { text: 'Review the change and confirm.' },
      ),
    );
    const reply = await runAssistant({
      workspaceId: u.id,
      personId: u.id,
      scope: null,
      request: { messages: [{ role: 'user', content: 'Move Globex to Won' }], locale: 'en' },
    });
    expect(reply.toolCalls).toEqual(['search_records', 'propose_move_deal']);
    expect(reply.records.map((r) => r.id)).toContain(deal.id);
    expect(reply.proposals).toHaveLength(1);
    expect(reply.proposals[0].request).toEqual({ method: 'POST', url: `/api/crm/deals/${deal.id}/move`, body: { stageId: won.id } });
    const row = (await getDb().prepare('SELECT stage_id FROM crm_deals WHERE id = ?').get(deal.id)) as { stage_id: string };
    expect(row.stage_id).not.toBe(won.id);
    expect(await usageCount(u.id, 'crm_assistant')).toBe(1);
  });

  it('no muestra ni propone cambios sobre registros que el viewer no ve', async () => {
    const u = await makeUser('ai-asst-scope');
    const { deal } = await dealWith(u.id, 'Hidden Corp');
    setAiModelOverride(
      scriptedModel((i) =>
        i === 0
          ? { tool: 'search_records', input: { query: 'Hidden' } }
          : i === 1
            ? { tool: 'propose_update_field', input: { recordType: 'deal', recordId: deal.id, field: 'amount', value: 1 } }
            : { text: 'ok' },
      ),
    );
    const reply = await runAssistant({
      workspaceId: u.id,
      personId: 'viewer',
      scope: ['viewer'],
      request: { messages: [{ role: 'user', content: 'find Hidden' }] },
    });
    expect(reply.records).toHaveLength(0);
    expect(reply.proposals).toHaveLength(0);
  });

  it('valida los campos editables', () => {
    expect(coerceFieldValue('deal', 'amount', '1.500')).toBe(1.5);
    expect(coerceFieldValue('deal', 'closeDate', '2026-12-01')).toBe('2026-12-01');
    expect(coerceFieldValue('deal', 'closeDate', 'next week')).toBeNull();
    expect(coerceFieldValue('contact', 'lifecycleStage', 'CUSTOMER')).toBe('customer');
    expect(coerceFieldValue('contact', 'ownerId', 'x')).toBeNull();
  });
});

describe('agentes de datos y prospección', () => {
  it('saca nombres del email y texto de una página', () => {
    expect(namesFromEmail('juan.perez@acme.com')).toEqual(['Juan', 'Perez']);
    expect(namesFromEmail('info@acme.com')).toEqual(['', '']);
    expect(namesFromEmail('jp123456@acme.com')).toEqual(['', '']);
    const text = htmlText('<html><head><title>Acme</title><meta name="description" content="Payroll for teams"></head><body><script>x()</script><p>Based in Lima</p></body></html>');
    expect(text).toContain('Acme');
    expect(text).toContain('Payroll for teams');
    expect(text).toContain('Based in Lima');
    expect(text).not.toContain('x()');
  });

  it('el agente de contactos propone y aplica solo campos vacíos', async () => {
    const u = await makeUser('ai-agent');
    const co = await createCompany(u.id, { name: 'Initech', domain: 'initech.test', city: 'Austin', country: 'US' });
    // Sin auto-link por dominio al crear: se crea con el email y se quita la empresa.
    const c = await createContact(u.id, { email: 'peter.gibbons@initech.test' });
    await getDb().prepare('UPDATE crm_contacts SET company_id = NULL WHERE id = ?').run(c.id);
    await getDb().prepare('DELETE FROM crm_contact_companies WHERE contact_id = ?').run(c.id).catch(() => null);
    const list = await createList(u.id, { name: 'Initech people' });
    await addListMembers(u.id, list.id, [c.id]);

    const run = await createRun({ workspaceId: u.id, personId: u.id, scope: null, input: { agent: 'enrich_contacts', listId: list.id }, defaultName: 'Run' });
    expect(run.total).toBe(1);
    await stepRun(u.id, run.id);
    const after = await getRun(u.id, run.id);
    expect(after?.run.status).toBe('done');
    const item = after!.items[0];
    expect(item.status).toBe('ready');
    const fields = (item.output as { changes: Array<{ field: string; value: unknown }> }).changes;
    expect(fields).toEqual(
      expect.arrayContaining([
        { field: 'firstName', value: 'Peter' },
        { field: 'lastName', value: 'Gibbons' },
        { field: 'companyId', value: co.id },
        { field: 'city', value: 'Austin' },
      ]),
    );
    await applyItem({ workspaceId: u.id, runId: run.id, itemId: item.id, scope: null, actorEmail: 'qa@test' });
    const row = (await getDb().prepare('SELECT first_name, last_name, company_id, city FROM crm_contacts WHERE id = ?').get(c.id)) as Record<string, string>;
    expect(row).toMatchObject({ first_name: 'Peter', last_name: 'Gibbons', company_id: co.id, city: 'Austin' });
    // Aplicado no se puede aplicar de nuevo.
    await expect(applyItem({ workspaceId: u.id, runId: run.id, itemId: item.id, scope: null, actorEmail: '' })).rejects.toMatchObject({ code: 'not_ready' });
  });

  it('prospección: borradores por contacto con el modelo; sin IA el ítem falla con ai_disabled', async () => {
    const u = await makeUser('ai-outreach');
    const a = await createContact(u.id, { firstName: 'Mia', email: 'mia@globex.test' });
    const b = await createContact(u.id, { firstName: 'Tom', email: 'tom@globex.test' });
    const list = await createList(u.id, { name: 'Globex' });
    await addListMembers(u.id, list.id, [a.id, b.id]);

    const off = await createRun({ workspaceId: u.id, personId: u.id, scope: null, input: { agent: 'outreach', listId: list.id }, defaultName: 'Off' });
    await stepRun(u.id, off.id);
    const offView = await getRun(u.id, off.id);
    expect(offView?.items.every((i) => i.status === 'failed' && i.error === 'ai_disabled')).toBe(true);

    setAiModelOverride(mockModel(JSON.stringify({ subject: 'Hi', body: 'Short intro.' })));
    const run = await createRun({ workspaceId: u.id, personId: u.id, scope: null, input: { agent: 'outreach', listId: list.id, instructions: 'book a call' }, defaultName: 'On' });
    await stepRun(u.id, run.id);
    const view = await getRun(u.id, run.id);
    expect(view?.run.status).toBe('done');
    expect(view?.items.map((i) => i.status)).toEqual(['ready', 'ready']);
    expect((view?.items[0].output as { to: string }).to).toMatch(/@globex\.test$/);
  });

  it('una corrida sin registros no se crea', async () => {
    const u = await makeUser('ai-empty');
    await expect(createRun({ workspaceId: u.id, personId: u.id, scope: null, input: { agent: 'enrich_companies' }, defaultName: 'x' })).rejects.toMatchObject({ code: 'no_targets' });
  });
});

describe('paso de IA en workflows', () => {
  it('valida la config y escribe el resultado como nota', async () => {
    expect(actionMissing('ai_step', { mode: 'prompt', prompt: '' })).toEqual(['prompt']);
    expect(actionMissing('ai_step', { mode: 'prompt', prompt: 'x', output: 'field' })).toEqual(['field']);
    expect(actionMissing('ai_step', { mode: 'summary' })).toEqual([]);
    expect(apiFieldKey('lifecycle_stage')).toBe('lifecycleStage');

    const u = await makeUser('ai-wf');
    const c = await createContact(u.id, { firstName: 'Zoe', email: 'zoe@x.test' });
    await createWorkflow(u.id, {
      name: 'Classify',
      triggers: [{ type: 'manual' }],
      actions: [{ type: 'ai_step', config: { mode: 'prompt', prompt: 'Classify this lead', output: 'note' } }],
    });
    setAiModelOverride(mockModel('Warm lead: asked for pricing.'));
    await runWorkflowsForEvent(u.id, { type: 'manual', entity: 'contact', entityId: c.id });
    const note = (await getDb()
      .prepare("SELECT body FROM crm_activities WHERE user_id = ? AND contact_id = ? AND type = 'note'")
      .get(u.id, c.id)) as { body: string } | undefined;
    expect(note?.body).toBe('Warm lead: asked for pricing.');
    expect(await usageCount(u.id, 'crm_workflow_ai')).toBe(1);
  });

  it('sin IA el paso falla con el código de la IA', async () => {
    const u = await makeUser('ai-wf-off');
    const c = await createContact(u.id, { firstName: 'Ray', email: 'ray@x.test' });
    const wf = await createWorkflow(u.id, {
      name: 'Off',
      triggers: [{ type: 'manual' }],
      actions: [{ type: 'ai_step', config: { mode: 'prompt', prompt: 'x' } }],
    });
    await runWorkflowsForEvent(u.id, { type: 'manual', entity: 'contact', entityId: c.id });
    const run = (await getDb().prepare('SELECT status, output FROM crm_workflow_runs WHERE workflow_id = ?').get(wf.id)) as { status: string; output: string };
    expect(run.status).toBe('failed');
    expect(run.output).toContain('ai_disabled');
    expect(AiError).toBeDefined();
  });
});

describe('modelo falso de e2e (CRM_AI_FAKE)', () => {
  it('corre sin Gateway, mide uso y el asistente propone la tarea del registro abierto', async () => {
    process.env.CRM_AI_FAKE = '1';
    const u = await makeUser('ai-fake');
    const { deal } = await dealWith(u.id, 'Fake deal');
    const sum = await generateRecordSummary({ workspaceId: u.id, entity: 'deal', id: deal.id, scope: null, locale: 'en', actorId: u.id });
    expect(sum.content.summary).toContain('Fake deal');
    expect(await usageCount(u.id, 'crm_record_summary')).toBe(1);

    const reply = await runAssistant({
      workspaceId: u.id,
      personId: u.id,
      scope: null,
      request: { messages: [{ role: 'user', content: 'Create a task: call the CFO' }], page: { entity: 'deal', id: deal.id } },
    });
    expect(reply.proposals[0]?.request.body).toMatchObject({ type: 'task', subject: 'call the CFO', dealId: deal.id });
  });
});
