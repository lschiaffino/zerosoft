import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { getDb } from '@/lib/db';
import {
  cancelRun,
  createFlow,
  enqueueDueSchedules,
  enqueueRun,
  getFlowRow,
  getRunWithSteps,
  lastOutputs,
  updateFlow,
} from '@/lib/flow';
import { createCredential, getCredential } from '@/lib/flow-credentials';
import { maskSecret } from '@/lib/flow-credentials-schema';
import { runFlowNow } from '@/lib/flow-http';
import { processFlowQueue } from '@/lib/flow-worker';
import type { FlowGraph } from '@/lib/flow-schema';
import { buildRecorderScript, PASSWORD_PLACEHOLDER } from '@/lib/robots-recorder';
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

type Run = NonNullable<Awaited<ReturnType<typeof getRunWithSteps>>>;

function steps(r: Run | null, id: string) {
  return (r?.steps ?? []).filter((s) => s.nodeId === id);
}

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

async function jobsOf(runId: string) {
  return ((await getDb().prepare('SELECT COUNT(*) AS n FROM flow_jobs WHERE run_id = ?').get(runId)) as { n: number }).n;
}

/** Corrida automática (evento) de un flow con Esperar: queda en espera. */
async function waitingEventRun(ws: string) {
  const flow = await newFlow(
    ws,
    manual(
      [node('wait', 'logic.delay', { amount: 3, unit: 'days' }), node('send', 'data.set', { fields: [{ key: 'msg', value: 'oferta' }] })],
      [edge('t', 'wait'), edge('wait', 'send')],
    ),
  );
  await updateFlow(ws, flow.id, { enabled: true });
  const runId = await enqueueRun((await getFlowRow(ws, flow.id))!, 'trigger.event', { deal: 1 });
  await processFlowQueue();
  const run = await getRunWithSteps(ws, runId!);
  expect(run?.status).toBe('waiting');
  return { flow, runId: runId! };
}

// ---------- Reintentos dentro de un Loop ----------

describe('Flow: reintentos dentro de un Loop', () => {
  it('un 503 en un ítem se reintenta en línea y la corrida sigue', async () => {
    let calls = 0;
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => {
        calls += 1;
        return calls === 2 ? json({ error: 'busy' }, 503) : json({ ok: true });
      }),
    );
    const ws = (await makeUser('r4-loop-retry')).id;
    const flow = await newFlow(
      ws,
      manual(
        [
          node('loop', 'logic.loop', { items: '{{trigger.items}}' }),
          node('a', 'action.http', { method: 'GET', url: 'http://api.test/a', parseJson: true, retries: 2 }),
        ],
        [edge('t', 'loop'), edge('loop', 'a', 'item')],
      ),
    );
    const res = await runFlowNow(ws, flow.id, { items: [1, 2, 3] });
    const r = res.ok ? res.run : null;
    expect(r?.status).toBe('success');
    expect(steps(r, 'a').map((s) => s.status)).toEqual(['success', 'failed', 'success', 'success']);
    expect(steps(r, 'a')[1].error).toContain('retry 1/2');
    expect(await jobsOf(r!.id)).toBe(0);
  });

  it('sin reintentos configurados, el error dentro del Loop corta la corrida como antes', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => json({ error: 'busy' }, 503)));
    const ws = (await makeUser('r4-loop-noretry')).id;
    const flow = await newFlow(
      ws,
      manual(
        [node('loop', 'logic.loop', { items: '{{trigger.items}}' }), node('a', 'action.http', { method: 'GET', url: 'http://api.test/a' })],
        [edge('t', 'loop'), edge('loop', 'a', 'item')],
      ),
    );
    const res = await runFlowNow(ws, flow.id, { items: [1, 2] });
    const r = res.ok ? res.run : null;
    expect(r?.status).toBe('failed');
    expect(steps(r, 'a')).toHaveLength(1);
  });
});

// ---------- Apagar el flow / cancelar corridas ----------

describe('Flow: corridas pendientes de un flow apagado', () => {
  it('al apagar el flow, la corrida en espera no sigue cuando vence el Esperar', async () => {
    const ws = (await makeUser('r4-disabled-wait')).id;
    const { flow, runId } = await waitingEventRun(ws);
    await updateFlow(ws, flow.id, { enabled: false });
    await getDb().prepare("UPDATE flow_jobs SET run_at = '2000-01-01T00:00:00.000Z' WHERE run_id = ?").run(runId);
    await processFlowQueue();
    const run = await getRunWithSteps(ws, runId);
    expect(run?.status).toBe('failed');
    expect(run?.error).toBe('flow_disabled');
    expect(steps(run, 'send')).toHaveLength(0);
    expect(await jobsOf(runId)).toBe(0);
  });

  it('una corrida automática en cola de un flow apagado no arranca', async () => {
    const ws = (await makeUser('r4-disabled-queued')).id;
    const flow = await newFlow(ws, manual([node('s', 'data.set', { fields: [{ key: 'x', value: '1' }] })], [edge('t', 's')]));
    const runId = await enqueueRun((await getFlowRow(ws, flow.id))!, 'trigger.webhook', {});
    await processFlowQueue();
    const run = await getRunWithSteps(ws, runId!);
    expect(run?.status).toBe('failed');
    expect(run?.error).toBe('flow_disabled');
    expect(run?.steps).toHaveLength(0);
  });

  it('la prueba manual de un flow apagado sí corre', async () => {
    const ws = (await makeUser('r4-disabled-manual')).id;
    const flow = await newFlow(ws, manual([node('s', 'data.set', { fields: [{ key: 'x', value: '1' }] })], [edge('t', 's')]));
    const res = await runFlowNow(ws, flow.id, {});
    expect(res.ok && res.run?.status).toBe('success');
  });

  it('cancelRun corta una corrida en espera y borra sus jobs; no toca otro workspace ni corridas terminadas', async () => {
    const ws = (await makeUser('r4-cancel')).id;
    const other = (await makeUser('r4-cancel-other')).id;
    const { runId } = await waitingEventRun(ws);
    expect(await cancelRun(other, runId)).toEqual({ ok: false, error: 'not_found' });
    expect(await cancelRun(ws, runId)).toEqual({ ok: true });
    const run = await getRunWithSteps(ws, runId);
    expect(run?.status).toBe('failed');
    expect(run?.error).toBe('cancelled');
    expect(await jobsOf(runId)).toBe(0);
    expect(await cancelRun(ws, runId)).toEqual({ ok: false, error: 'run_not_cancellable' });
  });
});

// ---------- Tope de corridas: schedules visibles ----------

describe('Flow: schedule salteado por el tope de corridas', () => {
  it('queda una corrida fallida con rate_limited en el historial', async () => {
    vi.stubEnv('RATE_LIMIT_DISABLED', 'false');
    vi.stubEnv('FLOW_RUNS_PER_HOUR', '1');
    const ws = (await makeUser('r4-sched-rl')).id;
    const flow = await newFlow(ws, {
      nodes: [node('t', 'trigger.schedule', { mode: 'interval', every: 1, unit: 'hours' }), node('s', 'data.set')],
      edges: [edge('t', 's')],
    });
    await updateFlow(ws, flow.id, { enabled: true });
    // Otra fuente ya gastó el cupo del workspace.
    expect(await enqueueRun((await getFlowRow(ws, flow.id))!, 'trigger.webhook', {})).not.toBeNull();
    await getDb().prepare("UPDATE flow_flows SET next_run_at = '2000-01-01T00:00:00.000Z' WHERE id = ?").run(flow.id);
    expect(await enqueueDueSchedules(new Date())).toEqual([]);
    const rows = (await getDb()
      .prepare("SELECT status, error FROM flow_runs WHERE flow_id = ? AND trigger_type = 'trigger.schedule'")
      .all(flow.id)) as Array<{ status: string; error: string }>;
    expect(rows).toEqual([{ status: 'failed', error: 'rate_limited' }]);
  });
});

// ---------- Últimas salidas ----------

describe('Flow: lastOutputs', () => {
  it('devuelve la última salida de cada nodo (también dentro de un Loop)', async () => {
    const ws = (await makeUser('r4-last')).id;
    const flow = await newFlow(
      ws,
      manual(
        [node('loop', 'logic.loop', { items: '{{trigger.items}}' }), node('a', 'data.set', { fields: [{ key: 'v', value: '{{loop.item}}' }] })],
        [edge('t', 'loop'), edge('loop', 'a', 'item')],
      ),
    );
    await runFlowNow(ws, flow.id, { items: [1, 2, 3] });
    const out = await lastOutputs(ws, flow.id);
    expect(out.a).toEqual({ v: 3 });
    expect(out.loop).toMatchObject({ count: 3 });
  });
});

// ---------- Pista de credenciales ----------

describe('Flow: pista de credenciales', () => {
  it('una contraseña no deja ver su final', async () => {
    const ws = (await makeUser('r4-hint')).id;
    const res = await createCredential(ws, ws, { name: 'portal', type: 'basic', data: { username: '20-12345678-9', password: 'Tucuman2024' } });
    if (!res.ok) throw new Error(res.error);
    expect(res.credential.hint).toBe('••••');
    expect(JSON.stringify(res.credential)).not.toContain('2024');
  });

  it('las pistas guardadas antes se recalculan al leer', async () => {
    const ws = (await makeUser('r4-hint-old')).id;
    const res = await createCredential(ws, ws, { name: 'portal', type: 'basic', data: { username: 'u', password: 'Tucuman2024' } });
    if (!res.ok) throw new Error(res.error);
    await getDb().prepare("UPDATE flow_credentials SET hint = '••••2024' WHERE id = ?").run(res.credential.id);
    expect((await getCredential(ws, res.credential.id))?.hint).toBe('••••');
  });

  it('solo los tokens largos con prefijo conocido muestran los últimos 4', () => {
    expect(maskSecret('sk_live_abcdef123456')).toBe('••••3456');
    expect(maskSecret('xoxb-1234567890-abcdefghij')).toBe('••••ghij');
    expect(maskSecret('mi-clave-secreta-larga-2024')).toBe('••••');
    expect(maskSecret('sk_short1234')).toBe('••••');
    expect(maskSecret('')).toBe('');
  });
});

// ---------- Grabador: campos secretos ----------

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

function input(id: string, type: string, value: string, attrs: Record<string, string> = {}): FakeEl {
  const el: FakeEl = {
    nodeType: 1,
    tagName: 'INPUT',
    id,
    type,
    value,
    parentElement: null,
    innerText: '',
    getAttribute: (a) => (a === 'type' ? el.type : (attrs[a] ?? null)),
  };
  return el;
}

describe('Robots: el grabador no guarda secretos fuera de type=password', () => {
  it('"mostrar contraseña": el campo que fue password sigue siendo secreto', () => {
    const { handlers, steps } = loadRecorder();
    const pass = input('pass', 'password', '');
    handlers.focusin({ target: pass });
    pass.value = 'MiClave2024';
    pass.type = 'text';
    handlers.change({ target: pass });
    handlers.keydown({ key: 'Enter', target: pass });
    expect(JSON.stringify(steps())).not.toContain('MiClave2024');
    expect(steps()[1]).toMatchObject({ type: 'fill', value: PASSWORD_PLACEHOLDER });
  });

  it('autocomplete de contraseña / OTP y PIN numéricos se graban con el placeholder', () => {
    const { handlers, steps } = loadRecorder();
    handlers.change({ target: input('a', 'text', 'clave1', { autocomplete: 'current-password' }) });
    handlers.change({ target: input('b', 'text', '123456', { autocomplete: 'one-time-code' }) });
    handlers.change({ target: input('pin', 'text', '4321', { inputmode: 'numeric', name: 'pin' }) });
    handlers.change({ target: input('user_pwd', 'text', 'otra') });
    const values = steps().slice(1).map((s) => s.value);
    expect(values).toEqual([PASSWORD_PLACEHOLDER, PASSWORD_PLACEHOLDER, PASSWORD_PLACEHOLDER, PASSWORD_PLACEHOLDER]);
  });

  it('los campos comunes se graban con su valor', () => {
    const { handlers, steps } = loadRecorder();
    handlers.change({ target: input('email', 'email', 'ada@example.com', { name: 'email' }) });
    handlers.change({ target: input('ship', 'text', 'Calle 1', { name: 'shipping_address' }) });
    expect(steps().slice(1).map((s) => s.value)).toEqual(['ada@example.com', 'Calle 1']);
  });
});
