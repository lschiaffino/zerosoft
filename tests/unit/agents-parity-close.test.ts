import { createHmac } from 'crypto';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { getDb } from '@/lib/db';
import type { AgentRow } from '@/lib/db';
import { setAiEmbedderOverride, setAiModelOverride } from '@/lib/ai';
import { createAgent, getAgentRow, listAgents, listVisitorMessages, sendAgentMessage, AgentError, updateAgent } from '@/lib/agents';
import type { AgentProcedure, AgentUpdatePayload } from '@/lib/agents-config';
import { parseSettings, parseTools } from '@/lib/agents-config';
import {
  evalCondition,
  isCancelMessage,
  procedureByKeyword,
  procedureIssues,
  renderTemplate,
  runProcedureTurn,
  validateAnswer,
} from '@/lib/agents-procedures';
import {
  buttonsUi,
  crmContactFromForm,
  parseFormText,
  parseUi,
  resolveNumberedChoice,
  uiAsText,
  validateFormSubmission,
} from '@/lib/agents-ui-blocks';
import { agentAccessLevel, parseAgentAccess } from '@/lib/agents-access';
import { abResults, assignVariant, pickVariant, startAbTest, stopAbTest, variantRow } from '@/lib/agents-ab';
import { publishAgent } from '@/lib/agents-versions';
import { cosine, decodeVector, encodeVector, fuseRankings, hybridRank } from '@/lib/agents-semantic';
import {
  connectIntegration,
  integrationsDto,
  integrationSecretValues,
  IntegrationError,
  normalizeShop,
  shopifyOrderStatus,
  verifyMetaSignature,
  verifySlackSignature,
} from '@/lib/agents-integrations';
import { normalizeZendesk, processPendingSources, addSource, listSources } from '@/lib/agents-sources';
import { collectAgentKnowledgeDocs } from '@/lib/agent-tools';
import { endTwiml, gatherTwiml, speakable } from '@/lib/agents-voice';
import { coerceCodeInput, runAgentCode } from '@/lib/agents-code';
import { setFlowCodeRunnerForTests } from '@/lib/flow-code';
import { claimChannelEvent, replyOnExternal } from '@/lib/agents-channels';
import { applySpans, redactPii } from '@/lib/agents-privacy';
import { normalizeSettings } from '@/lib/groups-rules';
import { makeUser } from './helpers';
import { scriptedModel } from './ai-mock';

const ENV_KEYS = ['AI_GATEWAY_API_KEY', 'VERCEL_OIDC_TOKEN', 'VERCEL', 'AI_ENABLED', 'RATE_LIMIT_DISABLED', 'AGENTS_INTEGRATIONS_FAKE', 'FLOW_CODE_RUNNER'];
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
  setAiEmbedderOverride(null);
  setFlowCodeRunnerForTests(undefined);
  for (const k of ENV_KEYS) {
    if (saved[k] === undefined) delete process.env[k];
    else process.env[k] = saved[k];
  }
});

async function setupAgent(label: string, patch: AgentUpdatePayload = {}) {
  const owner = await makeUser(label);
  const created = await createAgent(owner.id, owner.id, { name: `${label} agent` });
  if (Object.keys(patch).length) {
    const res = await updateAgent(owner.id, created.id, patch, owner.id);
    if (!res.ok) throw new Error(res.error);
  }
  return { owner, agent: (await getAgentRow(owner.id, created.id)) as AgentRow };
}

const step = (p: Partial<AgentProcedure['steps'][number]> & Pick<AgentProcedure['steps'][number], 'id' | 'kind'>): AgentProcedure['steps'][number] => ({
  text: '',
  field: null,
  answerType: 'text',
  options: [],
  formId: null,
  condition: null,
  goto: null,
  tool: null,
  args: {},
  ...p,
});

const REFUND: AgentProcedure = {
  id: 'refund',
  name: 'Refund',
  trigger: 'The visitor wants a refund',
  keywords: ['refund'],
  steps: [
    step({ id: 'a1', kind: 'ask', text: 'What email did you use?', field: 'email', answerType: 'email' }),
    step({ id: 'a2', kind: 'ask', text: 'Was the order delivered?', field: 'delivered', answerType: 'choice', options: ['Yes', 'No'] }),
    step({ id: 'b1', kind: 'branch', condition: { field: 'delivered', op: 'equals', value: 'No' }, goto: 'h1' }),
    step({ id: 'x1', kind: 'action', tool: 'crm_log_note', field: 'note', args: { email: '{{email}}', note: 'Refund for {{email}}' } }),
    step({ id: 'e1', kind: 'end', text: 'Done, {{email}}. Your refund is on its way.' }),
    step({ id: 'h1', kind: 'handoff', text: 'Order not delivered' }),
  ],
};

describe('procedimientos (motor)', () => {
  it('valida respuestas por tipo', () => {
    const ask = step({ id: 's', kind: 'ask', answerType: 'email' });
    expect(validateAnswer(ask, 'my mail is Ana@Example.com thanks')).toBe('ana@example.com');
    expect(validateAnswer(ask, 'no idea')).toBeNull();
    expect(validateAnswer({ ...ask, answerType: 'number' }, 'about 3,5 kg')).toBe('3.5');
    expect(validateAnswer({ ...ask, answerType: 'phone' }, 'call +54 9 11 5555-1234')).toBe('+5491155551234');
    expect(validateAnswer({ ...ask, answerType: 'choice', options: ['Yes', 'No'] }, 'yes')).toBe('Yes');
    expect(validateAnswer({ ...ask, answerType: 'choice', options: ['Yes', 'No'] }, '2')).toBe('No');
    expect(validateAnswer({ ...ask, answerType: 'choice', options: ['Yes', 'No'] }, 'maybe')).toBeNull();
  });

  it('plantillas, condiciones y cancelar', () => {
    expect(renderTemplate('Hi {{name}}, order {{order.status}}', { name: 'Ana', order: { status: 'paid' } })).toBe('Hi Ana, order paid');
    expect(evalCondition({ field: 'n', op: 'gt', value: '10' }, { n: '12' })).toBe(true);
    expect(evalCondition({ field: 'x', op: 'missing', value: '' }, {})).toBe(true);
    expect(evalCondition({ field: 'country', op: 'equals', value: 'méxico' }, { country: 'Mexico' })).toBe(true);
    expect(isCancelMessage('Cancelar')).toBe(true);
    expect(isCancelMessage('cancel my order')).toBe(false);
    expect(procedureByKeyword([REFUND], 'I want a REFUND please')?.id).toBe('refund');
  });

  it('corre los pasos en orden, reintenta, ramifica y llama herramientas', async () => {
    const calls: Array<{ tool: string; args: Record<string, unknown> }> = [];
    const callTool = async (tool: string, args: Record<string, unknown>) => {
      calls.push({ tool, args });
      return { logged: true };
    };
    let r = await runProcedureTurn({ procedure: REFUND, forms: [], state: null, text: 'refund', callTool });
    expect(r.messages).toEqual(['What email did you use?']);
    expect(r.state?.awaiting).toBe(true);
    r = await runProcedureTurn({ procedure: REFUND, forms: [], state: r.state, text: 'dunno', callTool });
    expect(r.messages[0]).toMatch(/didn’t get that.*email/);
    r = await runProcedureTurn({ procedure: REFUND, forms: [], state: r.state, text: 'ana@example.com', callTool });
    expect(r.messages).toEqual(['Was the order delivered?']);
    expect(r.ui).toEqual({ kind: 'buttons', options: ['Yes', 'No'] });
    const delivered = await runProcedureTurn({ procedure: REFUND, forms: [], state: r.state, text: 'Yes', callTool });
    expect(delivered.state).toBeNull();
    expect(delivered.messages).toEqual(['Done, ana@example.com. Your refund is on its way.']);
    expect(calls).toEqual([{ tool: 'crm_log_note', args: { email: 'ana@example.com', note: 'Refund for ana@example.com' } }]);
    const notDelivered = await runProcedureTurn({ procedure: REFUND, forms: [], state: r.state, text: '2', callTool });
    expect(notDelivered.handoff).toBe('Order not delivered');
  });

  it('cancelar sale del procedimiento y tres respuestas inválidas también', async () => {
    const callTool = async () => ({});
    const first = await runProcedureTurn({ procedure: REFUND, forms: [], state: null, text: 'refund', callTool });
    expect((await runProcedureTurn({ procedure: REFUND, forms: [], state: first.state, text: 'cancel', callTool })).cancelled).toBe(true);
    let st = first.state;
    for (let i = 0; i < 2; i++) st = (await runProcedureTurn({ procedure: REFUND, forms: [], state: st, text: 'nope', callTool })).state;
    expect((await runProcedureTurn({ procedure: REFUND, forms: [], state: st, text: 'nope', callTool })).cancelled).toBe(true);
  });

  it('un paso formulario acepta los valores o el texto "Campo: valor"', async () => {
    const form = { id: 'lead', name: 'Lead', title: 'Your details', submitLabel: '', saveToCrm: true, fields: [{ key: 'email', label: 'Email', type: 'email' as const, required: true, options: [] }] };
    const proc: AgentProcedure = { id: 'p', name: 'P', trigger: '', keywords: [], steps: [step({ id: 'f', kind: 'form', formId: 'lead', field: 'lead' }), step({ id: 'e', kind: 'end', text: 'Thanks {{email}}' })] };
    const r = await runProcedureTurn({ procedure: proc, forms: [form], state: null, text: 'hi', callTool: async () => ({}) });
    expect(r.ui?.kind).toBe('form');
    const done = await runProcedureTurn({ procedure: proc, forms: [form], state: r.state, text: 'Email: ana@example.com', callTool: async () => ({}) });
    expect(done.messages).toEqual(['Thanks ana@example.com']);
  });

  it('marca problemas de configuración', () => {
    const bad: AgentProcedure = {
      ...REFUND,
      steps: [step({ id: 'a', kind: 'ask' }), step({ id: 'b', kind: 'branch', condition: { field: 'x', op: 'equals', value: '' }, goto: 'zz' }), step({ id: 'c', kind: 'action', tool: 'run_flow' })],
    };
    const codes = procedureIssues(bad, { enabledTools: [], formIds: [] }).map((i) => i.code);
    expect(codes).toEqual(expect.arrayContaining(['ask_needs_field', 'bad_goto', 'tool_off']));
  });
});

describe('botones y formularios', () => {
  const form = {
    id: 'lead',
    name: 'Lead',
    title: '',
    submitLabel: '',
    saveToCrm: true,
    fields: [
      { key: 'name', label: 'Name', type: 'text' as const, required: true, options: [] },
      { key: 'email', label: 'Email', type: 'email' as const, required: true, options: [] },
      { key: 'plan', label: 'Plan', type: 'select' as const, required: false, options: ['Pro', 'Team'] },
    ],
  };

  it('valida envíos y arma el texto', () => {
    expect(validateFormSubmission(form, { name: 'Ana Pérez', email: 'ANA@x.com', plan: 'Pro' })).toEqual({
      ok: true,
      text: 'Name: Ana Pérez\nEmail: ana@x.com\nPlan: Pro',
      values: { name: 'Ana Pérez', email: 'ana@x.com', plan: 'Pro' },
    });
    expect(validateFormSubmission(form, { name: 'Ana', email: 'nope' })).toMatchObject({ ok: false, field: 'email' });
    expect(validateFormSubmission(form, { name: 'Ana', email: 'a@x.com', plan: 'Gold' })).toMatchObject({ ok: false, field: 'plan' });
    expect(validateFormSubmission(null, {})).toMatchObject({ ok: false, error: 'form_not_found' });
    expect(parseFormText(form, 'Name: Ana\nemail: a@x.com')).toEqual({ name: 'Ana', email: 'a@x.com' });
    expect(crmContactFromForm(form, { name: 'Ana Pérez', email: 'ana@x.com' })).toMatchObject({ email: 'ana@x.com', firstName: 'Ana', lastName: 'Pérez' });
  });

  it('botones: limpieza, texto y respuesta numerada', () => {
    const ui = buttonsUi([' Yes ', 'yes', 'No', '', 3]);
    expect(ui).toEqual({ kind: 'buttons', options: ['Yes', 'No'] });
    expect(uiAsText(ui)).toBe('1) Yes\n2) No');
    expect(resolveNumberedChoice('2', ui)).toBe('No');
    expect(resolveNumberedChoice('22', ui)).toBe('22');
    expect(parseUi(JSON.stringify(ui))).toEqual(ui);
    expect(parseUi('{"kind":"x"}')).toBeNull();
  });

  it('show_buttons queda en la respuesta y en el historial de la página pública', async () => {
    const { agent } = await setupAgent('agbtn', { tools: { ...parseTools('{}'), enabled: ['show_buttons'] } });
    await getDb().prepare('UPDATE agents SET public_handle = ? WHERE id = ?').run(`b-${crypto.randomUUID().slice(0, 8)}`, agent.id);
    setAiModelOverride(scriptedModel([{ tool: 'show_buttons', input: { options: ['Sales', 'Support'] } }, { text: 'Which team?' }]));
    const row = (await getAgentRow(agent.user_id, agent.id)) as AgentRow;
    const res = await sendAgentMessage({ agent: row, channel: 'public', visitorKey: 'v'.repeat(20), text: 'hi' });
    expect(res.result.ui).toEqual({ kind: 'buttons', options: ['Sales', 'Support'] });
    const hist = await listVisitorMessages(row, res.conversation.id, 'v'.repeat(20));
    expect(hist?.messages.at(-1)?.ui).toEqual({ kind: 'buttons', options: ['Sales', 'Support'] });
  });

  it('un formulario enviado se valida, queda registrado y crea el contacto', async () => {
    const { owner, agent } = await setupAgent('agform', { tools: { ...parseTools('{}'), enabled: ['show_form'] }, settings: { ...parseSettings('{}'), forms: [form] } });
    await getDb().prepare('UPDATE agents SET public_handle = ? WHERE id = ?').run(`f-${crypto.randomUUID().slice(0, 8)}`, agent.id);
    const row = (await getAgentRow(owner.id, agent.id)) as AgentRow;
    // Un formulario que el agente no mostró no se acepta (ni en una conversación nueva).
    setAiModelOverride(scriptedModel([{ text: 'x' }]));
    await expect(sendAgentMessage({ agent: row, channel: 'public', visitorKey: 'w'.repeat(20), text: 'x', form: { id: 'lead', values: { name: 'Ana', email: 'ana.form@example.com' } } })).rejects.toMatchObject({ code: 'form_not_found' });
    setAiModelOverride(scriptedModel([{ tool: 'show_form', input: { formId: 'lead' } }, { text: 'Fill this in' }]));
    const shown = await sendAgentMessage({ agent: row, channel: 'public', visitorKey: 'w'.repeat(20), text: 'I want a demo' });
    expect(shown.result.ui?.kind).toBe('form');
    setAiModelOverride(scriptedModel([{ text: 'Thanks!' }]));
    const conversationId = shown.conversation.id;
    await expect(sendAgentMessage({ agent: row, channel: 'public', visitorKey: 'w'.repeat(20), text: 'x', conversationId, form: { id: 'lead', values: { name: 'Ana' } } })).rejects.toThrow(AgentError);
    const res = await sendAgentMessage({ agent: row, channel: 'public', visitorKey: 'w'.repeat(20), text: 'x', conversationId, form: { id: 'lead', values: { name: 'Ana Gómez', email: 'ana.form@example.com' } } });
    expect(res.userMessage.content).toBe('Name: Ana Gómez\nEmail: ana.form@example.com');
    const contact = (await getDb().prepare('SELECT first_name, last_name FROM crm_contacts WHERE user_id = ? AND email = ?').get(owner.id, 'ana.form@example.com')) as { first_name: string; last_name: string } | undefined;
    expect(contact).toMatchObject({ first_name: 'Ana', last_name: 'Gómez' });
    const log = (await getDb().prepare("SELECT output FROM agent_tool_calls WHERE conversation_id = ? AND tool = 'form_submit'").get(res.conversation.id)) as { output: string };
    expect(JSON.parse(log.output)).toMatchObject({ saved: true });
  });

  it('un procedimiento por palabra clave contesta sin el modelo y guarda su estado', async () => {
    const { owner, agent } = await setupAgent('agproc', {
      tools: { ...parseTools('{}'), enabled: ['crm_log_note', 'handoff_to_human'] },
      settings: { ...parseSettings('{}'), procedures: [REFUND] },
    });
    const model = scriptedModel([{ text: 'model reply' }]);
    setAiModelOverride(model);
    const row = (await getAgentRow(owner.id, agent.id)) as AgentRow;
    const first = await sendAgentMessage({ agent: row, channel: 'playground', text: 'I need a refund', createdBy: owner.id });
    expect(first.result.text).toBe('What email did you use?');
    expect(model.doGenerateCalls.length).toBe(0);
    const second = await sendAgentMessage({ agent: row, channel: 'playground', text: 'ana@example.com', conversationId: first.conversation.id, createdBy: owner.id });
    expect(second.result.ui).toEqual({ kind: 'buttons', options: ['Yes', 'No'] });
    const third = await sendAgentMessage({ agent: row, channel: 'playground', text: 'No', conversationId: first.conversation.id, createdBy: owner.id });
    expect(third.result.handoff).toBe(true);
    const conv = (await getDb().prepare('SELECT procedure_state, handed_off FROM agent_conversations WHERE id = ?').get(first.conversation.id)) as { procedure_state: string | null; handed_off: number };
    expect(conv.procedure_state).toBeNull();
    expect(conv.handed_off).toBe(1);
  });

  it('el modelo puede arrancar un procedimiento con start_procedure', async () => {
    const { owner, agent } = await setupAgent('agproc2', { settings: { ...parseSettings('{}'), procedures: [{ ...REFUND, keywords: [] }] } });
    setAiModelOverride(scriptedModel([{ tool: 'start_procedure', input: { procedureId: 'refund' } }, { text: 'Sure!' }]));
    const row = (await getAgentRow(owner.id, agent.id)) as AgentRow;
    const res = await sendAgentMessage({ agent: row, channel: 'playground', text: 'my package never came, money back?', createdBy: owner.id });
    expect(res.result.text).toBe('What email did you use?');
  });
});

describe('acceso por agente', () => {
  it('admins editan, miembros según el agente, guests nunca', () => {
    const access = parseAgentAccess(JSON.stringify({ members: 'none', people: { p1: 'editor', p2: 'viewer' } }));
    expect(agentAccessLevel('admin', 'x', access)).toBe('edit');
    expect(agentAccessLevel('member', 'p1', access)).toBe('edit');
    expect(agentAccessLevel('member', 'p2', access)).toBe('view');
    expect(agentAccessLevel('member', 'p3', access)).toBe('none');
    expect(agentAccessLevel('guest', 'p1', access)).toBe('none');
    expect(agentAccessLevel('member', 'p3', parseAgentAccess(null))).toBe('view');
    expect(parseAgentAccess('{bad')).toEqual({ members: 'viewer', people: {} });
  });

  it('la lista no muestra los agentes sin acceso', async () => {
    const { owner, agent } = await setupAgent('agacc');
    await getDb().prepare('UPDATE agents SET access = ? WHERE id = ?').run(JSON.stringify({ members: 'none', people: { friend: 'viewer' } }), agent.id);
    expect((await listAgents(owner.id, { id: owner.id, role: 'member', actingUser: { id: 'stranger' } })).map((a) => a.id)).not.toContain(agent.id);
    expect((await listAgents(owner.id, { id: owner.id, role: 'member', actingUser: { id: 'friend' } })).map((a) => a.id)).toContain(agent.id);
    expect((await listAgents(owner.id, { id: owner.id, role: 'owner' })).map((a) => a.id)).toContain(agent.id);
  });
});

describe('tests A/B', () => {
  it('reparte conversaciones nuevas y corre la versión B', async () => {
    expect(pickVariant(30, 0.1)).toBe('b');
    expect(pickVariant(30, 0.5)).toBe('a');
    const { owner, agent } = await setupAgent('agab', { instructions: 'version one rules' });
    const v1 = await publishAgent(owner.id, agent.id, owner.id);
    if (!v1.ok) throw new Error(v1.error);
    await updateAgent(owner.id, agent.id, { instructions: 'version two rules' }, owner.id);
    expect((await publishAgent(owner.id, agent.id, owner.id)).ok).toBe(true);
    const versions = (await getDb().prepare('SELECT id, number FROM agent_versions WHERE agent_id = ? ORDER BY number').all(agent.id)) as Array<{ id: string; number: number }>;
    let row = (await getAgentRow(owner.id, agent.id)) as AgentRow;
    expect((await startAbTest(row, versions[1].id, 50, owner.id)).ok).toBe(false); // la que está en vivo
    expect((await startAbTest(row, versions[0].id, 50, owner.id)).ok).toBe(true);
    row = (await getAgentRow(owner.id, agent.id)) as AgentRow;
    const conv = (await getDb().prepare('SELECT id FROM agent_conversations WHERE agent_id = ? LIMIT 1').get(agent.id)) as { id: string } | undefined;
    void conv;
    // Una conversación nueva con variante B corre las instrucciones de la v1.
    const model = scriptedModel([{ text: 'hello' }]);
    setAiModelOverride(model);
    const res = await sendAgentMessage({ agent: row, channel: 'api', text: 'hi', createdBy: null });
    await getDb().prepare("UPDATE agent_conversations SET variant = NULL WHERE id = ?").run(res.conversation.id);
    expect(await assignVariant(row, res.conversation.id, 0.01)).toBe('b');
    const fresh = (await getDb().prepare('SELECT * FROM agent_conversations WHERE id = ?').get(res.conversation.id)) as { variant: string };
    expect(fresh.variant).toBe('b');
    expect((await variantRow(row, { variant: 'b' })).instructions).toBe('version one rules');
    expect((await variantRow(row, { variant: 'a' })).instructions).toBe('version two rules');
    await sendAgentMessage({ agent: row, channel: 'api', text: 'again', conversationId: res.conversation.id, createdBy: null });
    expect(JSON.stringify(model.doGenerateCalls.at(-1)?.prompt[0])).toContain('version one rules');
    const results = await abResults(row);
    expect(results.test?.versionNumber).toBe(1);
    expect(results.a.conversations + results.b.conversations).toBeGreaterThanOrEqual(1);
    expect((await stopAbTest(row, owner.id, true)).ok).toBe(true);
    expect(((await getAgentRow(owner.id, agent.id)) as AgentRow).instructions).toBe('version one rules');
  });
});

describe('búsqueda semántica', () => {
  it('vectores, coseno y fusión', () => {
    expect(Array.from(decodeVector(encodeVector([1, 0.5, -2])))).toEqual([1, 0.5, -2]);
    expect(cosine([1, 0], [1, 0])).toBeCloseTo(1);
    expect(cosine([1, 0], [0, 1])).toBeCloseTo(0);
    const fused = fuseRankings([['a', 'b'], ['b', 'c']]);
    expect([...fused.entries()].sort((x, y) => y[1] - x[1])[0][0]).toBe('b');
  });

  it('encuentra un pasaje con otras palabras (y cae a palabras clave si falla)', async () => {
    const owner = await makeUser('agsem');
    // Embedder de prueba: "cost", "price" y "pricing" van a la misma dimensión.
    const dims = (t: string) => {
      const v = [0, 0, 0, 0];
      const s = t.toLowerCase();
      if (/cost|price|pricing|plan/.test(s)) v[0] += 1;
      if (/ship|deliver/.test(s)) v[1] += 1;
      if (/refund/.test(s)) v[2] += 1;
      v[3] += 0.05;
      return v;
    };
    setAiModelOverride(scriptedModel([{ text: 'x' }]));
    setAiEmbedderOverride(async (values) => ({ embeddings: values.map(dims), tokens: values.length }));
    const docs = [
      { kind: 'doc' as const, title: 'Pricing', text: 'The Pro plan is 49 dollars a month.' },
      { kind: 'doc' as const, title: 'Shipping', text: 'Orders ship in two business days.' },
    ];
    const res = await hybridRank(owner.id, docs, 'how much does it cost?', 1);
    expect(res[0]?.title).toBe('Pricing');
    const stored = (await getDb().prepare('SELECT COUNT(*) AS c FROM agent_embeddings WHERE user_id = ?').get(owner.id)) as { c: number };
    expect(Number(stored.c)).toBe(2);
    setAiEmbedderOverride(async () => {
      throw new Error('down');
    });
    expect((await hybridRank(owner.id, docs, 'shipping days', 1))[0]?.title).toBe('Shipping');
  });
});

describe('conexiones y canales', () => {
  it('guarda las credenciales cifradas y la UI no las ve', async () => {
    process.env.AGENTS_INTEGRATIONS_FAKE = '1';
    const { owner, agent } = await setupAgent('agint');
    await expect(connectIntegration(owner.id, agent, { kind: 'stripe', key: 'nope' })).rejects.toBeInstanceOf(IntegrationError);
    const key = `rk_test_${'a'.repeat(24)}`;
    const dto = await connectIntegration(owner.id, agent, { kind: 'stripe', key });
    expect(dto.stripe).toEqual({ connected: true, mode: 'test', last4: 'aaaa' });
    const row = (await getAgentRow(owner.id, agent.id)) as AgentRow;
    expect(row.integrations).not.toContain(key);
    expect(JSON.stringify(integrationsDto(row))).not.toContain(key);
    expect(integrationSecretValues(row)).toContain(key);
    expect(normalizeShop('https://My-Store.myshopify.com/admin')).toBe('my-store.myshopify.com');
    expect(normalizeShop('evil.com')).toBeNull();
    expect(normalizeShop('b@c')).toBeNull();
    expect(await shopifyOrderStatus('s.myshopify.com', 't', '#1001', 'other@example.com')).toEqual({ found: false });
    expect(await shopifyOrderStatus('s.myshopify.com', 't', '1001', 'ana@example.com')).toMatchObject({ found: true });
  });

  it('stripe_customer pide la identidad verificada fuera del playground', async () => {
    process.env.AGENTS_INTEGRATIONS_FAKE = '1';
    const { owner, agent } = await setupAgent('agstripe', { tools: { ...parseTools('{}'), enabled: ['stripe_customer'] } });
    await connectIntegration(owner.id, agent, { kind: 'stripe', key: `rk_test_${'b'.repeat(24)}` });
    setAiModelOverride(scriptedModel([{ tool: 'stripe_customer', input: { email: 'ana@example.com' } }, { text: 'ok' }]));
    const row = (await getAgentRow(owner.id, agent.id)) as AgentRow;
    const res = await sendAgentMessage({ agent: row, channel: 'api', text: 'my email is ana@example.com, am I paid up?', createdBy: null });
    expect(res.result.toolCalls[0]?.output).toEqual({ error: 'identity_not_verified' });
    setAiModelOverride(scriptedModel([{ tool: 'stripe_customer', input: { email: 'ana@example.com' } }, { text: 'ok' }]));
    const ok = await sendAgentMessage({ agent: row, channel: 'api', text: 'am I paid up?', createdBy: null, identity: { email: 'ana@example.com', name: null } });
    expect(ok.result.toolCalls[0]?.output).toMatchObject({ found: true });
  });

  it('firmas de Slack y Meta', () => {
    const now = 1_800_000_000;
    const body = '{"type":"event_callback"}';
    const sig = `v0=${createHmac('sha256', 'secret123').update(`v0:${now}:${body}`).digest('hex')}`;
    expect(verifySlackSignature('secret123', String(now), body, sig, now)).toBe(true);
    expect(verifySlackSignature('secret123', String(now - 600), body, sig, now)).toBe(false);
    expect(verifySlackSignature('other', String(now), body, sig, now)).toBe(false);
    const metaSig = `sha256=${createHmac('sha256', 'appsecret').update(body).digest('hex')}`;
    expect(verifyMetaSignature('appsecret', body, metaSig)).toBe(true);
    expect(verifyMetaSignature('appsecret', `${body} `, metaSig)).toBe(false);
  });

  it('un hilo externo es una conversación (y un evento repetido no se procesa dos veces)', async () => {
    const { agent } = await setupAgent('agext');
    expect(await claimChannelEvent(agent.id, 'evt-1')).toBe(true);
    expect(await claimChannelEvent(agent.id, 'evt-1')).toBe(false);
    setAiModelOverride(scriptedModel([{ text: 'Hi from Slack' }]));
    const a = await replyOnExternal({ agent, source: 'slack', externalRef: 'slack:T:C:1', text: 'hello' });
    const b = await replyOnExternal({ agent, source: 'slack', externalRef: 'slack:T:C:1', text: 'again' });
    expect(a?.text).toBe('Hi from Slack');
    expect(b?.text).toBe('Hi from Slack');
    const convs = (await getDb().prepare("SELECT source, channel FROM agent_conversations WHERE agent_id = ? AND external_ref = 'slack:T:C:1'").all(agent.id)) as Array<{ source: string; channel: string }>;
    expect(convs).toEqual([{ source: 'slack', channel: 'api' }]);
  });

  it('teléfono: texto para leer y TwiML escapado', () => {
    expect(speakable('Yes [1].\n\nSources:\n[1] Pricing: https://x.com')).toBe('Yes.');
    const xml = gatherTwiml({ base: 'https://app.test', say: 'A & B <c>', language: 'es-MX' });
    expect(xml).toContain('A &amp; B &lt;c&gt;');
    expect(xml).toContain('input="speech"');
    expect(xml).toContain('https://app.test/api/agents/voice?step=turn');
    expect(endTwiml({ say: 'bye', language: 'en-US', dial: '+14155550100' })).toContain('<Dial>+14155550100</Dial>');
    expect(endTwiml({ say: 'bye', language: 'en-US' })).toContain('<Hangup/>');
  });

  it('el agente por defecto de WhatsApp se valida en los ajustes de Groups', () => {
    expect(normalizeSettings({ defaultAgentId: 'abc-123' }).defaultAgentId).toBe('abc-123');
    expect(normalizeSettings({ defaultAgentId: "x'; DROP" }).defaultAgentId).toBeNull();
    expect(normalizeSettings({}).defaultAgentId).toBeNull();
  });
});

describe('fuentes externas y código', () => {
  it('Zendesk: normaliza, lee los artículos y entran al conocimiento', async () => {
    process.env.AGENTS_INTEGRATIONS_FAKE = '1';
    expect(normalizeZendesk('https://Acme.zendesk.com/hc/es')).toBe('acme.zendesk.com');
    expect(normalizeZendesk('acme')).toBe('acme.zendesk.com');
    expect(normalizeZendesk('evil.com')).toBeNull();
    const { owner, agent } = await setupAgent('agzd');
    await addSource(agent, 'zendesk', 'acme', owner.id);
    await processPendingSources({ limit: 10 });
    const [src] = await listSources(agent.id);
    expect(src).toMatchObject({ status: 'ok', items: 2 });
    const { toAgentDto } = await import('@/lib/agents');
    const docs = await collectAgentKnowledgeDocs(toAgentDto(agent), owner.id);
    expect(docs.some((d) => d.title === 'Refund policy' && d.source?.includes('acme.zendesk.com'))).toBe(true);
  });

  it('run_code: tipos de los parámetros y runner aislado', async () => {
    const fn = { id: 'c1', name: 'vat', description: '', params: [{ name: 'amount', type: 'number' as const, description: '' }, { name: 'eu', type: 'boolean' as const, description: '' }], code: 'return input.amount * 2', timeoutSec: 5 };
    expect(coerceCodeInput(fn, { amount: '10,5', eu: 'true' })).toEqual({ ok: true, input: { amount: 10.5, eu: true } });
    expect(coerceCodeInput(fn, { amount: 'ten' })).toEqual({ ok: false, error: 'invalid_param:amount' });
    setFlowCodeRunnerForTests(null);
    expect(await runAgentCode(fn, { amount: 1 })).toEqual({ error: 'code_unavailable' });
    setFlowCodeRunnerForTests(async (job) => ({ ok: true, result: (job.input as { amount: number }).amount * 2, logs: '' }));
    expect(await runAgentCode(fn, { amount: 4 })).toEqual({ result: 8 });
  });

  it('redacción de nombres y direcciones encontrados por la AI', () => {
    const spans = [{ text: 'Ana Pérez', label: 'name' as const }, { text: 'Av. Corrientes 1234', label: 'address' as const }];
    expect(applySpans('Soy ana pérez, vivo en Av. Corrientes 1234.', spans)).toBe('Soy [name], vivo en [address].');
    expect(redactPii('Ana Pérez, ana@x.com', undefined, spans)).toBe('[name], [email]');
    expect(applySpans('Mariana', [{ text: 'Ana', label: 'name' }])).toBe('Mariana');
  });
});
