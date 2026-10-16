import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';
import { getDb, type FlowRunRow } from '@/lib/db';
import { createContact } from '@/lib/crm';
import { emitEvent, flowChain } from '@/lib/events';
import {
  computeNextRun,
  createFlow,
  enqueueDueSchedules,
  enqueueEventRuns,
  enqueueRun,
  getFlow,
  getRunWithSteps,
  listFlowWebhooks,
  updateFlow,
} from '@/lib/flow';
import { runFlowNow } from '@/lib/flow-http';
import { FLOW_TEMPLATES, validateGraph, type FlowGraph } from '@/lib/flow-schema';
import { evalConditions, renderString, renderValue } from '@/lib/flow-template';
import { claimQueuedRun, processFlowQueue } from '@/lib/flow-worker';
import { createWebhook } from '@/lib/webhooks';
import { setAiModelOverride } from '@/lib/ai';
import { createProject } from '@/lib/track-data';
import { makeUser } from './helpers';
import { mockModel } from './ai-mock';

const session = vi.hoisted(() => ({ user: null as null | Record<string, unknown> }));
vi.mock('@/lib/session', () => ({ getCurrentUser: async () => session.user }));

const flowsRoute = await import('@/app/api/flow/flows/route');
const flowRoute = await import('@/app/api/flow/flows/[id]/route');
const hookRoute = await import('@/app/api/flow/hooks/[token]/route');

beforeEach(() => {
  vi.stubEnv('RATE_LIMIT_DISABLED', 'true');
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  setAiModelOverride(null);
});

function manual(nodes: FlowGraph['nodes'], edges: FlowGraph['edges'], sample: unknown = {}): FlowGraph {
  return {
    nodes: [
      { id: 't', type: 'trigger.manual', position: { x: 0, y: 0 }, config: { sample: JSON.stringify(sample) } },
      ...nodes,
    ],
    edges,
  };
}

function node(id: string, type: string, config: Record<string, unknown> = {}) {
  return { id, type, position: { x: 0, y: 0 }, config } as FlowGraph['nodes'][number];
}

function edge(source: string, target: string, sourceHandle?: string) {
  return { id: `${source}-${sourceHandle ?? 'out'}-${target}`, source, target, sourceHandle: sourceHandle ?? null };
}

async function newFlow(ws: string, graph: FlowGraph, enabled = false) {
  const res = await createFlow(ws, ws, { name: 'F', graph });
  if (!res.ok) throw new Error(res.error);
  if (enabled) {
    const up = await updateFlow(ws, res.flow.id, { enabled: true });
    if (!up.ok) throw new Error(up.error);
    return up.flow;
  }
  return res.flow;
}

async function runsOf(flowId: string): Promise<FlowRunRow[]> {
  return (await getDb().prepare('SELECT * FROM flow_runs WHERE flow_id = ? ORDER BY created_at').all(flowId)) as FlowRunRow[];
}

function stepIds(run: { steps: Array<{ nodeId: string; status: string }> } | null) {
  return (run?.steps ?? []).map((s) => `${s.nodeId}:${s.status}`);
}

describe('Flow: validación del grafo', () => {
  it('acepta las plantillas', () => {
    for (const t of FLOW_TEMPLATES) expect(validateGraph(t.graph)).toMatchObject({ ok: true });
  });

  it('rechaza grafos inválidos', () => {
    const t = node('t', 'trigger.manual');
    expect(validateGraph({ nodes: [node('a', 'data.set')], edges: [] })).toMatchObject({ error: 'no_trigger' });
    expect(validateGraph({ nodes: [t, node('t2', 'trigger.webhook')], edges: [] })).toMatchObject({
      error: 'multiple_triggers',
    });
    expect(validateGraph({ nodes: [t, node('x', 'nope.node')], edges: [] })).toMatchObject({ error: 'unknown_node_type' });
    expect(validateGraph({ nodes: [t], edges: [edge('t', 'ghost')] })).toMatchObject({ error: 'unknown_edge_node' });
    expect(validateGraph({ nodes: [t, node('a', 'data.set')], edges: [edge('t', 'a', 'true')] })).toMatchObject({
      error: 'invalid_handle',
    });
    expect(validateGraph({ nodes: [t, node('a', 'data.set')], edges: [edge('a', 't')] })).toMatchObject({
      error: 'trigger_has_input',
    });
    expect(
      validateGraph({
        nodes: [t, node('a', 'data.set'), node('b', 'data.set')],
        edges: [edge('t', 'a'), edge('a', 'b'), edge('b', 'a')],
      }),
    ).toMatchObject({ error: 'cycle' });
    expect(
      validateGraph({
        nodes: [t, node('l', 'logic.loop'), node('d', 'logic.delay')],
        edges: [edge('t', 'l'), edge('l', 'd', 'item')],
      }),
    ).toMatchObject({ error: 'delay_in_loop' });
    expect(
      validateGraph({
        nodes: [t, node('s', 'logic.switch', { cases: ['a', 'b'] }), node('x', 'data.set')],
        edges: [edge('t', 's'), edge('s', 'x', 'case-1')],
      }),
    ).toMatchObject({ ok: true });
  });
});

describe('Flow: plantillas', () => {
  const ctx = {
    trigger: { email: 'a@b.co', items: [{ name: 'A' }, { name: 'B' }], n: 5, text: 'he said "hi"' },
    nodes: { http: { output: { body: { id: 42 } } } },
  };

  it('resuelve variables, filtros y tipos', () => {
    expect(renderString('Hi {{ trigger.email }}!', ctx)).toBe('Hi a@b.co!');
    expect(renderValue('{{trigger.items}}', ctx)).toEqual(ctx.trigger.items);
    expect(renderValue('{{nodes.http.output.body.id}}', ctx)).toBe(42);
    expect(renderString('{{trigger.items | map:name | join:", "}}', ctx)).toBe('A, B');
    expect(renderString('{{trigger.items | map:name | join:/}}', ctx)).toBe('A/B');
    expect(renderString('{{trigger.items | map:name | lines}}', ctx)).toBe('A\nB');
    expect(renderString('{"t": {{trigger.text | json}}}', ctx)).toBe('{"t": "he said \\"hi\\""}');
    expect(renderString('{{trigger.missing | default:none}}', ctx)).toBe('none');
    expect(renderString('{{trigger.items[1].name}} {{trigger.items.length}}', ctx)).toBe('B 2');
    expect(renderString('{{trigger.__proto__}}', ctx)).toBe('');
  });

  it('evalúa condiciones', () => {
    expect(evalConditions([{ left: '{{trigger.n}}', op: 'gt', right: '3' }], 'all', ctx)).toBe(true);
    expect(
      evalConditions(
        [
          { left: '{{trigger.n}}', op: 'lt', right: '3' },
          { left: '{{trigger.email}}', op: 'contains', right: '@B.CO' },
        ],
        'any',
        ctx,
      ),
    ).toBe(true);
    expect(evalConditions([{ left: '{{trigger.none}}', op: 'exists' }], 'all', ctx)).toBe(false);
  });
});

describe('Flow: motor', () => {
  it('ramifica con if (true/false) y pasa salidas entre nodos', async () => {
    const ws = (await makeUser('flow')).id;
    const graph = manual(
      [
        node('check', 'logic.if', { combine: 'all', conditions: [{ left: '{{trigger.amount}}', op: 'gt', right: '100' }] }),
        node('big', 'data.set', { fields: [{ key: 'label', value: 'big {{trigger.amount}}' }] }),
        node('small', 'data.set', { fields: [{ key: 'label', value: 'small' }] }),
        node('after', 'data.set', { fields: [{ key: 'echo', value: '{{nodes.big.output.label}}' }] }),
      ],
      [edge('t', 'check'), edge('check', 'big', 'true'), edge('check', 'small', 'false'), edge('big', 'after')],
    );
    const flow = await newFlow(ws, graph);
    const res = await runFlowNow(ws, flow.id, { amount: 250 });
    expect(res.ok && res.run?.status).toBe('success');
    const run = res.ok ? res.run : null;
    expect(stepIds(run)).toEqual(['t:success', 'check:success', 'big:success', 'after:success']);
    expect(run?.steps.find((s) => s.nodeId === 'after')?.output).toEqual({ echo: 'big 250' });

    const res2 = await runFlowNow(ws, flow.id, { amount: 5 });
    expect(stepIds(res2.ok ? res2.run : null)).toEqual(['t:success', 'check:success', 'small:success']);
  });

  it('switch elige el caso y filter corta la rama', async () => {
    const ws = (await makeUser('flow')).id;
    const graph = manual(
      [
        node('sw', 'logic.switch', { value: '{{trigger.plan}}', cases: ['free', 'pro'] }),
        node('pro', 'data.set', { fields: [{ key: 'x', value: '1' }] }),
        node('stop', 'logic.filter', { conditions: [{ left: '{{trigger.vip}}', op: 'is_true' }] }),
        node('never', 'data.set', { fields: [{ key: 'x', value: '2' }] }),
      ],
      [edge('t', 'sw'), edge('sw', 'pro', 'case-1'), edge('pro', 'stop'), edge('stop', 'never')],
    );
    const flow = await newFlow(ws, graph);
    const res = await runFlowNow(ws, flow.id, { plan: 'pro', vip: false });
    const run = res.ok ? res.run : null;
    expect(run?.status).toBe('success');
    expect(stepIds(run)).toEqual(['t:success', 'sw:success', 'pro:success', 'stop:skipped']);
  });

  it('loop recorre los elementos en serie (con tope)', async () => {
    const ws = (await makeUser('flow')).id;
    const graph = manual(
      [
        node('loop', 'logic.loop', { items: '{{trigger.items}}', max: 2 }),
        node('each', 'data.set', { fields: [{ key: 'v', value: '{{loop.index}}:{{loop.item}}' }] }),
        node('done', 'data.set', { fields: [{ key: 'n', value: '{{nodes.loop.output.count}}' }] }),
      ],
      [edge('t', 'loop'), edge('loop', 'each', 'item'), edge('loop', 'done', 'done')],
    );
    const flow = await newFlow(ws, graph);
    const res = await runFlowNow(ws, flow.id, { items: ['a', 'b', 'c'] });
    const run = res.ok ? res.run : null;
    expect(run?.status).toBe('success');
    const each = run?.steps.filter((s) => s.nodeId === 'each').map((s) => s.output);
    expect(each).toEqual([{ v: '0:a' }, { v: '1:b' }]);
    expect(run?.steps.find((s) => s.nodeId === 'done')?.output).toEqual({ n: 2 });
  });

  it('delay persiste un job, deja la corrida en espera y el worker la retoma', async () => {
    const ws = (await makeUser('flow')).id;
    const graph = manual(
      [
        node('wait', 'logic.delay', { amount: 10, unit: 'minutes' }),
        node('after', 'data.set', { fields: [{ key: 'v', value: '{{trigger.x}}' }] }),
      ],
      [edge('t', 'wait'), edge('wait', 'after')],
    );
    const flow = await newFlow(ws, graph);
    const res = await runFlowNow(ws, flow.id, { x: 'ok' });
    const run = res.ok ? res.run : null;
    expect(run?.status).toBe('waiting');
    expect(stepIds(run)).toEqual(['t:success', 'wait:waiting']);
    const jobs = (await getDb().prepare('SELECT * FROM flow_jobs WHERE run_id = ?').all(run!.id)) as Array<{ id: string }>;
    expect(jobs).toHaveLength(1);

    // Todavía no vence: el worker no hace nada.
    expect((await processFlowQueue()).jobs).toBe(0);
    await getDb().prepare("UPDATE flow_jobs SET run_at = '2000-01-01T00:00:00.000Z' WHERE run_id = ?").run(run!.id);
    expect((await processFlowQueue()).jobs).toBe(1);
    const done = await getRunWithSteps(ws, run!.id);
    expect(done?.status).toBe('success');
    expect(done?.steps.find((s) => s.nodeId === 'after')?.output).toEqual({ v: 'ok' });
    expect(await getDb().prepare('SELECT 1 FROM flow_jobs WHERE run_id = ?').get(run!.id)).toBeUndefined();
  });

  it('HTTP: renderiza el request, parsea JSON y reintenta con un job si falla', async () => {
    vi.stubEnv('ALLOW_PRIVATE_WEBHOOKS', 'true');
    const fetchMock = vi.fn(async (_url: unknown, init?: RequestInit) => {
      const body = JSON.parse(String(init?.body ?? '{}')) as { text: string };
      return new Response(JSON.stringify({ id: 7, echo: body.text }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      });
    });
    vi.stubGlobal('fetch', fetchMock);
    const ws = (await makeUser('flow')).id;
    const graph = manual(
      [
        node('http', 'action.http', {
          method: 'POST',
          url: 'http://api.test/{{trigger.path}}',
          headers: [{ key: 'X-Token', value: 'abc' }],
          body: '{"text": {{trigger.msg | json}}}',
          parseJson: true,
        }),
        node('use', 'data.set', { fields: [{ key: 'id', value: '{{nodes.http.output.body.id}}' }] }),
      ],
      [edge('t', 'http'), edge('http', 'use')],
    );
    const flow = await newFlow(ws, graph);
    const res = await runFlowNow(ws, flow.id, { path: 'items', msg: 'say "hi"' });
    const run = res.ok ? res.run : null;
    expect(run?.status).toBe('success');
    const [url, init] = fetchMock.mock.calls[0] as [URL, RequestInit];
    expect(String(url)).toBe('http://api.test/items');
    expect((init.headers as Record<string, string>)['x-token']).toBe('abc');
    expect(run?.steps.find((s) => s.nodeId === 'http')?.output).toMatchObject({ status: 200, body: { id: 7, echo: 'say "hi"' } });
    expect(run?.steps.find((s) => s.nodeId === 'use')?.output).toEqual({ id: 7 });

    // 503 con reintentos: queda en espera con un job de retry.
    vi.stubGlobal('fetch', vi.fn(async () => new Response('down', { status: 503 })));
    await updateFlow(ws, flow.id, {
      graph: { ...graph, nodes: graph.nodes.map((n) => (n.id === 'http' ? { ...n, config: { ...n.config, retries: 1 } } : n)) },
    });
    const retry = await runFlowNow(ws, flow.id, { path: 'x', msg: 'm' });
    const rrun = retry.ok ? retry.run : null;
    expect(rrun?.status).toBe('waiting');
    expect(rrun?.steps.find((s) => s.nodeId === 'http')?.error).toMatch(/^http_503 \(retry 1\/1\)/);
    await getDb().prepare("UPDATE flow_jobs SET run_at = '2000-01-01T00:00:00.000Z' WHERE run_id = ?").run(rrun!.id);
    await processFlowQueue();
    const final = await getRunWithSteps(ws, rrun!.id);
    expect(final?.status).toBe('failed');
    expect(final?.error).toBe('http: http_503');
  });

  it('HTTP: bloquea destinos privados (SSRF)', async () => {
    const ws = (await makeUser('flow')).id;
    const flow = await newFlow(
      ws,
      manual([node('http', 'action.http', { method: 'GET', url: 'http://127.0.0.1/admin' })], [edge('t', 'http')]),
    );
    const res = await runFlowNow(ws, flow.id, {});
    expect(res.ok && res.run?.status).toBe('failed');
    expect(res.ok && res.run?.steps.find((s) => s.nodeId === 'http')?.error).toBe('private_host');
  });

  it('AI: usa el modelo configurado y falla con gracia si no hay AI', async () => {
    const ws = (await makeUser('flow')).id;
    const flow = await newFlow(
      ws,
      manual([node('ai', 'ai.text', { prompt: 'Summarize: {{trigger.msg}}' })], [edge('t', 'ai')]),
    );
    vi.stubEnv('AI_ENABLED', 'false');
    const off = await runFlowNow(ws, flow.id, { msg: 'hello' });
    expect(off.ok && off.run?.steps.find((s) => s.nodeId === 'ai')?.error).toBe('ai_disabled');

    setAiModelOverride(mockModel('A short summary.'));
    const on = await runFlowNow(ws, flow.id, { msg: 'hello' });
    expect(on.ok && on.run?.status).toBe('success');
    expect(on.ok && on.run?.steps.find((s) => s.nodeId === 'ai')?.output).toMatchObject({ text: 'A short summary.' });
  });

  it('corta en el tope de pasos por corrida', async () => {
    const ws = (await makeUser('flow')).id;
    // 100 ítems × 10 nodos en el cuerpo no entran en el techo de pasos: falla antes de empezar.
    const body = Array.from({ length: 10 }, (_, i) => node(`b${i}`, 'data.set'));
    const flow = await newFlow(
      ws,
      manual(
        [node('loop', 'logic.loop', { items: '{{trigger.items}}', max: 100 }), ...body],
        [edge('t', 'loop'), edge('loop', 'b0', 'item'), ...body.slice(1).map((n, i) => edge(`b${i}`, n.id))],
      ),
    );
    const res = await runFlowNow(ws, flow.id, { items: Array.from({ length: 100 }, (_, i) => i) });
    expect(res.ok && res.run?.status).toBe('failed');
    expect(res.ok && res.run?.error).toBe('step_limit');
  });
});

describe('Flow: eventos, cadena y webhooks', () => {
  it('el bus de eventos sigue emitiendo webhooks salientes (y no los eventos nuevos)', async () => {
    vi.stubEnv('ALLOW_PRIVATE_WEBHOOKS', 'true');
    const fetchMock = vi.fn(async () => new Response('ok', { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);
    const ws = (await makeUser('hook')).id;
    const hook = await createWebhook(ws, { url: 'http://hooks.test/in', events: ['contact.created'] });
    const contact = await createContact(ws, { email: 'web@hook.test', firstName: 'Web' });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [, init] = fetchMock.mock.calls[0] as unknown as [URL, RequestInit];
    const headers = init.headers as Record<string, string>;
    expect(headers['zerosoft-event']).toBe('contact.created');
    expect(JSON.parse(String(init.body))).toMatchObject({ type: 'contact.created', data: { id: contact.id, email: 'web@hook.test' } });
    const delivery = (await getDb()
      .prepare('SELECT status FROM webhook_deliveries WHERE webhook_id = ?')
      .get(hook.id)) as { status: string };
    expect(delivery.status).toBe('delivered');

    await emitEvent(ws, 'issue.created', { issue: { id: 'x' } });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('un evento encola los flows habilitados que coinciden (con filtro)', async () => {
    const ws = (await makeUser('ev')).id;
    const other = (await makeUser('ev')).id;
    const graph: FlowGraph = {
      nodes: [
        node('t', 'trigger.event', { event: 'link.clicked', filterPath: 'clicks', filterOp: 'equals', filterValue: '100' }),
        node('s', 'data.set', { fields: [{ key: 'slug', value: '{{trigger.link.slug}}' }] }),
      ],
      edges: [edge('t', 's')],
    };
    const flow = await newFlow(ws, graph, true);
    const disabled = await newFlow(ws, graph, false);
    await emitEvent(ws, 'link.clicked', { link: { slug: 'abc' } }, { extra: { clicks: 99 } });
    expect(await runsOf(flow.id)).toHaveLength(0);
    await emitEvent(ws, 'link.clicked', { link: { slug: 'abc' } }, { extra: { clicks: 100 } });
    // Otro workspace con el mismo evento no dispara este flow.
    await emitEvent(other, 'link.clicked', { link: { slug: 'abc' } }, { extra: { clicks: 100 } });
    expect(await runsOf(flow.id)).toHaveLength(1);
    expect(await runsOf(disabled.id)).toHaveLength(0);
    await processFlowQueue();
    const [run] = await runsOf(flow.id);
    const full = await getRunWithSteps(ws, run.id);
    expect(full?.status).toBe('success');
    expect(full?.steps.find((s) => s.nodeId === 's')?.output).toEqual({ slug: 'abc' });
  });

  it('loop guard: un flow no se vuelve a disparar con sus propios eventos y la cadena tiene tope', async () => {
    const ws = (await makeUser('loop')).id;
    const mk = (suffix: string): FlowGraph => ({
      nodes: [
        node('t', 'trigger.event', { event: 'contact.created' }),
        node('c', 'app.crm_contact', { email: `${suffix}-{{run.id}}@loop.test`, firstName: suffix }),
      ],
      edges: [edge('t', 'c')],
    });
    const a = await newFlow(ws, mk('a'), true);
    const b = await newFlow(ws, mk('b'), true);
    await createContact(ws, { email: 'seed@loop.test' });
    for (let i = 0; i < 6; i++) await processFlowQueue();
    const runsA = await runsOf(a.id);
    const runsB = await runsOf(b.id);
    // Raíz: A y B. A crea un contacto → dispara B (no A). B → dispara A. Ahí se corta.
    expect(runsA).toHaveLength(2);
    expect(runsB).toHaveLength(2);
    expect(Math.max(...[...runsA, ...runsB].map((r) => r.chain_depth))).toBe(1);
    expect([...runsA, ...runsB].every((r) => r.status === 'success')).toBe(true);

    const deep = await flowChain.run({ depth: 3, seen: [] }, () =>
      enqueueEventRuns(ws, 'contact.created', { id: 'x' }),
    );
    expect(deep).toEqual([]);
  });

  it('webhook entrante: autentica por token, respeta enabled y responde 202', async () => {
    const ws = (await makeUser('wh')).id;
    const graph: FlowGraph = {
      nodes: [
        node('hook', 'trigger.webhook'),
        node('c', 'data.set', { fields: [{ key: 'email', value: '{{trigger.body.email}}' }] }),
      ],
      edges: [edge('hook', 'c')],
    };
    const flow = await newFlow(ws, graph, false);
    const [{ token }] = await listFlowWebhooks(ws, flow.id);
    expect(token).toMatch(/^fh_/);
    const post = (t: string) =>
      hookRoute.POST(
        new NextRequest(`http://localhost/api/flow/hooks/${t}?src=test`, {
          method: 'POST',
          headers: { 'content-type': 'application/json', cookie: 'secret=1' },
          body: JSON.stringify({ email: 'in@hook.test' }),
        }),
        { params: Promise.resolve({ token: t }) },
      );

    expect((await post(token)).status).toBe(404); // apagado
    await updateFlow(ws, flow.id, { enabled: true });
    expect((await post('fh_' + 'x'.repeat(32))).status).toBe(404);
    const ok = await post(token);
    expect(ok.status).toBe(202);
    const { runId } = (await ok.json()) as { runId: string };
    await processFlowQueue();
    const run = await getRunWithSteps(ws, runId);
    expect(run?.status).toBe('success');
    expect(run?.input).toMatchObject({ body: { email: 'in@hook.test' }, query: { src: 'test' } });
    expect((run?.input as { headers: Record<string, string> }).headers.cookie).toBeUndefined();
    expect(run?.steps.find((s) => s.nodeId === 'c')?.output).toEqual({ email: 'in@hook.test' });

    // El token se conserva al editar y se borra si se quita el nodo.
    await updateFlow(ws, flow.id, { graph });
    expect((await listFlowWebhooks(ws, flow.id))[0].token).toBe(token);
    await updateFlow(ws, flow.id, { graph: manual([], []) });
    expect(await listFlowWebhooks(ws, flow.id)).toEqual([]);
  });

  it('aislamiento: no se lee ni se usa nada de otro workspace', async () => {
    const a = (await makeUser('iso')).id;
    const b = (await makeUser('iso')).id;
    const project = await createProject(b, null, { name: 'Ajeno', color: '#000000' });
    const flow = await newFlow(
      a,
      manual([node('i', 'app.track_issue', { projectId: project.id, title: 'x' })], [edge('t', 'i')]),
    );
    expect(await getFlow(b, flow.id)).toBeNull();
    expect(await runFlowNow(b, flow.id, {})).toEqual({ ok: false, error: 'not_found' });
    const res = await runFlowNow(a, flow.id, {});
    expect(res.ok && res.run?.steps.find((s) => s.nodeId === 'i')?.error).toBe('project_not_found');
    expect(await getRunWithSteps(b, res.ok ? res.run!.id : '')).toBeNull();
  });
});

describe('Flow: worker y schedules', () => {
  it('dos workers concurrentes no ejecutan dos veces la misma corrida', async () => {
    const ws = (await makeUser('lock')).id;
    const flow = await newFlow(ws, manual([node('s', 'data.set', { fields: [{ key: 'a', value: '1' }] })], [edge('t', 's')]));
    const runId = (await enqueueRun({ id: flow.id, user_id: ws }, 'manual', {}))!;
    expect(await claimQueuedRun(runId)).toBe(true);
    expect(await claimQueuedRun(runId)).toBe(false);
    await getDb().prepare("UPDATE flow_runs SET status = 'queued', locked_until = NULL WHERE id = ?").run(runId);

    await Promise.all([processFlowQueue(), processFlowQueue(), processFlowQueue()]);
    const steps = (await getDb().prepare("SELECT * FROM flow_steps WHERE run_id = ? AND node_id = 's'").all(runId)) as unknown[];
    expect(steps).toHaveLength(1);
    expect((await getRunWithSteps(ws, runId))?.status).toBe('success');
  });

  it('calcula la próxima corrida y encola un schedule vencido una sola vez', async () => {
    const from = new Date('2026-03-10T12:00:00Z');
    expect(computeNextRun({ mode: 'daily', time: '09:00', timezone: 'UTC' }, from).toISOString()).toBe('2026-03-11T09:00:00.000Z');
    expect(computeNextRun({ mode: 'daily', time: '13:30', timezone: 'UTC' }, from).toISOString()).toBe('2026-03-10T13:30:00.000Z');
    // Buenos Aires = UTC-3.
    expect(computeNextRun({ mode: 'daily', time: '10:00', timezone: 'America/Argentina/Buenos_Aires' }, from).toISOString()).toBe(
      '2026-03-10T13:00:00.000Z',
    );
    expect(computeNextRun({ mode: 'interval', every: 2, unit: 'hours' }, from).toISOString()).toBe('2026-03-10T14:00:00.000Z');
    expect(computeNextRun({ mode: 'interval', every: 1, unit: 'minutes' }, from).toISOString()).toBe('2026-03-10T12:05:00.000Z');

    const ws = (await makeUser('sched')).id;
    const flow = await newFlow(
      ws,
      {
        nodes: [node('t', 'trigger.schedule', { mode: 'interval', every: 1, unit: 'hours' }), node('s', 'data.set')],
        edges: [edge('t', 's')],
      },
      true,
    );
    expect((await getFlow(ws, flow.id))?.nextRunAt).toBeTruthy();
    await getDb().prepare("UPDATE flow_flows SET next_run_at = '2000-01-01T00:00:00.000Z' WHERE id = ?").run(flow.id);
    const [r1, r2] = await Promise.all([enqueueDueSchedules(), enqueueDueSchedules()]);
    expect(r1.length + r2.length).toBe(1);
    expect(new Date((await getFlow(ws, flow.id))!.nextRunAt!).getTime()).toBeGreaterThan(Date.now());
  });
});

describe('Flow: permisos de la API', () => {
  it('los miembros ven los flows; solo admins/owners crean y editan', async () => {
    const owner = await makeUser('perm');
    const flow = await newFlow(owner.id, manual([], []));
    session.user = { ...owner, role: 'member', actingUser: { id: 'someone' } };
    const list = await flowsRoute.GET();
    expect(list.status).toBe(200);
    expect(((await list.json()) as { canEdit: boolean }).canEdit).toBe(false);
    const create = await flowsRoute.POST(
      new NextRequest('http://localhost/api/flow/flows', { method: 'POST', body: JSON.stringify({ name: 'X' }) }),
    );
    expect(create.status).toBe(403);
    const patch = await flowRoute.PATCH(
      new NextRequest('http://localhost/x', { method: 'PATCH', body: JSON.stringify({ enabled: true }) }),
      { params: Promise.resolve({ id: flow.id }) },
    );
    expect(patch.status).toBe(403);
    const get = await flowRoute.GET(new NextRequest('http://localhost/x'), { params: Promise.resolve({ id: flow.id }) });
    expect(((await get.json()) as { webhooks: unknown[] }).webhooks).toEqual([]);

    session.user = { ...owner, role: 'admin' };
    const created = await flowsRoute.POST(
      new NextRequest('http://localhost/api/flow/flows', {
        method: 'POST',
        body: JSON.stringify({ name: 'From template', template: 'webhookToContact' }),
      }),
    );
    expect(created.status).toBe(201);
    const body = (await created.json()) as { graph: FlowGraph };
    expect(body.graph.nodes.map((n) => n.type)).toContain('app.crm_contact');
    const bad = await flowRoute.PATCH(
      new NextRequest('http://localhost/x', { method: 'PATCH', body: JSON.stringify({ graph: { nodes: [], edges: [] } }) }),
      { params: Promise.resolve({ id: flow.id }) },
    );
    expect(bad.status).toBe(400);
    expect(await bad.json()).toMatchObject({ error: 'no_trigger' });
    session.user = null;
  });
});
