import { createHmac } from 'node:crypto';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { getDb } from '@/lib/db';
import { createFlow, enqueueWebhookRun, getFlowRow, getRunWithSteps, listFlowWebhooks, updateFlow } from '@/lib/flow';
import { createCredential } from '@/lib/flow-credentials';
import { runFlowNow } from '@/lib/flow-http';
import type { FlowGraph } from '@/lib/flow-schema';
import { renderString } from '@/lib/flow-template';
import { createRobot, getRobotRow, updateRobot } from '@/lib/robots';
import { makeUser } from './helpers';

beforeEach(() => {
  vi.stubEnv('RATE_LIMIT_DISABLED', 'true');
  vi.stubEnv('FLOW_WORKER_KICK', 'false');
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

// ---------- Merge dentro de un Loop ----------

describe('Flow: Merge dentro de un Loop', () => {
  it('cada iteración combina solo las salidas de esa iteración', async () => {
    const ws = (await makeUser('r3-loop-merge')).id;
    const flow = await newFlow(
      ws,
      manual(
        [
          node('loop', 'logic.loop', { items: '{{trigger.items}}' }),
          node('a', 'data.set', { fields: [{ key: 'v', value: 'a{{loop.item}}' }] }),
          node('b', 'data.set', { fields: [{ key: 'v', value: 'b{{loop.item}}' }] }),
          node('m', 'data.merge', { mode: 'merge', fields: [{ key: 'pair', value: '{{nodes.a.output.v}}-{{nodes.b.output.v}}' }] }),
        ],
        [edge('t', 'loop'), edge('loop', 'a', 'item'), edge('loop', 'b', 'item'), edge('a', 'm'), edge('b', 'm')],
      ),
    );
    const r = await runNow(ws, flow.id, { items: [1, 2, 3] });
    expect(r.status).toBe('success');
    expect(steps(r, 'm').map((s) => (s.output as { pair: string }).pair)).toEqual(['a1-b1', 'a2-b2', 'a3-b3']);
  });
});

// ---------- Tope de pasos con Loops ----------

describe('Flow: tope de pasos con Loops', () => {
  it('un Loop con el máximo por defecto y 4 nodos en el cuerpo termina entero', async () => {
    const ws = (await makeUser('r3-steps')).id;
    const body = ['h', 'i', 'j', 'k'].map((id) => node(id, 'data.set', { fields: [{ key: 'i', value: '{{loop.index}}' }] }));
    const flow = await newFlow(
      ws,
      manual(
        [node('loop', 'logic.loop', { items: '{{trigger.items}}' }), ...body],
        [edge('t', 'loop'), edge('loop', 'h', 'item'), edge('h', 'i'), edge('i', 'j'), edge('j', 'k')],
      ),
    );
    const r = await runNow(ws, flow.id, { items: Array.from({ length: 50 }, (_, i) => i) });
    expect(r.status).toBe('success');
    expect(steps(r, 'k')).toHaveLength(50);
  });

  it('si el Loop no entra en el techo, falla antes de correr ningún ítem', async () => {
    const ws = (await makeUser('r3-steps-cap')).id;
    const body = Array.from({ length: 10 }, (_, i) => node(`b${i}`, 'data.set'));
    const flow = await newFlow(
      ws,
      manual(
        [node('loop', 'logic.loop', { items: '{{trigger.items}}', max: 100 }), ...body],
        [edge('t', 'loop'), edge('loop', 'b0', 'item'), ...body.slice(1).map((n, i) => edge(`b${i}`, n.id))],
      ),
    );
    const r = await runNow(ws, flow.id, { items: Array.from({ length: 100 }, (_, i) => i) });
    expect(r.status).toBe('failed');
    expect(r.error).toBe('step_limit');
    expect(steps(r, 'b0')).toHaveLength(0);
  });
});

// ---------- Cuota de emails ----------

describe('Flow: cuota diaria del nodo Email', () => {
  it('pasada la cuota del workspace, el nodo falla con email_quota', async () => {
    vi.stubEnv('RATE_LIMIT_DISABLED', 'false');
    vi.stubEnv('FLOW_EMAILS_PER_DAY', '2');
    vi.stubEnv('RESEND_API_KEY', '');
    vi.spyOn(console, 'log').mockImplementation(() => {});
    const ws = (await makeUser('r3-email')).id;
    const flow = await newFlow(
      ws,
      manual(
        [
          node('loop', 'logic.loop', { items: '{{trigger.to}}' }),
          node('mail', 'action.email', { to: '{{loop.item}}', subject: 'Hola', body: 'x' }),
        ],
        [edge('t', 'loop'), edge('loop', 'mail', 'item')],
      ),
    );
    const r = await runNow(ws, flow.id, { to: ['a@x.co', 'b@x.co', 'c@x.co'] });
    expect(r.status).toBe('failed');
    const mails = steps(r, 'mail');
    expect(mails.map((s) => s.status)).toEqual(['success', 'success', 'failed']);
    expect(mails[2].error).toBe('email_quota');
  });
});

// ---------- Schedules: guardar no posterga la próxima corrida ----------

describe('Flow y Robots: guardar sin cambiar el schedule conserva next_run_at', () => {
  it('Flow: el editor manda el grafo entero y no se recalcula si el trigger no cambió', async () => {
    const ws = (await makeUser('r3-sched')).id;
    const graph: FlowGraph = {
      nodes: [node('t', 'trigger.schedule', { mode: 'interval', every: 6, unit: 'hours' }), node('s', 'data.set')],
      edges: [edge('t', 's')],
    };
    const flow = await newFlow(ws, graph);
    await updateFlow(ws, flow.id, { enabled: true });
    const fixed = '2099-01-01T00:00:00.000Z';
    await getDb().prepare('UPDATE flow_flows SET next_run_at = ? WHERE id = ?').run(fixed, flow.id);

    // Mismo trigger (otro orden de claves) y un nodo movido: se conserva.
    const moved: FlowGraph = {
      nodes: [node('t', 'trigger.schedule', { unit: 'hours', every: 6, mode: 'interval' }), { ...node('s', 'data.set'), position: { x: 50, y: 50 } }],
      edges: graph.edges,
    };
    expect((await updateFlow(ws, flow.id, { graph: moved })).ok).toBe(true);
    expect((await getFlowRow(ws, flow.id))?.next_run_at).toBe(fixed);

    // Cambia el intervalo: se recalcula.
    const changed: FlowGraph = { ...moved, nodes: [node('t', 'trigger.schedule', { mode: 'interval', every: 2, unit: 'hours' }), moved.nodes[1]] };
    expect((await updateFlow(ws, flow.id, { graph: changed })).ok).toBe(true);
    expect((await getFlowRow(ws, flow.id))?.next_run_at).not.toBe(fixed);
  });

  it('Robots: el editor manda el schedule en cada guardado y solo se recalcula si cambió', async () => {
    const ws = (await makeUser('r3-robot-sched')).id;
    const created = await createRobot(ws, ws, { name: 'R' });
    if (!created.ok) throw new Error(created.error);
    const schedule = { mode: 'interval' as const, every: 6, unit: 'hours' as const, time: '09:00', timezone: 'UTC' };
    expect((await updateRobot(ws, created.robot.id, { enabled: true, schedule })).ok).toBe(true);
    expect((await getRobotRow(ws, created.robot.id))?.next_run_at).toBeTruthy();
    const fixed = '2099-01-01T00:00:00.000Z';
    await getDb().prepare('UPDATE robots SET next_run_at = ? WHERE id = ?').run(fixed, created.robot.id);

    expect((await updateRobot(ws, created.robot.id, { name: 'R2', enabled: true, schedule: { ...schedule } })).ok).toBe(true);
    expect((await getRobotRow(ws, created.robot.id))?.next_run_at).toBe(fixed);

    expect((await updateRobot(ws, created.robot.id, { enabled: true, schedule: { ...schedule, every: 2 } })).ok).toBe(true);
    expect((await getRobotRow(ws, created.robot.id))?.next_run_at).not.toBe(fixed);
  });
});

// ---------- Stripe: deduplicación por event.id ----------

describe('Flow: trigger de Stripe', () => {
  it('una entrega repetida del mismo evento no vuelve a correr el flow', async () => {
    const ws = (await makeUser('r3-stripe')).id;
    const cred = await createCredential(ws, ws, {
      name: 'stripe',
      type: 'stripe',
      data: { secretKey: 'sk_test_x', webhookSecret: 'whsec_r3' },
    });
    if (!cred.ok) throw new Error(cred.error);
    const flow = await newFlow(ws, {
      nodes: [node('t', 'trigger.stripe', { credentialId: cred.credential.id, events: 'payment_intent.*' }), node('s', 'data.set')],
      edges: [edge('t', 's')],
    });
    await updateFlow(ws, flow.id, { enabled: true });
    const [{ token }] = await listFlowWebhooks(ws, flow.id);
    const deliver = (event: object) => {
      const raw = JSON.stringify(event);
      const ts = Math.floor(Date.now() / 1000);
      const sig = createHmac('sha256', 'whsec_r3').update(`${ts}.${raw}`).digest('hex');
      return enqueueWebhookRun(token, { method: 'POST', body: event, query: {}, headers: {} }, { body: raw, signature: `t=${ts},v1=${sig}` });
    };
    const event = { id: 'evt_r3', type: 'payment_intent.succeeded', data: { object: { id: 'pi_1' } } };
    const first = await deliver(event);
    expect(first).toMatchObject({ ok: true });
    expect(first.ok && first.runId).toBeTruthy();
    expect(await deliver(event)).toEqual({ ok: true, runId: null, ignored: true });
    const other = await deliver({ ...event, id: 'evt_r3_b' });
    expect(other.ok && other.runId).toBeTruthy();
  });
});

// ---------- Plantillas: urlencode ----------

describe('Flow: filtro urlencode', () => {
  it('escapa los datos externos para el path o la query de una URL', () => {
    const ctx = { trigger: { id: '../../admin/users?all=true', name: 'Ana & Co' } };
    expect(renderString('https://api.test/v1/customers/{{trigger.id | urlencode}}', ctx)).toBe(
      'https://api.test/v1/customers/..%2F..%2Fadmin%2Fusers%3Fall%3Dtrue',
    );
    expect(renderString('https://api.test/?q={{trigger.name|urlencode}}', ctx)).toBe('https://api.test/?q=Ana%20%26%20Co');
  });
});
