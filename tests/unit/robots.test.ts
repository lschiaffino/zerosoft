import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';
import { getDb } from '@/lib/db';
import { createFlow, getRunWithSteps } from '@/lib/flow';
import { runFlowNow } from '@/lib/flow-http';
import { emitEvent } from '@/lib/events';
import {
  createRobot,
  drainRobotQueue,
  expireQueuedRobotRuns,
  getRobot,
  getUsage,
  listRobotRuns,
  listRobots,
  runDueRobots,
  startRobotRun,
  updateRobot,
} from '@/lib/robots';
import {
  isPrivateAddress,
  robotInterpreter,
  type InterpreterStep,
  type RobotLocator,
  type RobotPage,
} from '@/lib/robots-interpreter';
import { checkRobotUrl, setRobotBackendForTests, type RobotBackend, type RobotJob } from '@/lib/robots-runner';
import { buildRunnerScript } from '@/lib/robots-sandbox';
import { MAX_ROBOT_STEPS, resolveInputs, validateInputDefs, validateSteps, type RobotStep } from '@/lib/robots-schema';
import { makeUser } from './helpers';

const session = vi.hoisted(() => ({ user: null as null | Record<string, unknown> }));
vi.mock('@/lib/session', () => ({ getCurrentUser: async () => session.user }));

const robotsRoute = await import('@/app/api/robots/route');
const robotRoute = await import('@/lib/routes/robots/[id]/route');
const runRoute = await import('@/app/api/robots/run/[id]/route');
const runsRoute = await import('@/lib/routes/robots/[id]/runs/route');

beforeEach(() => {
  vi.stubEnv('RATE_LIMIT_DISABLED', 'true');
  vi.stubEnv('FLOW_WORKER_KICK', 'false');
});

afterEach(() => {
  vi.unstubAllEnvs();
  setRobotBackendForTests(undefined);
  session.user = null;
});

// ---------- Página falsa ----------

interface FakeEl {
  text: string;
  attrs?: Record<string, string>;
  table?: unknown[];
}

function fakePage(dom: Record<string, Record<string, FakeEl[]>>) {
  const actions: string[] = [];
  let current = '';
  const els = (sel: string): FakeEl[] => dom[current]?.[sel] ?? [];
  const makeLoc = (list: () => FakeEl[], label: string): RobotLocator => {
    const loc: RobotLocator = {
      first: () => makeLoc(() => list().slice(0, 1), label),
      count: async () => list().length,
      click: async () => {
        if (!list().length) throw new Error('Timeout 15000ms exceeded');
        actions.push(`click:${label}`);
      },
      fill: async (v) => {
        if (!list().length) throw new Error('Timeout 15000ms exceeded');
        actions.push(`fill:${label}=${v}`);
      },
      selectOption: async (v) => {
        actions.push(`select:${label}=${v}`);
        return [v];
      },
      press: async (k) => {
        actions.push(`press:${label}:${k}`);
      },
      innerText: async () => {
        const e = list()[0];
        if (!e) throw new Error('Timeout 15000ms exceeded');
        return e.text;
      },
      getAttribute: async (n) => list()[0]?.attrs?.[n] ?? null,
      allInnerTexts: async () => list().map((e) => e.text),
      evaluateAll: async <R,>(_fn: (els: Element[], arg: string) => R, arg: string) =>
        list().map((e) => e.attrs?.[arg] ?? '') as unknown as R,
      evaluate: async <R,>() => (list()[0]?.table ?? []) as unknown as R,
      waitFor: async () => {
        if (!list().length) throw new Error('Timeout 15000ms exceeded');
      },
      scrollIntoViewIfNeeded: async () => {
        actions.push(`scroll:${label}`);
      },
    };
    return loc;
  };
  const page: RobotPage = {
    goto: async (url) => {
      current = url;
      actions.push(`goto:${url}`);
      return null;
    },
    url: () => current,
    locator: (sel) => makeLoc(() => els(sel), sel),
    getByText: (text) =>
      makeLoc(
        () =>
          Object.values(dom[current] ?? {})
            .flat()
            .filter((e) => e.text.includes(text)),
        `text=${text}`,
      ),
    keyboard: { press: async (k) => void actions.push(`key:${k}`) },
    waitForTimeout: async (ms) => void actions.push(`wait:${ms}`),
    screenshot: async () => new Uint8Array([1, 2, 3]),
    evaluate: async <R,>() => true as unknown as R,
  };
  return { page, actions };
}

const allowAll = async () => null;
const opts = (extra: Partial<Parameters<typeof robotInterpreter>[3]> = {}) => ({
  deadline: Date.now() + 30_000,
  checkUrl: allowAll,
  ...extra,
});

function steps(list: unknown[]): InterpreterStep[] {
  const v = validateSteps(list);
  if (!v.ok) throw new Error(`invalid: ${v.error} at ${v.index}`);
  return v.steps as unknown as InterpreterStep[];
}

// ---------- Esquema ----------

describe('robots schema', () => {
  it('validates steps and fills defaults', () => {
    const v = validateSteps([{ type: 'goto', url: 'https://a.com' }, { type: 'click', text: 'Go' }]);
    expect(v.ok).toBe(true);
    if (v.ok) expect(v.steps[1]).toEqual({ type: 'click', selector: '', text: 'Go' });
  });

  it('rejects unknown steps, bad names and backward jumps', () => {
    expect(validateSteps([{ type: 'eval', code: 'x' }])).toMatchObject({ ok: false, error: 'invalid_steps', index: 0 });
    expect(validateSteps([{ type: 'extract', selector: 'h1', name: '1bad' }])).toMatchObject({ ok: false, error: 'invalid_steps' });
    expect(
      validateSteps([
        { type: 'goto', url: 'https://a.com' },
        { type: 'if_exists', selector: '.x', onMissing: 'goto', target: 1 },
      ]),
    ).toMatchObject({ ok: false, error: 'invalid_goto_target', index: 1 });
    expect(validateSteps('nope')).toMatchObject({ ok: false, error: 'invalid_steps' });
  });

  it('enforces the 100-step limit counting loop bodies and forbids nested loops', () => {
    const many = Array.from({ length: MAX_ROBOT_STEPS + 1 }, () => ({ type: 'wait', ms: 1 }));
    expect(validateSteps(many)).toMatchObject({ ok: false, error: 'too_many_steps' });
    const loops = Array.from({ length: 6 }, () => ({
      type: 'loop_over',
      list: '{{inputs.urls}}',
      steps: Array.from({ length: 18 }, () => ({ type: 'wait', ms: 1 })),
    }));
    expect(validateSteps(loops)).toMatchObject({ ok: false, error: 'too_many_steps' });
    expect(
      validateSteps([{ type: 'loop_over', list: 'x', steps: [{ type: 'loop_over', list: 'y', steps: [] }] }]),
    ).toMatchObject({ ok: false, error: 'nested_loop' });
  });

  it('validates input definitions and resolves run inputs', () => {
    expect(validateInputDefs([{ name: 'a' }, { name: 'a' }])).toMatchObject({ ok: false, error: 'duplicate_input' });
    const defs = validateInputDefs([
      { name: 'url', required: true },
      { name: 'urls', kind: 'list', default: 'https://a.com\nhttps://b.com' },
    ]);
    expect(defs.ok).toBe(true);
    if (!defs.ok) return;
    expect(resolveInputs(defs.inputs, {})).toEqual({ ok: false, error: 'missing_input', name: 'url' });
    expect(resolveInputs(defs.inputs, { url: 'https://x.com', extra: 1 })).toEqual({
      ok: true,
      inputs: { url: 'https://x.com', urls: ['https://a.com', 'https://b.com'] },
    });
  });
});

// ---------- Intérprete ----------

describe('robot interpreter', () => {
  const dom = {
    'https://shop.test/p/1': {
      h1: [{ text: '  Widget  ' }],
      '.price': [{ text: '$10' }],
      'a.more': [{ text: 'More', attrs: { href: '/more' } }],
      '.item': [{ text: 'A' }, { text: 'B' }],
      'input[name="q"]': [{ text: '' }],
      table: [{ text: '', table: [{ Name: 'A', Qty: '1' }] }],
      button: [{ text: 'Buy now' }],
    },
  };

  it('runs goto/fill/click/extract with templates and collects vars', async () => {
    const { page, actions } = fakePage(dom);
    const res = await robotInterpreter(
      page,
      steps([
        { type: 'goto', url: 'https://shop.test/p/{{inputs.id}}' },
        { type: 'fill', selector: 'input[name="q"]', value: 'hello {{inputs.name | upper}}' },
        { type: 'extract', selector: 'h1', name: 'title' },
        { type: 'extract', selector: '.price', name: 'price' },
        { type: 'extract', selector: 'a.more', name: 'link', mode: 'attribute', attribute: 'href' },
        { type: 'extract', selector: '.item', name: 'items', mode: 'all' },
        { type: 'extract_table', selector: 'table', name: 'rows' },
        { type: 'click', selector: '.missing', text: 'Buy' },
        { type: 'fill', selector: 'input[name="q"]', value: '{{vars.title}}={{vars.price}}' },
        { type: 'screenshot', name: 'shot' },
      ]),
      { id: '1', name: 'ada' },
      opts(),
    );
    expect(res.error).toBeNull();
    expect(res.status).toBe('success');
    expect(res.vars).toEqual({ title: 'Widget', price: '$10', link: '/more', items: ['A', 'B'], rows: [{ Name: 'A', Qty: '1' }] });
    expect(actions).toContain('goto:https://shop.test/p/1');
    expect(actions).toContain('fill:input[name="q"]=hello ADA');
    // Selector sin resultados → texto visible como respaldo.
    expect(actions).toContain('click:text=Buy');
    expect(actions).toContain('fill:input[name="q"]=Widget=$10');
    expect(res.screenshots).toHaveLength(1);
    expect(res.screenshots[0].data).toBe(Buffer.from([1, 2, 3]).toString('base64'));
    expect(res.logs.every((l) => l.status === 'success')).toBe(true);
  });

  it('if_exists skips, jumps, stops or fails when the element is missing', async () => {
    const base = { type: 'goto', url: 'https://shop.test/p/1' };
    let f = fakePage(dom);
    let res = await robotInterpreter(
      f.page,
      steps([base, { type: 'if_exists', selector: '.cookie' }, { type: 'click', selector: '.cookie' }, { type: 'extract', selector: 'h1', name: 't' }]),
      {},
      opts(),
    );
    expect(res.status).toBe('success');
    expect(res.logs.map((l) => l.status)).toEqual(['success', 'success', 'skipped', 'success']);

    f = fakePage(dom);
    res = await robotInterpreter(
      f.page,
      steps([
        base,
        { type: 'if_exists', selector: '.cookie', onMissing: 'goto', target: 5 },
        { type: 'click', selector: '.cookie' },
        { type: 'click', selector: '.cookie' },
        { type: 'extract', selector: '.price', name: 'p' },
      ]),
      {},
      opts(),
    );
    expect(res.status).toBe('success');
    expect(res.vars.p).toBe('$10');

    f = fakePage(dom);
    res = await robotInterpreter(f.page, steps([base, { type: 'if_exists', text: 'Sold out', onMissing: 'stop' }, { type: 'extract', selector: 'h1', name: 't' }]), {}, opts());
    expect(res.status).toBe('success');
    expect(res.vars.t).toBeUndefined();

    f = fakePage(dom);
    res = await robotInterpreter(f.page, steps([base, { type: 'if_exists', selector: '.x', onMissing: 'fail' }]), {}, opts());
    expect(res.status).toBe('failed');
    expect(res.error).toBe('2: element_not_found');

    // Existe → sigue normal.
    f = fakePage(dom);
    res = await robotInterpreter(f.page, steps([base, { type: 'if_exists', text: 'Buy', onMissing: 'fail' }, { type: 'click', text: 'Buy' }]), {}, opts());
    expect(res.status).toBe('success');
    expect(f.actions).toContain('click:text=Buy');
  });

  it('loop_over iterates a list input with loop.item and caps items', async () => {
    const { page, actions } = fakePage(dom);
    const res = await robotInterpreter(
      page,
      steps([
        {
          type: 'loop_over',
          list: '{{inputs.ids}}',
          max: 2,
          steps: [
            { type: 'goto', url: 'https://shop.test/p/{{loop.item}}' },
            { type: 'extract', selector: '.price', name: 'price' },
          ],
        },
      ]),
      { ids: ['1', '1', '1'] },
      opts(),
    );
    expect(res.status).toBe('success');
    expect(actions.filter((a) => a.startsWith('goto:'))).toHaveLength(2);
    expect(res.logs[0]).toMatchObject({ type: 'loop_over', detail: '2/3 items' });
    expect(res.logs.some((l) => l.step === '1.2.1')).toBe(true);
  });

  it('fails a step with a readable error and stops', async () => {
    const { page } = fakePage(dom);
    const res = await robotInterpreter(
      page,
      steps([{ type: 'goto', url: 'https://shop.test/p/1' }, { type: 'extract', selector: '.nope', name: 'x' }, { type: 'extract', selector: 'h1', name: 'y' }]),
      {},
      opts(),
    );
    expect(res.status).toBe('failed');
    expect(res.error).toBe('2: action_timeout');
    expect(res.logs).toHaveLength(2);
    expect(res.vars.y).toBeUndefined();
  });

  it('blocks unsafe goto targets, file:// and too many pages; honours the deadline', async () => {
    const { page } = fakePage(dom);
    const block = async (u: string) => (u.includes('169.254') ? 'private_host' : null);
    let res = await robotInterpreter(page, steps([{ type: 'goto', url: 'http://169.254.169.254/latest' }]), {}, opts({ checkUrl: block }));
    expect(res.error).toBe('1: private_host');
    res = await robotInterpreter(page, steps([{ type: 'goto', url: 'file:///etc/passwd' }]), {}, opts());
    expect(res.error).toBe('1: invalid_url');
    const three = steps(Array.from({ length: 3 }, () => ({ type: 'goto', url: 'https://shop.test/p/1' })));
    res = await robotInterpreter(page, three, {}, opts({ maxPages: 2 }));
    expect(res.error).toBe('3: page_limit');
    res = await robotInterpreter(page, three, {}, opts({ deadline: Date.now() - 1 }));
    expect(res.error).toBe('timeout');
  });

  it('serializes to a self-contained sandbox script', () => {
    const script = buildRunnerScript();
    expect(script).toContain("require('playwright-core')");
    // El script tiene que ser JS válido (las funciones no dependen del módulo).
    expect(() => new Function('require', script.replace(/^'use strict';/, ''))).not.toThrow();
  });
});

// ---------- SSRF ----------

describe('robots SSRF checks', () => {
  it('detects private addresses', () => {
    for (const ip of ['10.0.0.1', '127.0.0.1', '169.254.169.254', '192.168.1.1', '172.20.0.1', '100.64.0.1', '::1', 'fd00::1', '::ffff:10.0.0.1']) {
      expect(isPrivateAddress(ip)).toBe(true);
    }
    for (const ip of ['8.8.8.8', '1.1.1.1', '2606:4700::1111']) expect(isPrivateAddress(ip)).toBe(false);
  });

  it('checkRobotUrl reuses safeFetch rules (http allowed, private hosts blocked)', async () => {
    vi.stubEnv('NODE_ENV', 'production');
    expect(await checkRobotUrl('http://127.0.0.1/admin')).toBe('private_host');
    expect(await checkRobotUrl('http://localhost:3000')).toBe('private_host');
    expect(await checkRobotUrl('file:///etc/passwd')).toBe('invalid_url');
    expect(await checkRobotUrl('http://8.8.8.8/')).toBeNull();
  });
});

// ---------- Corridas, cuota y permisos ----------

function stubBackend(overrides: Partial<Awaited<ReturnType<RobotBackend['run']>>> = {}, onRun?: (job: RobotJob) => void): RobotBackend {
  return {
    name: 'local',
    async run(job) {
      onRun?.(job);
      return { status: 'success', error: null, vars: { title: 'Hello' }, logs: [], screenshots: [{ name: 's', data: 'AAAA', type: 'image/jpeg' }], pages: 1, ...overrides };
    },
  };
}

async function robotFor(ws: string, patch: Parameters<typeof updateRobot>[2] = {}) {
  const r = await createRobot(ws, ws, { name: 'R' });
  if (!r.ok) throw new Error(r.error);
  if (Object.keys(patch).length) await updateRobot(ws, r.robot.id, patch);
  return r.robot.id;
}

describe('robot runs', () => {
  it('runs with a backend, stores output, logs, screenshots and meters usage', async () => {
    const user = await makeUser('rb');
    const id = await robotFor(user.id, { inputs: [{ name: 'url', default: 'https://a.com' }] });
    let seen: RobotJob | null = null;
    setRobotBackendForTests(stubBackend({}, (j) => (seen = j)));
    const res = await startRobotRun(user.id, id, { url: 'https://b.com' }, { trigger: 'manual' });
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.run).toMatchObject({ status: 'success', output: { title: 'Hello' }, trigger: 'manual', backend: 'local' });
    expect(res.run.screenshots[0].url).toBe('data:image/jpeg;base64,AAAA');
    expect(seen!.inputs).toEqual({ url: 'https://b.com' });
    expect(seen!.timeoutMs).toBe(120_000);
    const usage = await getUsage(user.id);
    expect(usage.runs).toBe(1);
    expect((await listRobots(user.id))[0]).toMatchObject({ runs7d: 1, lastRun: { status: 'success' } });
  });

  it('explains when no runner is configured', async () => {
    const user = await makeUser('rb');
    const id = await robotFor(user.id);
    setRobotBackendForTests(null);
    expect(await startRobotRun(user.id, id, {}, { trigger: 'manual' })).toEqual({ ok: false, error: 'runner_unavailable' });
    expect((await getUsage(user.id)).backend).toBe('none');
  });

  it('enforces the monthly minutes quota and the hourly rate limit', async () => {
    const user = await makeUser('rb');
    const id = await robotFor(user.id);
    setRobotBackendForTests(stubBackend());
    vi.stubEnv('ROBOTS_FREE_MINUTES_PER_MONTH', '1');
    await getDb()
      .prepare('INSERT INTO robot_usage (user_id, month, runs, ms) VALUES (?, ?, 3, ?)')
      .run(user.id, new Date().toISOString().slice(0, 7), 60_000);
    expect(await startRobotRun(user.id, id, {}, { trigger: 'manual' })).toEqual({ ok: false, error: 'quota_exceeded' });

    vi.stubEnv('ROBOTS_FREE_MINUTES_PER_MONTH', 'unlimited');
    vi.stubEnv('RATE_LIMIT_DISABLED', 'false');
    vi.stubEnv('ROBOTS_RUNS_PER_HOUR', '2');
    expect((await startRobotRun(user.id, id, {}, { trigger: 'manual' })).ok).toBe(true);
    expect((await startRobotRun(user.id, id, {}, { trigger: 'manual' })).ok).toBe(true);
    expect(await startRobotRun(user.id, id, {}, { trigger: 'manual' })).toEqual({ ok: false, error: 'rate_limited' });
  });

  it('caps the timeout at the remaining quota', async () => {
    const user = await makeUser('rb');
    const id = await robotFor(user.id, { timeoutSec: 300 });
    let timeout = 0;
    setRobotBackendForTests(stubBackend({}, (j) => (timeout = j.timeoutMs)));
    vi.stubEnv('ROBOTS_FREE_MINUTES_PER_MONTH', '1');
    await getDb()
      .prepare('INSERT INTO robot_usage (user_id, month, runs, ms) VALUES (?, ?, 1, ?)')
      .run(user.id, new Date().toISOString().slice(0, 7), 30_000);
    expect((await startRobotRun(user.id, id, {}, { trigger: 'manual' })).ok).toBe(true);
    expect(timeout).toBe(30_000);
  });

  it('allows one run at a time per workspace', async () => {
    const user = await makeUser('rb');
    const id = await robotFor(user.id);
    let release: () => void = () => {};
    const gate = new Promise<void>((r) => (release = r));
    setRobotBackendForTests({
      name: 'local',
      async run() {
        await gate;
        return { status: 'success', error: null, vars: {}, logs: [], screenshots: [], pages: 0 };
      },
    });
    const first = startRobotRun(user.id, id, {}, { trigger: 'manual' });
    await new Promise((r) => setTimeout(r, 50));
    // La segunda no falla como busy: queda en cola.
    const second = await startRobotRun(user.id, id, {}, { trigger: 'manual' });
    expect(second).toMatchObject({ ok: true, queued: true, run: { status: 'queued' } });
    // Otro workspace no se bloquea.
    const other = await makeUser('rb2');
    const otherId = await robotFor(other.id);
    const otherRun = startRobotRun(other.id, otherId, {}, { trigger: 'manual' });
    release();
    expect((await first).ok).toBe(true);
    expect((await otherRun).ok).toBe(true);
    // Terminó la primera: la cola la arranca (después de cada corrida y desde el cron).
    expect(await drainRobotQueue({ workspaceId: user.id })).toBe(1);
    const queuedId = second.ok ? second.run.id : '';
    expect((await listRobotRuns(user.id, id)).find((r) => r.id === queuedId)).toMatchObject({ status: 'success' });
  });

  it('queues in FIFO order, caps the queue and expires old queued runs', async () => {
    const user = await makeUser('rbq');
    const id = await robotFor(user.id, { inputs: [{ name: 'n' }] });
    const order: unknown[] = [];
    setRobotBackendForTests(stubBackend({}, (j) => order.push(j.inputs.n)));
    await getDb()
      .prepare(
        `INSERT INTO robot_runs (id, robot_id, user_id, status, trigger, locked_until, created_at, started_at)
         VALUES (?, ?, ?, 'running', 'manual', ?, ?, ?)`,
      )
      .run('blocker-' + user.id, id, user.id, new Date(Date.now() + 600_000).toISOString(), new Date().toISOString(), new Date().toISOString());
    vi.stubEnv('ROBOTS_MAX_QUEUED', '2');
    expect((await startRobotRun(user.id, id, { n: 1 }, { trigger: 'manual' })).ok).toBe(true);
    expect((await startRobotRun(user.id, id, { n: 2 }, { trigger: 'manual' })).ok).toBe(true);
    expect(await startRobotRun(user.id, id, { n: 3 }, { trigger: 'manual' })).toEqual({ ok: false, error: 'busy' });
    await getDb().prepare("UPDATE robot_runs SET status = 'success' WHERE id = ?").run('blocker-' + user.id);
    expect(await drainRobotQueue({ workspaceId: user.id })).toBe(2);
    expect(order).toEqual(['1', '2']);

    // Una corrida que esperó más que la edad máxima se marca fallida.
    await getDb()
      .prepare(`INSERT INTO robot_runs (id, robot_id, user_id, status, trigger, created_at) VALUES (?, ?, ?, 'queued', 'schedule', ?)`)
      .run('old-' + user.id, id, user.id, new Date(Date.now() - 2 * 3_600_000).toISOString());
    expect(await expireQueuedRobotRuns(user.id)).toBe(1);
    expect((await listRobotRuns(user.id, id)).find((r) => r.id === 'old-' + user.id)).toMatchObject({
      status: 'failed',
      error: 'queue_expired',
    });
  });

  it('with waitMs (Flow) waits for its turn instead of failing', async () => {
    const user = await makeUser('rbw');
    const id = await robotFor(user.id);
    let release: () => void = () => {};
    const gate = new Promise<void>((r) => (release = r));
    let calls = 0;
    setRobotBackendForTests({
      name: 'local',
      async run() {
        calls++;
        if (calls === 1) await gate;
        return { status: 'success', error: null, vars: { n: calls }, logs: [], screenshots: [], pages: 0 };
      },
    });
    const first = startRobotRun(user.id, id, {}, { trigger: 'manual' });
    await new Promise((r) => setTimeout(r, 30));
    const waiting = startRobotRun(user.id, id, {}, { trigger: 'flow', waitMs: 5000, pollMs: 20 });
    await new Promise((r) => setTimeout(r, 60));
    release();
    expect((await first).ok).toBe(true);
    const res = await waiting;
    expect(res).toMatchObject({ ok: true, run: { status: 'success', trigger: 'flow', output: { n: 2 } } });

    // Sin turno a tiempo: sale de la cola y devuelve busy (sin dejar la corrida colgada).
    await getDb()
      .prepare(
        `INSERT INTO robot_runs (id, robot_id, user_id, status, trigger, locked_until, created_at, started_at)
         VALUES (?, ?, ?, 'running', 'manual', ?, ?, ?)`,
      )
      .run('blk-' + user.id, id, user.id, new Date(Date.now() + 600_000).toISOString(), new Date().toISOString(), new Date().toISOString());
    expect(await startRobotRun(user.id, id, {}, { trigger: 'flow', waitMs: 60, pollMs: 20 })).toEqual({ ok: false, error: 'busy' });
    expect((await listRobotRuns(user.id, id)).filter((r) => r.status === 'queued')).toHaveLength(0);
  });

  it('disabled robots only run by hand; missing inputs are reported', async () => {
    const user = await makeUser('rb');
    const id = await robotFor(user.id, { enabled: false, inputs: [{ name: 'url', required: true }] });
    setRobotBackendForTests(stubBackend());
    expect(await startRobotRun(user.id, id, {}, { trigger: 'flow' })).toEqual({ ok: false, error: 'disabled' });
    expect(await startRobotRun(user.id, id, {}, { trigger: 'manual' })).toEqual({ ok: false, error: 'missing_input', name: 'url' });
  });

  it('emits robot.run.finished / robot.run.failed to Flow', async () => {
    const user = await makeUser('rb');
    const id = await robotFor(user.id);
    const flow = await createFlow(user.id, user.id, {
      name: 'on fail',
      graph: { nodes: [{ id: 't', type: 'trigger.event', position: { x: 0, y: 0 }, config: { event: 'robot.run.failed' } }], edges: [] },
    });
    if (!flow.ok) throw new Error('flow');
    await getDb().prepare('UPDATE flow_flows SET enabled = 1 WHERE id = ?').run(flow.flow.id);
    setRobotBackendForTests(stubBackend({ status: 'failed', error: '2: action_timeout', vars: {} }));
    const res = await startRobotRun(user.id, id, {}, { trigger: 'manual' });
    expect(res.ok && res.run.status).toBe('failed');
    const queued = (await getDb().prepare('SELECT input FROM flow_runs WHERE flow_id = ?').all(flow.flow.id)) as Array<{ input: string }>;
    expect(queued).toHaveLength(1);
    expect(JSON.parse(queued[0].input)).toMatchObject({ robot: { id }, run: { status: 'failed', error: '2: action_timeout' } });
  });

  it('runs due schedules from the cron', async () => {
    const user = await makeUser('rb');
    const id = await robotFor(user.id, { schedule: { mode: 'interval', every: 1, unit: 'hours', time: '09:00', timezone: 'UTC' } });
    setRobotBackendForTests(stubBackend());
    const robot = await getRobot(user.id, id);
    expect(robot?.nextRunAt).toBeTruthy();
    await getDb().prepare('UPDATE robots SET next_run_at = ? WHERE id = ?').run(new Date(Date.now() - 1000).toISOString(), id);
    expect(await runDueRobots(new Date())).toBeGreaterThanOrEqual(1);
    const runs = await listRobotRuns(user.id, id);
    expect(runs[0]).toMatchObject({ trigger: 'schedule', status: 'success' });
    expect(new Date((await getRobot(user.id, id))!.nextRunAt!).getTime()).toBeGreaterThan(Date.now());
  });
});

describe('Flow node app.robot_run', () => {
  it('runs a robot with templated inputs and exposes its output', async () => {
    const user = await makeUser('rbflow');
    const id = await robotFor(user.id, { inputs: [{ name: 'url' }] });
    let job: RobotJob | null = null;
    setRobotBackendForTests(stubBackend({ vars: { price: '$9' } }, (j) => (job = j)));
    const flow = await createFlow(user.id, user.id, {
      name: 'robot flow',
      graph: {
        nodes: [
          { id: 't', type: 'trigger.manual', position: { x: 0, y: 0 }, config: { sample: '{"url":"https://x.com"}' } },
          { id: 'rb', type: 'app.robot_run', position: { x: 0, y: 0 }, config: { robotId: id, inputs: [{ key: 'url', value: '{{trigger.url}}' }] } },
          { id: 'set', type: 'data.set', position: { x: 0, y: 0 }, config: { fields: [{ key: 'p', value: '{{nodes.rb.output.output.price}}' }] } },
        ],
        edges: [
          { id: 'e1', source: 't', target: 'rb' },
          { id: 'e2', source: 'rb', target: 'set' },
        ],
      },
    });
    if (!flow.ok) throw new Error(flow.error);
    const res = await runFlowNow(user.id, flow.flow.id, undefined);
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.run?.status).toBe('success');
    expect(job!.inputs).toEqual({ url: 'https://x.com' });
    expect(res.run?.steps.find((s) => s.nodeId === 'set')?.output).toEqual({ p: '$9' });
    const runs = await listRobotRuns(user.id, id);
    expect(runs[0].trigger).toBe('flow');
  });

  it('fails the node when the robot fails (or cannot be found in this workspace)', async () => {
    const user = await makeUser('rbflow');
    const other = await makeUser('rbother');
    const foreign = await robotFor(other.id);
    setRobotBackendForTests(stubBackend({ status: 'failed', error: 'boom' }));
    const own = await robotFor(user.id);
    for (const [robotId, expected] of [
      [own, 'rb: robot_failed'],
      [foreign, 'rb: robot_not_found'],
    ] as const) {
      const flow = await createFlow(user.id, user.id, {
        name: 'f',
        graph: {
          nodes: [
            { id: 't', type: 'trigger.manual', position: { x: 0, y: 0 }, config: {} },
            { id: 'rb', type: 'app.robot_run', position: { x: 0, y: 0 }, config: { robotId } },
          ],
          edges: [{ id: 'e1', source: 't', target: 'rb' }],
        },
      });
      if (!flow.ok) throw new Error(flow.error);
      const res = await runFlowNow(user.id, flow.flow.id, undefined);
      if (!res.ok) throw new Error(res.error);
      const run = await getRunWithSteps(user.id, res.run!.id);
      expect(run?.status).toBe('failed');
      expect(run?.error).toBe(expected);
    }
  });

  it('waits for its turn when another robot of the workspace is running (no busy failure)', async () => {
    const user = await makeUser('rbflowq');
    const id = await robotFor(user.id);
    setRobotBackendForTests(stubBackend({ vars: { ok: 'yes' } }));
    vi.stubEnv('ROBOTS_FLOW_WAIT_SEC', '5');
    vi.stubEnv('ROBOTS_FLOW_POLL_MS', '20');
    await getDb()
      .prepare(
        `INSERT INTO robot_runs (id, robot_id, user_id, status, trigger, locked_until, created_at, started_at)
         VALUES (?, ?, ?, 'running', 'manual', ?, ?, ?)`,
      )
      .run('fq-' + user.id, id, user.id, new Date(Date.now() + 600_000).toISOString(), new Date().toISOString(), new Date().toISOString());
    const flow = await createFlow(user.id, user.id, {
      name: 'waits',
      graph: {
        nodes: [
          { id: 't', type: 'trigger.manual', position: { x: 0, y: 0 }, config: {} },
          { id: 'rb', type: 'app.robot_run', position: { x: 0, y: 0 }, config: { robotId: id } },
        ],
        edges: [{ id: 'e1', source: 't', target: 'rb' }],
      },
    });
    if (!flow.ok) throw new Error(flow.error);
    setTimeout(() => {
      void getDb().prepare("UPDATE robot_runs SET status = 'success' WHERE id = ?").run('fq-' + user.id);
    }, 150);
    const res = await runFlowNow(user.id, flow.flow.id, undefined);
    if (!res.ok) throw new Error(res.error);
    expect(res.run?.status).toBe('success');
    expect(res.run?.steps.find((s) => s.nodeId === 'rb')?.output).toMatchObject({ status: 'success', output: { ok: 'yes' } });
  });

  it('emitEvent accepts robot events', async () => {
    const user = await makeUser('rbev');
    await expect(emitEvent(user.id, 'robot.run.finished', { robot: { id: 'x' } })).resolves.toBeUndefined();
  });
});

// ---------- API: permisos y aislamiento ----------

function req(url: string, init: { method?: string; body?: unknown } = {}) {
  return new NextRequest(`http://localhost${url}`, {
    method: init.method ?? 'GET',
    body: init.body === undefined ? undefined : JSON.stringify(init.body),
    headers: { 'content-type': 'application/json' },
  });
}
const ctx = (id: string) => ({ params: Promise.resolve({ id }) });

describe('robots API', () => {
  it('members can view but not create, edit or run', async () => {
    const owner = await makeUser('rbapi');
    const id = await robotFor(owner.id);
    session.user = { ...owner, role: 'member', actingUser: { id: 'someone' } };
    const list = await robotsRoute.GET();
    expect(list.status).toBe(200);
    expect(await list.json()).toMatchObject({ canEdit: false, robots: [{ id }] });
    expect((await robotsRoute.POST(req('/api/robots', { method: 'POST', body: { name: 'x' } }))).status).toBe(403);
    expect((await robotRoute.PATCH(req(`/api/robots/${id}`, { method: 'PATCH', body: { name: 'y' } }), ctx(id))).status).toBe(403);
    expect((await robotRoute.DELETE(req(`/api/robots/${id}`, { method: 'DELETE' }), ctx(id))).status).toBe(403);
    expect((await runRoute.POST(req(`/api/robots/run/${id}`, { method: 'POST', body: {} }), ctx(id))).status).toBe(403);
    expect((await runsRoute.GET(req(`/api/robots/${id}/runs`), ctx(id))).status).toBe(200);
  });

  it('admins create from templates, edit with validation and run', async () => {
    const owner = await makeUser('rbapi');
    session.user = { ...owner, role: 'admin' };
    const created = await robotsRoute.POST(req('/api/robots', { method: 'POST', body: { name: 'Shot', template: 'screenshot' } }));
    expect(created.status).toBe(201);
    const robot = (await created.json()) as { id: string; steps: RobotStep[]; inputs: unknown[] };
    expect(robot.steps[0]).toMatchObject({ type: 'goto', url: '{{inputs.url}}' });
    expect(robot.inputs).toHaveLength(1);
    const bad = await robotRoute.PATCH(req(`/api/robots/${robot.id}`, { method: 'PATCH', body: { steps: [{ type: 'goto' }] } }), ctx(robot.id));
    expect(bad.status).toBe(400);
    expect(await bad.json()).toMatchObject({ error: 'invalid_steps', index: 0 });
    expect((await robotsRoute.POST(req('/api/robots', { method: 'POST', body: { name: 'x', template: 'nope' } }))).status).toBe(400);

    setRobotBackendForTests(null);
    const unavailable = await runRoute.POST(req(`/api/robots/run/${robot.id}`, { method: 'POST', body: {} }), ctx(robot.id));
    expect(unavailable.status).toBe(503);
    setRobotBackendForTests(stubBackend());
    const ran = await runRoute.POST(req(`/api/robots/run/${robot.id}`, { method: 'POST', body: { inputs: { url: 'https://example.com' } } }), ctx(robot.id));
    expect(ran.status).toBe(200);
    expect(await ran.json()).toMatchObject({ run: { status: 'success', input: { url: 'https://example.com' } } });
  });

  it('isolates workspaces', async () => {
    const a = await makeUser('rbA');
    const b = await makeUser('rbB');
    const id = await robotFor(a.id);
    session.user = { ...b, role: 'owner' };
    expect((await robotRoute.GET(req(`/api/robots/${id}`), ctx(id))).status).toBe(404);
    expect((await robotRoute.PATCH(req(`/api/robots/${id}`, { method: 'PATCH', body: { name: 'x' } }), ctx(id))).status).toBe(404);
    expect((await robotRoute.DELETE(req(`/api/robots/${id}`, { method: 'DELETE' }), ctx(id))).status).toBe(404);
    setRobotBackendForTests(stubBackend());
    expect((await runRoute.POST(req(`/api/robots/run/${id}`, { method: 'POST', body: {} }), ctx(id))).status).toBe(404);
    expect((await runsRoute.GET(req(`/api/robots/${id}/runs`), ctx(id))).status).toBe(404);
    expect(await listRobots(b.id)).toEqual([]);
    expect(await getRobot(a.id, id)).not.toBeNull();
  });
});
