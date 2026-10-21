import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { getDb } from '@/lib/db';
import type { AgentRow } from '@/lib/db';
import { setAiModelOverride } from '@/lib/ai';
import {
  createAgent,
  getAgentRow,
  listAgents,
  listSecretHeaders,
  removeSecretHeader,
  sendAgentMessage,
  setSecretHeader,
  updateAgent,
} from '@/lib/agents';
import { createTestCase, listTestCases, runTestCase, updateTestCase } from '@/lib/agents-tests';
import { redactSecrets } from '@/lib/agent-tools';
import {
  isSimulatedOutput,
  secretHeaderInputSchema,
  type AgentToolKey,
  type AgentToolsConfig,
  type AgentUpdatePayload,
} from '@/lib/agents-config';
import { createFlow } from '@/lib/flow';
import { createProject } from '@/lib/track-data';
import { makeUser } from './helpers';
import { scriptedModel } from './ai-mock';

const ENV_KEYS = ['AI_GATEWAY_API_KEY', 'VERCEL_OIDC_TOKEN', 'VERCEL', 'AI_ENABLED', 'AI_FREE_TOKENS_PER_MONTH', 'ALLOW_PRIVATE_WEBHOOKS'];
const saved: Record<string, string | undefined> = {};

beforeEach(() => {
  for (const k of ENV_KEYS) {
    saved[k] = process.env[k];
    delete process.env[k];
  }
});

afterEach(() => {
  setAiModelOverride(null);
  vi.unstubAllGlobals();
  for (const k of ENV_KEYS) {
    if (saved[k] === undefined) delete process.env[k];
    else process.env[k] = saved[k];
  }
});

const BASE_TOOLS: Omit<AgentToolsConfig, 'enabled'> = {
  calEventTypeId: null,
  calDays: 7,
  trackProjectId: null,
  flowIds: [],
  robotIds: [],
  httpAllowedDomains: [],
};

function tools(enabled: AgentToolKey[], extra: Partial<typeof BASE_TOOLS> = {}): AgentUpdatePayload {
  return { tools: { ...BASE_TOOLS, ...extra, enabled } };
}

async function setupAgent(label: string, patch: AgentUpdatePayload = {}) {
  const owner = await makeUser(label);
  const created = await createAgent(owner.id, owner.id, { name: `${label} agent` });
  if (Object.keys(patch).length) {
    const res = await updateAgent(owner.id, created.id, patch);
    if (!res.ok) throw new Error(res.error);
  }
  return { owner, agent: (await getAgentRow(owner.id, created.id)) as AgentRow };
}

async function reload(agent: AgentRow): Promise<AgentRow> {
  return (await getAgentRow(agent.user_id, agent.id)) as AgentRow;
}

describe('playground en modo simulación', () => {
  it('las herramientas que escriben devuelven lo que habrían hecho y no tocan nada', async () => {
    process.env.ALLOW_PRIVATE_WEBHOOKS = 'true';
    const fetchMock = vi.fn(async () => new Response('{"ok":true}', { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);
    const owner = await makeUser('dry');
    const project = await createProject(owner.id, null, { name: 'Support' } as Parameters<typeof createProject>[2]);
    const flow = await createFlow(owner.id, owner.id, { name: 'Notify' });
    if (!flow.ok) throw new Error('flow');
    const created = await createAgent(owner.id, owner.id, { name: 'Dry' });
    const upd = await updateAgent(
      owner.id,
      created.id,
      tools(['crm_upsert_contact', 'track_create_issue', 'run_flow', 'http_request'], {
        trackProjectId: project.id,
        flowIds: [flow.flow.id],
        httpAllowedDomains: ['example.com'],
      }),
    );
    expect(upd.ok).toBe(true);
    const agent = (await getAgentRow(owner.id, created.id)) as AgentRow;
    setAiModelOverride(
      scriptedModel([
        { tool: 'crm_upsert_contact', input: { email: 'ana@x.com', name: 'Ana' } },
        { tool: 'track_create_issue', input: { title: 'Login broken' } },
        { tool: 'run_flow', input: { flowId: flow.flow.id, input: { a: 1 } } },
        { tool: 'http_request', input: { url: 'https://api.example.com/orders', method: 'POST', body: '{"x":1}' } },
        { tool: 'http_request', input: { url: 'https://api.example.com/stock', method: 'GET' } },
        { text: 'Done.' },
      ]),
    );
    const res = await sendAgentMessage({ agent, channel: 'playground', text: 'I am ana@x.com, login is broken' });
    const calls = res.result.toolCalls;
    expect(calls.map((c) => [c.tool, c.error])).toEqual([
      ['crm_upsert_contact', null],
      ['track_create_issue', null],
      ['run_flow', null],
      ['http_request', null],
      ['http_request', null],
    ]);
    expect(calls.slice(0, 4).every((c) => isSimulatedOutput(c.output))).toBe(true);
    expect(calls[0].output).toMatchObject({ wouldRun: { action: 'create_contact', email: 'ana@x.com' } });
    expect(calls[2].output).toMatchObject({ wouldRun: { action: 'run_flow', flow: 'Notify', input: { a: 1 } } });
    expect(calls[3].output).toMatchObject({ wouldRun: { method: 'POST', url: 'https://api.example.com/orders' } });
    // GET solo lee: corre de verdad.
    expect(isSimulatedOutput(calls[4].output)).toBe(false);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(String((fetchMock.mock.calls[0] as unknown[])[0])).toBe('https://api.example.com/stock');

    const db = getDb();
    expect(await db.prepare('SELECT id FROM crm_contacts WHERE user_id = ?').all(owner.id)).toHaveLength(0);
    expect(await db.prepare('SELECT id FROM track_issues WHERE project_id = ?').all(project.id)).toHaveLength(0);
    expect(await db.prepare('SELECT id FROM flow_runs WHERE flow_id = ?').all(flow.flow.id)).toHaveLength(0);
    // El registro guarda la simulación (se ve en Conversaciones).
    const logged = (await db
      .prepare("SELECT output FROM agent_tool_calls WHERE conversation_id = ? AND tool = 'track_create_issue'")
      .get(res.conversation.id)) as { output: string };
    expect(JSON.parse(logged.output)).toMatchObject({ simulated: true, wouldRun: { title: 'Login broken' } });
  });

  it('fuera del playground las herramientas se ejecutan', async () => {
    const owner = await makeUser('dry-api');
    const project = await createProject(owner.id, null, { name: 'Ops' } as Parameters<typeof createProject>[2]);
    const created = await createAgent(owner.id, owner.id, { name: 'Live' });
    await updateAgent(owner.id, created.id, tools(['track_create_issue'], { trackProjectId: project.id }));
    const agent = (await getAgentRow(owner.id, created.id)) as AgentRow;
    setAiModelOverride(scriptedModel([{ tool: 'track_create_issue', input: { title: 'Real issue' } }, { text: 'Filed.' }]));
    const res = await sendAgentMessage({ agent, channel: 'api', text: 'file it' });
    expect(isSimulatedOutput(res.result.toolCalls[0].output)).toBe(false);
    expect(await getDb().prepare('SELECT id FROM track_issues WHERE project_id = ?').all(project.id)).toHaveLength(1);
  });
});

describe('headers secretos de http_request', () => {
  const SECRET = 'sk_live_supersecret_123';

  it('se guardan cifrados, se mandan solo a su dominio y nunca llegan al modelo', async () => {
    process.env.ALLOW_PRIVATE_WEBHOOKS = 'true';
    const seen: Array<{ url: string; headers: Record<string, string> }> = [];
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string | URL, init?: RequestInit) => {
        const headers = Object.fromEntries(new Headers(init?.headers).entries());
        seen.push({ url: String(url), headers });
        // Una API que hace eco del header.
        return new Response(JSON.stringify({ echo: headers.authorization ?? null }), { status: 200 });
      }),
    );
    const { agent } = await setupAgent('sec', tools(['http_request'], { httpAllowedDomains: ['example.com', 'other.org'] }));
    const bad = await setSecretHeader(agent.user_id, agent.id, { name: 'Authorization', domain: 'evil.test', value: SECRET });
    expect(bad).toEqual({ ok: false, error: 'secret_domain_not_allowed' });
    const res = await setSecretHeader(agent.user_id, agent.id, { name: 'Authorization', domain: 'example.com', value: `Bearer ${SECRET}` });
    if (!res.ok) throw new Error(res.error);
    expect(res.headers).toHaveLength(1);
    expect(JSON.stringify(res.headers)).not.toContain(SECRET);

    const row = await reload(agent);
    expect(row.http_secrets).not.toContain(SECRET);
    expect(row.http_secrets).toContain('enc:v1:');
    expect(JSON.stringify(listSecretHeaders(row))).not.toContain(SECRET);

    const model = scriptedModel([
      { tool: 'http_request', input: { url: 'https://api.example.com/me', method: 'GET' } },
      { tool: 'http_request', input: { url: 'https://other.org/me', method: 'GET' } },
      { text: 'ok' },
    ]);
    setAiModelOverride(model);
    const out = await sendAgentMessage({ agent: row, channel: 'api', text: 'who am I?' });
    expect(seen.map((s) => [s.url, s.headers.authorization ?? null])).toEqual([
      ['https://api.example.com/me', `Bearer ${SECRET}`],
      ['https://other.org/me', null],
    ]);
    // Ni el prompt, ni la salida de la herramienta, ni el registro tienen el valor.
    expect(JSON.stringify(model.doGenerateCalls)).not.toContain(SECRET);
    expect(JSON.stringify(model.doGenerateCalls[0].tools)).toContain('Authentication headers are added automatically for: example.com');
    expect(JSON.stringify(out.result.toolCalls)).not.toContain(SECRET);
    const logs = (await getDb()
      .prepare('SELECT input, output FROM agent_tool_calls WHERE conversation_id = ?')
      .all(out.conversation.id)) as Array<{ input: string; output: string }>;
    expect(JSON.stringify(logs)).not.toContain(SECRET);
    expect(JSON.stringify(logs)).toContain('[redacted]');

    const removed = await removeSecretHeader(agent.user_id, agent.id, res.headers[0].id);
    expect(removed).toEqual({ ok: true, headers: [] });
  });

  it('en simulación el POST lista los headers por nombre, sin valor', async () => {
    const { agent } = await setupAgent('sec-dry', tools(['http_request'], { httpAllowedDomains: ['example.com'] }));
    await setSecretHeader(agent.user_id, agent.id, { name: 'X-Api-Key', domain: 'example.com', value: SECRET });
    const fetchMock = vi.fn(async () => new Response('{}'));
    vi.stubGlobal('fetch', fetchMock);
    setAiModelOverride(
      scriptedModel([{ tool: 'http_request', input: { url: 'https://example.com/orders', method: 'POST', body: '{}' } }, { text: 'ok' }]),
    );
    const res = await sendAgentMessage({ agent: await reload(agent), channel: 'playground', text: 'order' });
    expect(fetchMock).not.toHaveBeenCalled();
    expect(res.result.toolCalls[0].output).toMatchObject({ simulated: true, wouldRun: { secretHeaders: ['X-Api-Key'] } });
    expect(JSON.stringify(res.result.toolCalls)).not.toContain(SECRET);
  });

  it('valida nombre y valor del header', () => {
    expect(secretHeaderInputSchema.safeParse({ name: 'Authorization', domain: 'example.com', value: 'x' }).success).toBe(true);
    expect(secretHeaderInputSchema.safeParse({ name: 'Host', domain: 'example.com', value: 'x' }).success).toBe(false);
    expect(secretHeaderInputSchema.safeParse({ name: 'Bad Name', domain: 'example.com', value: 'x' }).success).toBe(false);
    expect(secretHeaderInputSchema.safeParse({ name: 'X-Key', domain: 'example.com', value: 'a\r\nInjected: 1' }).success).toBe(false);
    expect(redactSecrets('token=abcd1234 again abcd1234', ['abcd1234'])).toBe('token=[redacted] again [redacted]');
  });
});

describe('casos de prueba con juez', () => {
  it('corre en simulación, el juez marca pass/fail y la conversación temporal se borra', async () => {
    const owner = await makeUser('tests');
    const project = await createProject(owner.id, null, { name: 'Bugs' } as Parameters<typeof createProject>[2]);
    const created = await createAgent(owner.id, owner.id, { name: 'QA' });
    await updateAgent(owner.id, created.id, tools(['track_create_issue'], { trackProjectId: project.id }));
    const agent = (await getAgentRow(owner.id, created.id)) as AgentRow;

    const t1 = await createTestCase(agent, { question: 'The login is broken', expected: 'Files a Track issue and says the team will follow up.' }, owner.id);
    if (!t1.ok) throw new Error(t1.error);
    expect(t1.test.lastStatus).toBeNull();

    // Llamadas: 0 = tool call del agente, 1 = respuesta, 2 = juez (salida estructurada).
    const model = scriptedModel((i) => {
      if (i === 0) return { tool: 'track_create_issue', input: { title: 'Login broken' } };
      if (i === 1) return { text: 'I filed it, the team will follow up.' };
      return { text: JSON.stringify({ pass: true, reason: 'Filed the issue and told the visitor.' }) };
    });
    setAiModelOverride(model);
    const run = await runTestCase(agent, t1.test.id, owner.id);
    if (!run.ok) throw new Error(run.error);
    expect(run.test.lastStatus).toBe('pass');
    expect(run.test.lastReason).toBe('Filed the issue and told the visitor.');
    expect(run.test.lastReply).toBe('I filed it, the team will follow up.');
    expect(run.test.lastTools).toEqual([{ tool: 'track_create_issue', simulated: true, error: null }]);
    // El juez recibe la pregunta, lo esperado y que la herramienta fue simulada.
    const judgePrompt = JSON.stringify(model.doGenerateCalls[2].prompt);
    expect(judgePrompt).toContain('The login is broken');
    expect(judgePrompt).toContain('Files a Track issue');
    expect(judgePrompt).toContain('track_create_issue (simulated)');
    // Nada real, y no queda la conversación de prueba.
    const db = getDb();
    expect(await db.prepare('SELECT id FROM track_issues WHERE project_id = ?').all(project.id)).toHaveLength(0);
    expect(await db.prepare('SELECT id FROM agent_conversations WHERE agent_id = ?').all(agent.id)).toHaveLength(0);

    // Falla: el juez dice que no.
    setAiModelOverride(
      scriptedModel((i) =>
        i === 0 ? { text: 'Sorry, I cannot help.' } : { text: JSON.stringify({ pass: false, reason: 'Did not file an issue.' }) },
      ),
    );
    const run2 = await runTestCase(agent, t1.test.id, owner.id);
    if (!run2.ok) throw new Error(run2.error);
    expect(run2.test.lastStatus).toBe('fail');
    expect(run2.test.lastReason).toBe('Did not file an issue.');

    // Editar lo esperado limpia el resultado.
    const edited = await updateTestCase(owner.id, agent.id, t1.test.id, { question: 'The login is broken', expected: 'Hands off.' });
    if (!edited.ok) throw new Error(edited.error);
    expect(edited.test.lastStatus).toBeNull();
    expect(await listTestCases(owner.id, agent.id)).toHaveLength(1);
    // Otro workspace no ve ni corre el caso.
    const other = await makeUser('tests-b');
    expect(await listTestCases(other.id, agent.id)).toHaveLength(0);
  });

  it('una respuesta inválida del juez queda como error', async () => {
    const { owner, agent } = await setupAgent('tests-bad');
    const t1 = await createTestCase(agent, { question: 'hi', expected: 'Greets back.' }, owner.id);
    if (!t1.ok) throw new Error(t1.error);
    setAiModelOverride(scriptedModel((i) => (i === 0 ? { text: 'Hello!' } : { text: 'not json' })));
    const run = await runTestCase(agent, t1.test.id, owner.id);
    if (!run.ok) throw new Error(run.error);
    expect(run.test.lastStatus).toBe('error');
    expect(run.test.lastReply).toBe('Hello!');
  });
});

describe('lista: uso por API y Flow', () => {
  it('cuenta conversaciones de 7 días por canal y muestra API y Flow', async () => {
    const { owner, agent } = await setupAgent('usage');
    const other = await createAgent(owner.id, owner.id, { name: 'Unused' });
    const flow = await createFlow(owner.id, owner.id, { name: 'Uses agent' });
    if (!flow.ok) throw new Error('flow');
    // Un flow con un nodo Agente que apunta al segundo agente (sin uso todavía).
    await getDb()
      .prepare('UPDATE flow_flows SET graph = ? WHERE id = ?')
      .run(
        JSON.stringify({ nodes: [{ id: 'n1', type: 'ai.agent', position: { x: 0, y: 0 }, config: { agentId: other.id, message: 'hi' } }], edges: [] }),
        flow.flow.id,
      );
    setAiModelOverride(scriptedModel([{ text: 'ok' }]));
    await sendAgentMessage({ agent, channel: 'api', text: 'from the API' });
    await sendAgentMessage({ agent, channel: 'api', source: 'flow', text: 'from a flow' });
    await sendAgentMessage({ agent, channel: 'api', source: 'flow', text: 'from a flow again' });
    await sendAgentMessage({ agent, channel: 'playground', text: 'just testing' });

    const list = await listAgents(owner.id);
    const a = list.find((x) => x.id === agent.id)!;
    expect(a.usage7d).toEqual({ chat: 0, public: 0, api: 1, flow: 2 });
    expect(a.conversations7d).toBe(3);
    expect(a.channels).toEqual(['api', 'flow']);
    const b = list.find((x) => x.id === other.id)!;
    expect(b.channels).toEqual(['flow']);
    expect(b.conversations7d).toBe(0);
  });
});
