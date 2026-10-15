import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { getDb } from '@/lib/db';
import { createFlow, enqueueRun, getFlowRow, getRunWithSteps, INPUT_TOO_LARGE_KEY, MAX_RUN_INPUT } from '@/lib/flow';
import { runFlowNow } from '@/lib/flow-http';
import { processFlowQueue } from '@/lib/flow-worker';
import type { FlowGraph } from '@/lib/flow-schema';
import { buildRecorderScript, parseRecordedSteps, PASSWORD_PLACEHOLDER } from '@/lib/robots-recorder';
import { makeUser } from './helpers';

beforeEach(() => {
  vi.stubEnv('RATE_LIMIT_DISABLED', 'true');
  vi.stubEnv('FLOW_WORKER_KICK', 'false');
  vi.stubEnv('ALLOW_PRIVATE_WEBHOOKS', 'true');
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

// ---------- helpers ----------

function node(id: string, type: string, config: Record<string, unknown> = {}) {
  return { id, type, position: { x: 0, y: 0 }, config } as FlowGraph['nodes'][number];
}

function edge(source: string, target: string, sourceHandle?: string) {
  return { id: `${source}-${sourceHandle ?? 'out'}-${target}`, source, target, sourceHandle: sourceHandle ?? null };
}

function manual(nodes: FlowGraph['nodes'], edges: FlowGraph['edges']): FlowGraph {
  return { nodes: [node('t', 'trigger.manual', { sample: '{}' }), ...nodes], edges };
}

async function newFlow(ws: string, graph: FlowGraph, name = 'F') {
  const res = await createFlow(ws, ws, { name, graph });
  if (!res.ok) throw new Error(`${res.error} ${res.nodeId ?? ''}`);
  return res.flow;
}

async function runNow(ws: string, flowId: string, input: Record<string, unknown> = {}) {
  const res = await runFlowNow(ws, flowId, input);
  if (!res.ok || !res.run) throw new Error('run failed to start');
  return res.run;
}

type Run = NonNullable<Awaited<ReturnType<typeof getRunWithSteps>>>;

function steps(r: Run | null, id: string) {
  return (r?.steps ?? []).filter((s) => s.nodeId === id);
}

function step(r: Run | null, id: string) {
  return steps(r, id).at(-1);
}

/** Vence los jobs de la corrida y deja que el worker la retome. */
async function resume(ws: string, runId: string) {
  await getDb().prepare("UPDATE flow_jobs SET run_at = '2000-01-01T00:00:00.000Z' WHERE run_id = ?").run(runId);
  await processFlowQueue();
  return getRunWithSteps(ws, runId);
}

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

// ---------- Reintentos + Merge ----------

describe('Flow: Merge con un nodo que se reintenta', () => {
  it('no corre con la salida del error y corre una sola vez cuando el reintento sale bien', async () => {
    let calls = 0;
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => {
        calls += 1;
        return calls === 1 ? json({ error: 'down' }, 503) : json({ ok: true });
      }),
    );
    const ws = (await makeUser('r2-merge')).id;
    const flow = await newFlow(
      ws,
      manual(
        [
          node('a', 'action.http', { method: 'GET', url: 'http://api.test/a', parseJson: true, retries: 2 }),
          node('b', 'data.set', { fields: [{ key: 'y', value: '2' }] }),
          node('m', 'data.merge', { mode: 'merge', fields: [{ key: 'status', value: '{{nodes.a.output.status}}' }] }),
          node('notify', 'data.set', { fields: [{ key: 'got', value: '{{nodes.m.output.status}}' }] }),
        ],
        [edge('t', 'a'), edge('t', 'b'), edge('a', 'm'), edge('b', 'm'), edge('m', 'notify')],
      ),
    );
    const first = await runNow(ws, flow.id);
    expect(first.status).toBe('waiting');
    expect(steps(first, 'm')).toHaveLength(0);
    expect(steps(first, 'notify')).toHaveLength(0);
    // El paso fallido sí muestra la respuesta del error.
    expect(step(first, 'a')?.output).toMatchObject({ status: 503 });

    const done = await resume(ws, first.id);
    expect(done?.status).toBe('success');
    expect(steps(done, 'm')).toHaveLength(1);
    expect(steps(done, 'notify')).toHaveLength(1);
    expect(step(done, 'notify')?.output).toEqual({ got: 200 });
  });

  it('un Esperar conectado a un Merge no lo deja correr antes de tiempo ni dos veces', async () => {
    const ws = (await makeUser('r2-merge-delay')).id;
    const flow = await newFlow(
      ws,
      manual(
        [
          node('wait', 'logic.delay', { amount: 1, unit: 'minutes' }),
          node('b', 'data.set', { fields: [{ key: 'y', value: '2' }] }),
          node('m', 'data.merge', { mode: 'merge', fields: [{ key: 'y', value: '{{nodes.b.output.y}}' }] }),
          node('notify', 'data.set', { fields: [{ key: 'got', value: '{{nodes.m.output.y}}' }] }),
        ],
        [edge('t', 'wait'), edge('t', 'b'), edge('wait', 'm'), edge('b', 'm'), edge('m', 'notify')],
      ),
    );
    const first = await runNow(ws, flow.id);
    expect(first.status).toBe('waiting');
    expect(steps(first, 'm')).toHaveLength(0);

    const done = await resume(ws, first.id);
    expect(done?.status).toBe('success');
    expect(steps(done, 'm')).toHaveLength(1);
    expect(steps(done, 'notify')).toHaveLength(1);
  });

  it('un Merge que ya corrió no vuelve a correr al retomar otra rama', async () => {
    const ws = (await makeUser('r2-merge-once')).id;
    const flow = await newFlow(
      ws,
      manual(
        [
          node('a', 'data.set', { fields: [{ key: 'x', value: '1' }] }),
          node('b', 'data.set', { fields: [{ key: 'y', value: '2' }] }),
          node('m', 'data.merge', { mode: 'merge', fields: [{ key: 'x', value: '{{nodes.a.output.x}}' }] }),
          node('wait', 'logic.delay', { amount: 1, unit: 'minutes' }),
          node('after', 'data.set', { fields: [{ key: 'z', value: '3' }] }),
        ],
        [edge('t', 'a'), edge('t', 'b'), edge('a', 'm'), edge('b', 'm'), edge('t', 'wait'), edge('wait', 'after')],
      ),
    );
    const first = await runNow(ws, flow.id);
    expect(steps(first, 'm')).toHaveLength(1);
    const done = await resume(ws, first.id);
    expect(done?.status).toBe('success');
    expect(steps(done, 'm')).toHaveLength(1);
    expect(step(done, 'after')?.output).toEqual({ z: '3' });
  });
});

// ---------- Contexto persistido ----------

describe('Flow: salidas grandes después de una espera', () => {
  it('un Loop después de Esperar lee la salida completa de un HTTP de más de 64 KB', async () => {
    const items = Array.from({ length: 300 }, (_, i) => ({ id: i, text: 'x'.repeat(300) }));
    vi.stubGlobal('fetch', vi.fn(async () => json({ items })));
    const ws = (await makeUser('r2-big')).id;
    const flow = await newFlow(
      ws,
      manual(
        [
          node('http', 'action.http', { method: 'GET', url: 'http://api.test/items', parseJson: true }),
          node('wait', 'logic.delay', { amount: 1, unit: 'minutes' }),
          node('loop', 'logic.loop', { items: '{{nodes.http.output.body.items}}', max: 1 }),
        ],
        [edge('t', 'http'), edge('http', 'wait'), edge('wait', 'loop')],
      ),
    );
    const first = await runNow(ws, flow.id);
    expect(first.status).toBe('waiting');
    const done = await resume(ws, first.id);
    expect(done?.status).toBe('success');
    expect(step(done, 'loop')?.output).toMatchObject({ count: 1, total: 300 });
  });

  it('si la salida no entró al persistirse, el nodo que la lee falla con context_truncated', async () => {
    const ws = (await makeUser('r2-huge')).id;
    const flow = await newFlow(
      ws,
      manual(
        [
          node('big', 'data.set', { fields: [{ key: 'v', value: '{{trigger.blob}}' }] }),
          node('wait', 'logic.delay', { amount: 1, unit: 'minutes' }),
          node('use', 'data.set', { fields: [{ key: 'v', value: '{{nodes.big.output.v}}' }] }),
          node('loop', 'logic.loop', { items: "{{nodes['big'].output.v}}" }),
        ],
        [edge('t', 'big'), edge('big', 'wait'), edge('wait', 'use'), edge('wait', 'loop')],
      ),
    );
    const first = await runNow(ws, flow.id, { blob: 'y'.repeat(1_200_000) });
    expect(first.status).toBe('waiting');
    const done = await resume(ws, first.id);
    expect(done?.status).toBe('failed');
    expect(step(done, 'use')?.error).toBe('context_truncated');
  });
});

// ---------- Input de la corrida ----------

describe('Flow: input grande', () => {
  it('un webhook de más de 200 KB llega completo al trigger', async () => {
    const ws = (await makeUser('r2-input')).id;
    const flow = await newFlow(ws, manual([node('loop', 'logic.loop', { items: '{{trigger.body.items}}', max: 1 })], [edge('t', 'loop')]));
    const items = Array.from({ length: 300 }, (_, i) => ({ id: i, text: 'z'.repeat(700) }));
    const runId = await enqueueRun((await getFlowRow(ws, flow.id))!, 'webhook', { method: 'POST', body: { items }, query: {}, headers: {} });
    expect(runId).toBeTruthy();
    await processFlowQueue();
    const r = await getRunWithSteps(ws, runId!);
    expect(r?.status).toBe('success');
    expect(step(r, 'loop')?.output).toMatchObject({ total: 300 });
  });

  it('si el input no entra, la corrida falla con input_too_large en vez de arrancar vacía', async () => {
    const ws = (await makeUser('r2-input-big')).id;
    const flow = await newFlow(ws, manual([node('use', 'data.set', { fields: [{ key: 'v', value: 'ran' }] })], [edge('t', 'use')]));
    const runId = await enqueueRun((await getFlowRow(ws, flow.id))!, 'webhook', { body: 'q'.repeat(MAX_RUN_INPUT + 10) });
    const row = (await getDb().prepare('SELECT input FROM flow_runs WHERE id = ?').get(runId)) as { input: string };
    expect(JSON.parse(row.input)).toHaveProperty(INPUT_TOO_LARGE_KEY);
    await processFlowQueue();
    const r = await getRunWithSteps(ws, runId!);
    expect(r?.status).toBe('failed');
    expect(r?.error).toBe('input_too_large');
    expect(steps(r, 'use')).toHaveLength(0);
  });
});

// ---------- Sub-flow en espera ----------

describe('Flow: Ejecutar flow con un sub-flow que espera', () => {
  it('falla con subflow_waiting y cancela el sub-flow (no sigue solo más tarde)', async () => {
    const ws = (await makeUser('r2-sub')).id;
    const child = await newFlow(
      ws,
      manual(
        [node('wait', 'logic.delay', { amount: 1, unit: 'hours' }), node('late', 'data.set', { fields: [{ key: 'v', value: '1' }] })],
        [edge('t', 'wait'), edge('wait', 'late')],
      ),
      'Child',
    );
    const parent = await newFlow(
      ws,
      manual(
        [
          node('call', 'logic.run_flow', { flowId: child.id }),
          node('use', 'data.set', { fields: [{ key: 'v', value: '{{nodes.call.output.status}}' }] }),
        ],
        [edge('t', 'call'), edge('call', 'use')],
      ),
      'Parent',
    );
    const r = await runNow(ws, parent.id);
    expect(r.status).toBe('failed');
    expect(step(r, 'call')?.error).toBe('subflow_waiting');
    expect(steps(r, 'use')).toHaveLength(0);
    const sub = (await getDb().prepare('SELECT id, status, error FROM flow_runs WHERE flow_id = ?').get(child.id)) as {
      id: string;
      status: string;
      error: string;
    };
    expect(sub).toMatchObject({ status: 'failed', error: 'subflow_waiting' });
    expect(await getDb().prepare('SELECT 1 FROM flow_jobs WHERE run_id = ?').get(sub.id)).toBeUndefined();
  });
});

// ---------- Grabador ----------

interface FakeEl {
  nodeType: number;
  tagName: string;
  id: string;
  type: string;
  value: string;
  parentElement: null;
  innerText: string;
  getAttribute: (a: string) => string | null;
}

function loadRecorder() {
  const store = new Map<string, string>();
  const handlers: Record<string, (e: unknown) => void> = {};
  const stub = () => ({ textContent: '', addEventListener: () => {} });
  const host = {
    setAttribute: () => {},
    style: {} as Record<string, string>,
    contains: () => false,
    attachShadow: () => ({ innerHTML: '', querySelector: stub }),
  };
  const document = {
    addEventListener: (type: string, fn: (e: unknown) => void) => {
      handlers[type] = fn;
    },
    createElement: () => host,
    querySelectorAll: () => [1],
    documentElement: { appendChild: () => {} },
  };
  const sessionStorage = { getItem: (k: string) => store.get(k) ?? null, setItem: (k: string, v: string) => store.set(k, v) };
  const script = buildRecorderScript({ recording: 'R', steps: 's', copy: 'c', copied: 'd', clear: 'x', close: 'q', hint: 'h' });
  new Function('window', 'document', 'sessionStorage', 'location', 'navigator', script)(
    {},
    document,
    sessionStorage,
    { href: 'https://app.example.com/login' },
    {},
  );
  const steps = () => (JSON.parse(store.get('zerosoft-robot-recorder') ?? '{}') as { steps: Array<Record<string, unknown>> }).steps;
  return { handlers, steps };
}

function input(id: string, type: string, value: string): FakeEl {
  return {
    nodeType: 1,
    tagName: 'INPUT',
    id,
    type,
    value,
    parentElement: null,
    innerText: '',
    getAttribute: (a) => (a === 'type' ? type : null),
  };
}

describe('Robots: grabador con Enter', () => {
  it('Enter graba fill + press y el change que sigue no agrega otro fill', () => {
    const { handlers, steps } = loadRecorder();
    const user = input('user', 'text', 'ada');
    const pass = input('pass', 'password', 'secret');
    handlers.change({ target: user });
    handlers.keydown({ key: 'Enter', target: pass });
    handlers.change({ target: pass });
    expect(steps().map((s) => s.type)).toEqual(['goto', 'fill', 'fill', 'press']);
    expect(steps()[2]).toMatchObject({ value: PASSWORD_PLACEHOLDER });
    // Si después cambia el valor, sí se graba.
    const q = input('q', 'search', 'shoes');
    handlers.keydown({ key: 'Enter', target: q });
    handlers.change({ target: q });
    q.value = 'boots';
    handlers.change({ target: q });
    expect(steps().map((s) => s.type)).toEqual(['goto', 'fill', 'fill', 'press', 'fill', 'press', 'fill']);
    expect(steps().at(-1)).toMatchObject({ value: 'boots' });
  });

  it('al pegar una grabación vieja con fill → Enter → mismo fill se descarta el último', () => {
    const res = parseRecordedSteps(
      JSON.stringify({
        steps: [
          { type: 'fill', selector: '#q', value: 'shoes' },
          { type: 'press', key: 'Enter', selector: '#q' },
          { type: 'fill', selector: '#q', value: 'shoes' },
          { type: 'fill', selector: '#q', value: 'boots' },
        ],
      }),
    );
    expect(res.ok && res.steps.map((s) => s.type)).toEqual(['fill', 'press', 'fill']);
    expect(res.ok && res.steps[2]).toMatchObject({ value: 'boots' });
  });
});
