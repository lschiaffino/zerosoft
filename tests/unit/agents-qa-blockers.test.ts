import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { getDb } from '@/lib/db';
import type { AgentRow } from '@/lib/db';
import { setAiModelOverride } from '@/lib/ai';
import { createAgent, getAgentRow, sendAgentMessage, updateAgent } from '@/lib/agents';
import { parseSettings, parseTools, type AgentProcedure } from '@/lib/agents-config';
import { connectIntegration } from '@/lib/agents-integrations';
import { publishAgent } from '@/lib/agents-versions';
import { startAbTest } from '@/lib/agents-ab';
import { procedureIssues, runProcedureTurn, MAX_ACTIONS_PER_TURN } from '@/lib/agents-procedures';
import { crmSafe, saveFormSubmission } from '@/lib/agents-forms';
import { voiceAgentForNumber, voiceNumberMap, voiceNumbersFor } from '@/lib/agents-voice';
import { makeUser } from './helpers';
import { scriptedModel } from './ai-mock';

/** QA de la tanda de paridad de Agents: acceso en el playground, A/B, teléfono, formularios y procedimientos. */

const saved: Record<string, string | undefined> = {};
const KEYS = ['AGENTS_INTEGRATIONS_FAKE', 'AGENTS_VOICE_NUMBERS', 'RATE_LIMIT_DISABLED'];
beforeEach(() => {
  for (const k of KEYS) saved[k] = process.env[k];
  process.env.RATE_LIMIT_DISABLED = 'true';
  process.env.AGENTS_INTEGRATIONS_FAKE = '1';
});
afterEach(() => {
  setAiModelOverride(null);
  for (const k of KEYS) {
    if (saved[k] === undefined) delete process.env[k];
    else process.env[k] = saved[k];
  }
});

async function workspace(memberApps: string) {
  const owner = await makeUser('qaown');
  const member = await makeUser('qamem');
  const teamId = `t-${crypto.randomUUID().slice(0, 8)}`;
  await getDb().prepare("INSERT INTO teams (id, name, owner_id) VALUES (?, 'T', ?)").run(teamId, owner.id);
  await getDb().prepare("INSERT INTO team_members (team_id, user_id, role, apps) VALUES (?, ?, 'member', ?)").run(teamId, member.id, memberApps);
  const created = await createAgent(owner.id, owner.id, { name: 'qa agent' });
  return { owner, member, agentId: created.id };
}

async function runTool(agent: AgentRow, personId: string, tool: string, input: Record<string, unknown>) {
  setAiModelOverride(scriptedModel([{ tool, input }, { text: 'ok' }]));
  const res = await sendAgentMessage({ agent, channel: 'playground', text: 'test', createdBy: personId });
  return res.result.toolCalls[0]?.output as Record<string, unknown>;
}

describe('B1: playground y herramientas por acceso', () => {
  it('stripe_customer: un viewer no consulta; el editor solo con su propio email', async () => {
    const { owner, member, agentId } = await workspace('["agents"]');
    await updateAgent(owner.id, agentId, { tools: { ...parseTools('{}'), enabled: ['stripe_customer'] } }, owner.id);
    let agent = (await getAgentRow(owner.id, agentId)) as AgentRow;
    await connectIntegration(owner.id, agent, { kind: 'stripe', key: `rk_test_${'q'.repeat(24)}` });
    agent = (await getAgentRow(owner.id, agentId)) as AgentRow;
    expect(await runTool(agent, member.id, 'stripe_customer', { email: 'ana@example.com' })).toEqual({ error: 'playground_no_access' });
    await getDb().prepare('UPDATE agents SET access = ? WHERE id = ?').run(JSON.stringify({ members: 'viewer', people: { [member.id]: 'editor' } }), agentId);
    agent = (await getAgentRow(owner.id, agentId)) as AgentRow;
    expect(await runTool(agent, member.id, 'stripe_customer', { email: 'ana@example.com' })).toEqual({ error: 'identity_not_verified' });
  });

  it('las herramientas de CRM piden la app (al correr y al guardar)', async () => {
    const { owner, member, agentId } = await workspace('["agents"]');
    await getDb().prepare('UPDATE agents SET access = ? WHERE id = ?').run(JSON.stringify({ members: 'viewer', people: { [member.id]: 'editor' } }), agentId);
    const save = await updateAgent(owner.id, agentId, { tools: { ...parseTools('{}'), enabled: ['crm_find_contact'] } }, member.id);
    expect(save).toEqual({ ok: false, error: 'tool_app_access' });
    await updateAgent(owner.id, agentId, { tools: { ...parseTools('{}'), enabled: ['crm_find_contact'] } }, owner.id);
    const agent = (await getAgentRow(owner.id, agentId)) as AgentRow;
    expect(await runTool(agent, member.id, 'crm_find_contact', { email: member.email })).toMatchObject({ error: 'playground_no_app' });
    // El editor puede guardar otros cambios sin tocar la herramienta que ya estaba.
    expect((await updateAgent(owner.id, agentId, { instructions: 'be nice' }, member.id)).ok).toBe(true);
  });
});

describe('B3: A/B revalida Docs', () => {
  it('empezar un test con una versión cuyas páginas de Docs no se pueden abrir se rechaza', async () => {
    const owner = await makeUser('qaab');
    const created = await createAgent(owner.id, owner.id, { name: 'ab docs' });
    expect((await publishAgent(owner.id, created.id, owner.id)).ok).toBe(true);
    const snapshot = {
      instructions: '',
      welcomeMessage: '',
      model: null,
      temperature: 0.3,
      knowledge: {},
      tools: { enabled: ['docs_read_pages'], docsPageIds: ['missing-page'], docsActorId: owner.id },
      handoff: {},
      guardrails: {},
      settings: {},
    };
    const vid = crypto.randomUUID();
    await getDb()
      .prepare("INSERT INTO agent_versions (id, agent_id, user_id, number, snapshot, note, created_by, created_at) VALUES (?, ?, ?, 9, ?, '', ?, ?)")
      .run(vid, created.id, owner.id, JSON.stringify(snapshot), owner.id, new Date().toISOString());
    const row = (await getAgentRow(owner.id, created.id)) as AgentRow;
    expect(await startAbTest(row, vid, 50, owner.id)).toEqual({ ok: false, error: 'invalid_docs_page' });
  });
});

describe('M4: números de teléfono por workspace', () => {
  it('solo los números que el admin de la instancia asignó al workspace', async () => {
    const owner = await makeUser('qavoice');
    process.env.AGENTS_VOICE_NUMBERS = `+14155550111=${owner.id}, +14155550112=${owner.email}, bad=x, +12=y`;
    expect([...voiceNumberMap().keys()]).toEqual(['+14155550111', '+14155550112']);
    expect(voiceNumbersFor(owner)).toEqual(['+14155550111', '+14155550112']);
    const created = await createAgent(owner.id, owner.id, { name: 'voice' });
    await getDb().prepare('UPDATE agents SET voice_number = ? WHERE id = ?').run('+14155550111', created.id);
    expect((await voiceAgentForNumber('+14155550111'))?.id).toBe(created.id);
    process.env.AGENTS_VOICE_NUMBERS = '+14155550111=someone-else';
    expect(await voiceAgentForNumber('+14155550111')).toBeNull();
  });
});

describe('M5: formularios y el CRM', () => {
  it('un email sin verificar no pisa ni anota un contacto que ya existía', async () => {
    const owner = await makeUser('qaform');
    const created = await createAgent(owner.id, owner.id, { name: 'forms' });
    const agent = (await getAgentRow(owner.id, created.id)) as AgentRow;
    const contactId = crypto.randomUUID();
    await getDb()
      .prepare("INSERT INTO crm_contacts (id, user_id, first_name, last_name, email, lifecycle_stage, created_at, updated_at) VALUES (?, ?, 'Real', 'Owner', 'ceo@victim.test', 'customer', datetime('now'), datetime('now'))")
      .run(contactId, owner.id);
    const conv = { id: crypto.randomUUID(), visitor_email: null } as unknown as Parameters<typeof saveFormSubmission>[0]['conversation'];
    await getDb()
      .prepare("INSERT INTO agent_conversations (id, agent_id, user_id, channel, title, handed_off, created_at, updated_at) VALUES (?, ?, ?, 'public', '', 0, datetime('now'), datetime('now'))")
      .run(conv.id, agent.id, owner.id);
    const form = { id: 'lead', name: 'Lead', title: '', submitLabel: '', saveToCrm: true, fields: [{ key: 'name', label: 'Name', type: 'text' as const, required: true, options: [] }, { key: 'email', label: 'Email', type: 'email' as const, required: true, options: [] }] };
    const out = await saveFormSubmission({ agent, conversation: conv, form, values: { name: '=HYPERLINK("x")', email: 'ceo@victim.test' }, dryRun: false });
    expect(out).toMatchObject({ saved: true, existing: true, verified: false });
    const contact = (await getDb().prepare('SELECT first_name FROM crm_contacts WHERE id = ?').get(contactId)) as { first_name: string };
    expect(contact.first_name).toBe('Real');
    const onContact = (await getDb().prepare('SELECT COUNT(*) AS c FROM crm_activities WHERE contact_id = ?').get(contactId)) as { c: number };
    expect(Number(onContact.c)).toBe(0);
    const loose = (await getDb().prepare("SELECT body FROM crm_activities WHERE user_id = ? AND contact_id IS NULL AND subject LIKE '%unverified%'").get(owner.id)) as { body: string };
    expect(loose.body).not.toMatch(/^Name: =/m);
    expect(crmSafe('=cmd|calc')).toBe('cmd|calc');
    expect(crmSafe('+@-=x')).toBe('x');
  });
});

describe('procedimientos: paso viejo, ciclos y tope de acciones', () => {
  const step = (s: Partial<AgentProcedure['steps'][number]> & Pick<AgentProcedure['steps'][number], 'id' | 'kind'>) => ({
    text: '',
    field: null,
    answerType: 'text' as const,
    options: [],
    formId: null,
    condition: null,
    goto: null,
    tool: null,
    args: {},
    ...s,
  });
  it('un paso que ya no existe termina el procedimiento (cancelado)', async () => {
    const proc: AgentProcedure = { id: 'p', name: 'P', trigger: '', keywords: [], steps: [step({ id: 'a', kind: 'end', text: 'x' })] };
    const r = await runProcedureTurn({ procedure: proc, forms: [], state: { procedureId: 'p', stepId: 'gone', awaiting: true, vars: {}, retries: 0, startedAt: '' }, text: 'hi', callTool: async () => ({}) });
    expect(r).toMatchObject({ state: null, cancelled: true });
  });

  it('un ciclo sin preguntas se corta, sin mandar los mensajes repetidos, y el editor lo marca', async () => {
    const proc: AgentProcedure = {
      id: 'loop',
      name: 'Loop',
      trigger: '',
      keywords: [],
      steps: [step({ id: 'm', kind: 'message', text: 'tick' }), step({ id: 'b', kind: 'branch', condition: { field: 'x', op: 'missing', value: '' }, goto: 'm' })],
    };
    const r = await runProcedureTurn({ procedure: proc, forms: [], state: null, text: 'go', callTool: async () => ({}) });
    expect(r).toMatchObject({ handoff: 'procedure_loop', messages: [] });
    expect(procedureIssues(proc, { enabledTools: [], formIds: [] }).map((i) => i.code)).toContain('loop');
  });

  it(`no corre más de ${MAX_ACTIONS_PER_TURN} acciones por turno`, async () => {
    let calls = 0;
    const steps = Array.from({ length: 8 }, (_, i) => step({ id: `a${i}`, kind: 'action', tool: 'run_flow' }));
    const proc: AgentProcedure = { id: 'many', name: 'Many', trigger: '', keywords: [], steps: [...steps, step({ id: 'e', kind: 'end', text: 'done' })] };
    const r = await runProcedureTurn({ procedure: proc, forms: [], state: null, text: 'go', callTool: async () => (calls++, {}) });
    expect(calls).toBe(MAX_ACTIONS_PER_TURN);
    expect(r.handoff).toBe('procedure_loop');
    void parseSettings;
  });
});
