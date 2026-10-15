import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { getDb } from '@/lib/db';
import { createFlow, enqueueRun, getFlowRow, listFlows, updateFlow } from '@/lib/flow';
import { setFlowCodeRunnerForTests } from '@/lib/flow-code';
import { createCredential } from '@/lib/flow-credentials';
import { runFlowNow } from '@/lib/flow-http';
import { processFlowQueue } from '@/lib/flow-worker';
import { GMAIL_SEND_SCOPE } from '@/lib/gmail';
import { upsertIntegration } from '@/lib/integrations';
import { createRobot, getRobot, listRobotRuns, listRobots, runDueRobots, startRobotRun, updateRobot } from '@/lib/robots';
import { isPrivateAddress } from '@/lib/robots-interpreter';
import { setRobotBackendForTests, type RobotBackend, type RobotJob } from '@/lib/robots-runner';
import { runInSandbox } from '@/lib/robots-sandbox';
import { MAX_TIMEOUT_SEC } from '@/lib/robots-schema';
import type { FlowGraph } from '@/lib/flow-schema';
import { addMember, createTeam, removeMember } from '@/lib/teams';
import { makeUser } from './helpers';

const sandbox = vi.hoisted(() => ({ create: null as null | ((params: Record<string, unknown>) => Promise<unknown>) }));
vi.mock('@vercel/sandbox', () => ({
  Sandbox: { create: (params: Record<string, unknown>) => sandbox.create!(params) },
}));

beforeEach(() => {
  vi.stubEnv('RATE_LIMIT_DISABLED', 'true');
  vi.stubEnv('FLOW_WORKER_KICK', 'false');
  vi.stubEnv('ALLOW_PRIVATE_WEBHOOKS', 'true');
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  setFlowCodeRunnerForTests(undefined);
  setRobotBackendForTests(undefined);
  sandbox.create = null;
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

async function newFlow(ws: string, graph: FlowGraph, actor = ws) {
  const res = await createFlow(ws, actor, { name: 'F', graph });
  if (!res.ok) throw new Error(`${res.error} ${res.nodeId ?? ''}`);
  return res.flow;
}

async function runNow(ws: string, flowId: string, input: Record<string, unknown> = {}) {
  const res = await runFlowNow(ws, flowId, input);
  if (!res.ok || !res.run) throw new Error('run failed to start');
  return res.run;
}

function step(r: { steps: Array<{ nodeId: string }> } | null, id: string) {
  return (r?.steps ?? []).filter((s) => s.nodeId === id).at(-1) as
    | { nodeId: string; status: string; output: unknown; error: string | null }
    | undefined;
}

function mockFetch(handler: (url: string, init: RequestInit) => Response) {
  const calls: Array<{ url: string; init: RequestInit }> = [];
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: unknown, init: RequestInit = {}) => {
      const url = String(input instanceof URL ? input.href : input);
      calls.push({ url, init });
      return handler(url, init);
    }),
  );
  return calls;
}

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

async function connectGmail(userId: string, email: string) {
  await upsertIntegration({
    userId,
    provider: 'gmail',
    email,
    accessToken: `token-${userId}`,
    refreshToken: '',
    expiresAt: Date.now() + 3_600_000,
    scope: GMAIL_SEND_SCOPE,
  });
}

function stubBackend(onRun?: (job: RobotJob) => void): RobotBackend {
  return {
    name: 'local',
    async run(job) {
      onRun?.(job);
      return { status: 'success', error: null, vars: {}, logs: [], screenshots: [], pages: 1 };
    },
  };
}

async function robotFor(ws: string, patch: Parameters<typeof updateRobot>[2] = {}) {
  const r = await createRobot(ws, ws, { name: 'R' });
  if (!r.ok) throw new Error(r.error);
  if (Object.keys(patch).length) await updateRobot(ws, r.robot.id, patch);
  return r.robot.id;
}

// ---------- Gmail: remitente ----------

describe('Flow: remitente del nodo Gmail', () => {
  const mailGraph = (body = 'Hola') =>
    manual([node('mail', 'app.gmail', { to: 'ada@example.com', subject: 'Hi', body })], [edge('t', 'mail')]);

  it('no envía desde la casilla de quien creó el flow si ya no es miembro del workspace', async () => {
    const owner = (await makeUser('gm-owner')).id;
    const alice = (await makeUser('gm-alice')).id;
    const team = await createTeam(owner, 'Team');
    await addMember(team.id, alice, 'admin');
    await connectGmail(alice, 'alice@company.test');
    const flow = await newFlow(owner, mailGraph(), alice);

    const calls = mockFetch(() => json({ id: 'm1', threadId: 't1' }));
    const ok = await runNow(owner, flow.id);
    expect(ok.status).toBe('success');
    expect(step(ok, 'mail')?.output).toMatchObject({ from: 'alice@company.test' });

    await removeMember(team.id, alice);
    const before = calls.length;
    const off = await runNow(owner, flow.id);
    expect(step(off, 'mail')?.error).toBe('gmail_not_connected');
    expect(calls.length).toBe(before);
  });

  it('si otra persona cambia el nodo Gmail, el remitente pasa a ser ella (nunca la casilla ajena)', async () => {
    const owner = (await makeUser('gm-owner2')).id;
    const alice = (await makeUser('gm-alice2')).id;
    const bob = (await makeUser('gm-bob2')).id;
    const team = await createTeam(owner, 'Team');
    await addMember(team.id, alice, 'admin');
    await addMember(team.id, bob, 'admin');
    await connectGmail(alice, 'alice@company.test');
    const flow = await newFlow(owner, mailGraph(), alice);

    // Cambiar algo que no es el nodo Gmail no cambia el remitente.
    await updateFlow(owner, flow.id, { name: 'Renombrado' }, bob);
    expect((await getFlowRow(owner, flow.id))?.created_by).toBe(alice);

    const res = await updateFlow(owner, flow.id, { graph: mailGraph('Otro mensaje') }, bob);
    expect(res.ok).toBe(true);
    expect((await getFlowRow(owner, flow.id))?.created_by).toBe(bob);

    const calls = mockFetch(() => json({ id: 'm1', threadId: 't1' }));
    const r = await runNow(owner, flow.id);
    // Bob no tiene Gmail: falla en vez de usar la casilla de Alicia.
    expect(step(r, 'mail')?.error).toBe('gmail_not_connected');
    expect(calls.length).toBe(0);
  });
});

// ---------- Contexto en memoria ----------

describe('Flow: contexto de la corrida sin truncar en memoria', () => {
  const bigRows = Array.from({ length: 1000 }, (_, i) => ({ id: i, email: `lead${i}@example.com`, note: 'x'.repeat(80) }));

  it('un Loop recorre una salida de más de 64 KB', async () => {
    const ws = (await makeUser('bigctx')).id;
    mockFetch(() => json({ rows: bigRows }));
    const flow = await newFlow(
      ws,
      manual(
        [
          node('get', 'action.http', { method: 'GET', url: 'https://api.example.com/rows' }),
          node('loop', 'logic.loop', { items: '{{nodes.get.output.body.rows}}', max: 100 }),
          node('set', 'data.set', { fields: [{ key: 'email', value: '{{loop.item.email}}' }] }),
        ],
        [edge('t', 'get'), edge('get', 'loop'), edge('loop', 'set', 'item')],
      ),
    );
    const r = await runNow(ws, flow.id);
    expect(r.status).toBe('success');
    expect(step(r, 'loop')?.output).toMatchObject({ count: 100, total: 1000 });
    expect(step(r, 'set')?.output).toEqual({ email: 'lead99@example.com' });
    // Lo que se guarda en la base sí queda acotado.
    expect(step(r, 'get')?.output).toMatchObject({ truncated: true });
  });

  it('el nodo Código recibe el contexto completo', async () => {
    const ws = (await makeUser('bigcode')).id;
    mockFetch(() => json({ rows: bigRows }));
    let input: unknown = null;
    setFlowCodeRunnerForTests(async (job) => {
      input = job.input;
      return { ok: true, result: null, logs: '' };
    });
    const flow = await newFlow(
      ws,
      manual(
        [node('get', 'action.http', { method: 'GET', url: 'https://api.example.com/rows' }), node('code', 'data.code', { code: 'return 1' })],
        [edge('t', 'get'), edge('get', 'code')],
      ),
    );
    const r = await runNow(ws, flow.id);
    expect(r.status).toBe('success');
    const nodes = (input as { nodes?: Record<string, { output: { body: { rows: unknown[] } } }> }).nodes;
    expect(nodes?.get.output.body.rows).toHaveLength(1000);
  });
});

// ---------- Stripe dentro de un Loop ----------

describe('Flow: Stripe dentro de un Loop', () => {
  it('cada iteración usa su propia clave de idempotencia', async () => {
    const ws = (await makeUser('stripeloop')).id;
    const cred = await createCredential(ws, ws, { name: 'stripe', type: 'stripe', data: { secretKey: 'sk_test_x' } });
    if (!cred.ok) throw new Error(cred.error);
    const calls = mockFetch(() => json({ id: 'cus_1' }));
    const flow = await newFlow(
      ws,
      manual(
        [
          node('loop', 'logic.loop', { items: '["a@example.com","b@example.com"]' }),
          node('cust', 'app.stripe', { credentialId: cred.credential.id, email: '{{loop.item}}' }),
        ],
        [edge('t', 'loop'), edge('loop', 'cust', 'item')],
      ),
    );
    const r = await runNow(ws, flow.id);
    expect(r.status).toBe('success');
    const keys = calls.map((c) => (c.init.headers as Record<string, string>)['idempotency-key']);
    expect(keys).toEqual([`${r.id}:cust:0`, `${r.id}:cust:1`]);
  });
});

// ---------- Worker con presupuesto ----------

describe('Flow: cola con presupuesto de tiempo', () => {
  it('sin presupuesto no empieza corridas nuevas (quedan en cola)', async () => {
    const ws = (await makeUser('budget')).id;
    const flow = await newFlow(ws, manual([node('s', 'data.set', { fields: [{ key: 'a', value: '1' }] })], [edge('t', 's')]));
    const row = (await getFlowRow(ws, flow.id))!;
    const runId = await enqueueRun(row, 'manual', {});
    expect(runId).toBeTruthy();
    expect((await processFlowQueue({ budgetMs: 0 })).runs).toBe(0);
    const status = (await getDb().prepare('SELECT status FROM flow_runs WHERE id = ?').get(runId)) as { status: string };
    expect(status.status).toBe('queued');
    expect((await processFlowQueue({ budgetMs: 60_000 })).runs).toBeGreaterThanOrEqual(1);
  });
});

// ---------- Listados ----------

describe('Listados de Flows y Robots', () => {
  it('devuelven la última corrida y el conteo de cada ítem', async () => {
    const ws = (await makeUser('lists')).id;
    const a = await newFlow(ws, manual([], []));
    const b = await newFlow(ws, manual([], []));
    const run = await runNow(ws, a.id);
    const flows = await listFlows(ws);
    expect(flows.find((f) => f.id === a.id)?.lastRun).toMatchObject({ id: run.id, status: 'success' });
    expect(flows.find((f) => f.id === b.id)?.lastRun).toBeNull();

    setRobotBackendForTests(stubBackend());
    const r1 = await robotFor(ws);
    const r2 = await robotFor(ws);
    await startRobotRun(ws, r1, {}, { trigger: 'manual' });
    await startRobotRun(ws, r1, {}, { trigger: 'manual' });
    const robots = await listRobots(ws);
    expect(robots.find((r) => r.id === r1)).toMatchObject({ runs7d: 2, lastRun: { status: 'success' } });
    expect(robots.find((r) => r.id === r2)).toMatchObject({ runs7d: 0, lastRun: null });
  });
});

// ---------- Robots ----------

describe('Robots: timeout, schedule y sandbox', () => {
  it('el timeout efectivo deja margen para el maxDuration de 300 s de la ruta', async () => {
    const ws = (await makeUser('rbto')).id;
    const id = await robotFor(ws);
    // Robot viejo guardado con el tope anterior (300 s).
    await getDb().prepare('UPDATE robots SET timeout_sec = 300 WHERE id = ?').run(id);
    let timeout = 0;
    setRobotBackendForTests(stubBackend((j) => (timeout = j.timeoutMs)));
    expect((await startRobotRun(ws, id, {}, { trigger: 'manual' })).ok).toBe(true);
    expect(timeout).toBe(MAX_TIMEOUT_SEC * 1000);
    expect(MAX_TIMEOUT_SEC * 1000 + 45_000).toBeLessThan(300_000 - 60_000);
    expect((await getRobot(ws, id))?.timeoutSec).toBe(MAX_TIMEOUT_SEC);
    // Guardar con el valor viejo sigue funcionando (se acota).
    const res = await updateRobot(ws, id, { timeoutSec: 300 });
    expect(res.ok && res.robot.timeoutSec).toBe(MAX_TIMEOUT_SEC);
  });

  it('una corrida programada que no puede arrancar queda registrada como fallida', async () => {
    const ws = (await makeUser('rbskip')).id;
    const id = await robotFor(ws, { schedule: { mode: 'interval', every: 1, unit: 'hours', time: '09:00', timezone: 'UTC' } });
    await getDb().prepare('UPDATE robots SET next_run_at = ? WHERE id = ?').run(new Date(Date.now() - 1000).toISOString(), id);
    // Otra corrida viva en el workspace: 'busy'.
    await getDb()
      .prepare(
        `INSERT INTO robot_runs (id, robot_id, user_id, status, trigger, locked_until, created_at, started_at)
         VALUES (?, ?, ?, 'running', 'manual', ?, ?, ?)`,
      )
      .run(crypto.randomUUID(), id, ws, new Date(Date.now() + 600_000).toISOString(), new Date().toISOString(), new Date().toISOString());
    setRobotBackendForTests(stubBackend());
    await runDueRobots(new Date());
    const runs = await listRobotRuns(ws, id);
    expect(runs.find((r) => r.trigger === 'schedule')).toMatchObject({ status: 'failed', error: 'busy' });
  });

  it('el filtro de IPs privadas reconoce IPv4 embebidas en hex (como las normaliza new URL)', () => {
    const host = new URL('http://[::ffff:169.254.169.254]/').hostname;
    expect(isPrivateAddress(host)).toBe(true);
    for (const ip of ['::ffff:a9fe:a9fe', '::ffff:7f00:1', '64:ff9b::a00:5', '64:ff9b::10.0.0.5', '::ffff:c0a8:101', 'fe90::1']) {
      expect(isPrivateAddress(ip)).toBe(true);
    }
    for (const ip of ['::ffff:808:808', '2606:4700::1111']) expect(isPrivateAddress(ip)).toBe(false);
  });

  it('el sandbox falla cerrado si no se acepta la política de red', async () => {
    vi.stubEnv('ROBOTS_SANDBOX_SNAPSHOT_ID', 'snap_test');
    const params: Array<Record<string, unknown>> = [];
    sandbox.create = async (p) => {
      params.push(p);
      throw new Error('invalid networkPolicy');
    };
    const res = await runInSandbox({ robotName: 'R', steps: [], inputs: {}, timeoutMs: 10_000 });
    expect(res).toMatchObject({ status: 'failed', error: 'network_policy_unavailable' });
    expect(params.some((p) => p.networkPolicy === 'allow-all')).toBe(false);
  });
});
