import { NextRequest } from 'next/server';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { getDb } from '@/lib/db';
import { cancelRun, createFlow, enqueueRun, getFlowRow, getRunWithSteps, listFlowWebhooks, updateFlow } from '@/lib/flow';
import { setFlowCodeRunnerForTests } from '@/lib/flow-code';
import { runFlowNow } from '@/lib/flow-http';
import { processFlowQueue } from '@/lib/flow-worker';
import type { FlowGraph } from '@/lib/flow-schema';
import { createRobot, listRobotRuns, runDueRobots, updateRobot } from '@/lib/robots';
import { robotHarness, type HarnessChromium } from '@/lib/robots-interpreter';
import { setRobotBackendForTests, type RobotBackend } from '@/lib/robots-runner';
import { safeFetch } from '@/lib/safe-fetch';
import { makeUser } from './helpers';

const hookRoute = await import('@/app/api/flow/hooks/[token]/route');

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

function step(r: Run | null, id: string) {
  return (r?.steps ?? []).filter((s) => s.nodeId === id).at(-1);
}

async function robotFor(ws: string, patch: Parameters<typeof updateRobot>[2] = {}) {
  const r = await createRobot(ws, ws, { name: 'R' });
  if (!r.ok) throw new Error(r.error);
  if (Object.keys(patch).length) await updateRobot(ws, r.robot.id, patch);
  return r.robot.id;
}

const hourly = { schedule: { mode: 'interval' as const, every: 1, unit: 'hours' as const, time: '09:00', timezone: 'UTC' } };

async function makeDue(id: string) {
  await getDb().prepare('UPDATE robots SET next_run_at = ? WHERE id = ?').run(new Date(Date.now() - 1000).toISOString(), id);
}

// ---------- [0] Robots programados ----------

describe('Robots: schedules del cron', () => {
  it('corre en paralelo los robots vencidos de muchos workspaces aunque quede poco presupuesto', async () => {
    let live = 0;
    let peak = 0;
    const backend: RobotBackend = {
      name: 'sandbox',
      async run() {
        live += 1;
        peak = Math.max(peak, live);
        await new Promise((r) => setTimeout(r, 30));
        live -= 1;
        return { status: 'success', error: null, vars: {}, logs: [], screenshots: [], pages: 1 };
      },
    };
    setRobotBackendForTests(backend);
    vi.stubEnv('ROBOTS_CRON_CONCURRENCY', '50');
    const robots: Array<{ ws: string; id: string }> = [];
    for (let i = 0; i < 7; i++) {
      const ws = (await makeUser(`r5-due-${i}`)).id;
      const id = await robotFor(ws, hourly);
      await makeDue(id);
      robots.push({ ws, id });
    }
    // Presupuesto chico (como en el tick después de la cola de Flow): antes corría 1.
    await runDueRobots(new Date(), 100, 100_000);
    for (const r of robots) {
      expect((await listRobotRuns(r.ws, r.id)).find((x) => x.trigger === 'schedule')).toMatchObject({ status: 'success' });
    }
    expect(peak).toBeGreaterThan(1);
  });

  it('dos robots vencidos del mismo workspace corren uno después del otro (sin busy)', async () => {
    setRobotBackendForTests({
      name: 'sandbox',
      async run() {
        await new Promise((r) => setTimeout(r, 10));
        return { status: 'success', error: null, vars: {}, logs: [], screenshots: [], pages: 1 };
      },
    });
    const ws = (await makeUser('r5-same-ws')).id;
    const a = await robotFor(ws, hourly);
    const b = await robotFor(ws, hourly);
    await makeDue(a);
    await makeDue(b);
    await runDueRobots(new Date());
    expect((await listRobotRuns(ws, a))[0]).toMatchObject({ trigger: 'schedule', status: 'success' });
    expect((await listRobotRuns(ws, b))[0]).toMatchObject({ trigger: 'schedule', status: 'success' });
  });
});

// ---------- [1] Webhook: rate limit por token ----------

describe('Flow: rate limit del webhook entrante', () => {
  const post = (token: string, ip: string) =>
    hookRoute.POST(
      new NextRequest(`http://localhost/api/flow/hooks/${token}`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'x-forwarded-for': ip },
        body: '{"a":1}',
      }),
      { params: Promise.resolve({ token }) },
    );

  it('un emisor compartido (misma IP) no se bloquea entre workspaces por debajo del límite por token', async () => {
    vi.stubEnv('RATE_LIMIT_DISABLED', 'false');
    const ip = `203.0.113.${Math.floor(Math.random() * 250)}`;
    const ws = (await makeUser('r5-hook')).id;
    const flow = await newFlow(ws, { nodes: [node('hook', 'trigger.webhook')], edges: [] });
    await updateFlow(ws, flow.id, { enabled: true });
    const [{ token }] = await listFlowWebhooks(ws, flow.id);
    const statuses: number[] = [];
    for (let i = 0; i < 125; i++) statuses.push((await post(token, ip)).status);
    expect(statuses.filter((s) => s !== 202)).toEqual([]);
    await getDb().prepare('DELETE FROM flow_runs WHERE flow_id = ?').run(flow.id);
  });

  it('una IP que prueba tokens inexistentes queda bloqueada', async () => {
    vi.stubEnv('RATE_LIMIT_DISABLED', 'false');
    const ip = `198.51.100.${Math.floor(Math.random() * 250)}`;
    const statuses: number[] = [];
    for (let i = 0; i < 122; i++) statuses.push((await post(`fh_${crypto.randomUUID().replace(/-/g, '')}`, ip)).status);
    expect(statuses.slice(0, 120).every((s) => s === 404)).toBe(true);
    expect(statuses.at(-1)).toBe(429);
  });
});

// ---------- [2] Flow de error con trigger grande ----------

describe('Flow: flow de error con un trigger grande', () => {
  it('el flow de error recibe run.error y flow.name aunque el trigger pese más de 64 KB', async () => {
    const ws = (await makeUser('r5-errflow')).id;
    const handler = await newFlow(
      ws,
      manual([node('log', 'data.set', { fields: [{ key: 'msg', value: '{{trigger.flow.name}} failed: {{trigger.run.error}}' }] })], [edge('t', 'log')]),
      'Handler',
    );
    const main = await newFlow(ws, manual([node('boom', 'data.json_parse', { text: 'not json' })], [edge('t', 'boom')]), 'Main');
    expect((await updateFlow(ws, main.id, { errorFlowId: handler.id })).ok).toBe(true);
    const res = await runFlowNow(ws, main.id, { big: 'x'.repeat(80_000) });
    expect(res.ok && res.run?.status).toBe('failed');
    await processFlowQueue();
    const row = (await getDb().prepare('SELECT id FROM flow_runs WHERE flow_id = ?').get(handler.id)) as { id: string };
    const hr = await getRunWithSteps(ws, row.id);
    expect(step(hr, 'log')?.output).toEqual({ msg: 'Main failed: boom: invalid_json' });
    expect((hr?.input as { trigger: { big: string } }).trigger.big).toHaveLength(80_000);
  });
});

// ---------- [3] Nodo Código: tope por workspace ----------

describe('Flow: tope de ejecuciones del nodo Código', () => {
  it('pasado el tope por hora, el nodo falla con code_rate_limited sin levantar otra VM', async () => {
    vi.stubEnv('FLOW_CODE_RUNS_PER_HOUR', '3');
    let vms = 0;
    setFlowCodeRunnerForTests(async () => {
      vms += 1;
      return { ok: true, result: 1, logs: '' };
    });
    const ws = (await makeUser('r5-code')).id;
    const flow = await newFlow(
      ws,
      manual(
        [node('loop', 'logic.loop', { items: '{{trigger.items}}' }), node('c', 'data.code', { code: 'return 1' })],
        [edge('t', 'loop'), edge('loop', 'c', 'item')],
      ),
    );
    const res = await runFlowNow(ws, flow.id, { items: [1, 2, 3, 4, 5] });
    const r = res.ok ? res.run : null;
    expect(r?.status).toBe('failed');
    expect(vms).toBe(3);
    expect(step(r as Run, 'c')?.error).toContain('code_rate_limited');
  });
});

// ---------- [4] HTTP: redirecciones ----------

describe('safeFetch: redirecciones', () => {
  it('sigue un 302 (POST → GET) y saca Authorization si cambia el origen', async () => {
    const calls: Array<{ url: string; init: RequestInit }> = [];
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: unknown, init: RequestInit = {}) => {
        const url = String(input instanceof URL ? input.href : input);
        calls.push({ url, init });
        if (calls.length === 1) return new Response(null, { status: 302, headers: { location: 'https://other.test/result?x=1' } });
        return new Response('{"done":true}', { status: 200, headers: { 'content-type': 'application/json' } });
      }),
    );
    const res = await safeFetch(
      'https://script.test/exec',
      { method: 'POST', headers: { authorization: 'Bearer s3cret', 'content-type': 'application/json' }, body: '{"a":1}' },
      8000,
      { maxRedirects: 5 },
    );
    expect(res.status).toBe(200);
    expect(calls[1].url).toBe('https://other.test/result?x=1');
    expect(calls[1].init.method).toBe('GET');
    expect(calls[1].init.body).toBeUndefined();
    expect(new Headers(calls[1].init.headers).get('authorization')).toBeNull();
  });

  it('valida cada salto: una redirección a la red interna falla', async () => {
    vi.stubEnv('ALLOW_PRIVATE_WEBHOOKS', 'false');
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response(null, { status: 302, headers: { location: 'http://127.0.0.1:8080/admin' } })),
    );
    await expect(safeFetch('https://93.184.216.34/r', {}, 8000, { maxRedirects: 5 })).rejects.toThrow('private_host');
  });

  it('el nodo HTTP sigue la redirección (Apps Script responde 302)', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: unknown) => {
        const url = String(input instanceof URL ? input.href : input);
        if (url.includes('/exec')) return new Response(null, { status: 302, headers: { location: 'https://usercontent.test/echo' } });
        return new Response('{"ok":true}', { status: 200, headers: { 'content-type': 'application/json' } });
      }),
    );
    const ws = (await makeUser('r5-redirect')).id;
    const flow = await newFlow(
      ws,
      manual([node('h', 'action.http', { method: 'POST', url: 'https://script.test/macros/s/x/exec', body: '{"a":1}' })], [edge('t', 'h')]),
    );
    const res = await runFlowNow(ws, flow.id, {});
    const r = res.ok ? res.run : null;
    expect(r?.status).toBe('success');
    expect(step(r as Run, 'h')?.output).toMatchObject({ status: 200, body: { ok: true } });
  });
});

// ---------- [5] Robots locales: WebSocket ----------

describe('Robots: el arnés filtra WebSocket y WebRTC', () => {
  it('cierra WebSocket a hosts privados y lanza Chromium sin UDP directo para WebRTC', async () => {
    let wsHandler: ((ws: { url(): string; close(): Promise<void>; connectToServer(): unknown }) => unknown) | null = null;
    let launchArgs: string[] = [];
    const chromium: HarnessChromium = {
      async launch(opts) {
        launchArgs = opts.args ?? [];
        return {
          async newContext() {
            return {
              async route() {},
              async routeWebSocket(_p, handler) {
                wsHandler = handler as typeof wsHandler;
              },
              on() {},
              async newPage() {
                return {};
              },
              async storageState() {
                return {};
              },
            };
          },
          async close() {},
        };
      },
    };
    const checkUrl = async (url: string) => (url.includes('127.0.0.1') ? 'private_host' : null);
    await robotHarness(
      chromium,
      { steps: [], inputs: {}, robotName: 'R', deadline: Date.now() + 10_000, maxPages: 3, maxScreenshots: 1 } as never,
      (async () => ({ status: 'success', error: null, vars: {}, logs: [], screenshots: [], pages: 1 })) as never,
      checkUrl,
    );
    expect(launchArgs).toContain('--force-webrtc-ip-handling-policy=disable_non_proxied_udp');
    expect(wsHandler).not.toBeNull();
    const fake = (url: string) => {
      const s = { closed: false, connected: false };
      return {
        s,
        ws: {
          url: () => url,
          close: async () => {
            s.closed = true;
          },
          connectToServer: () => {
            s.connected = true;
          },
        },
      };
    };
    const priv = fake('ws://127.0.0.1:9222/devtools/browser/x');
    await wsHandler!(priv.ws);
    expect(priv.s).toEqual({ closed: true, connected: false });
    const pub = fake('wss://echo.example.com/socket');
    await wsHandler!(pub.ws);
    expect(pub.s).toEqual({ closed: false, connected: true });
  });
});

// ---------- [5b] Robots locales: redirecciones de página entera (SSRF) ----------

describe('Robots: el arnés valida cada salto de las redirecciones', () => {
  /** Arnés con un route() que simula route.fetch siguiendo redirecciones a mano. */
  async function captureRouteHandler(checkUrl: (url: string) => Promise<string | null>) {
    let handler: ((route: unknown) => Promise<void>) | null = null;
    const chromium = {
      async launch() {
        return {
          async newContext() {
            return {
              async route(_p: string, h: (route: unknown) => Promise<void>) {
                handler = h;
              },
              on() {},
              async newPage() {
                return {};
              },
              async storageState() {
                return {};
              },
            };
          },
          async close() {},
        };
      },
    };
    await robotHarness(
      chromium as unknown as HarnessChromium,
      { steps: [], inputs: {}, robotName: 'R', deadline: Date.now() + 10_000, maxPages: 3, maxScreenshots: 1 } as never,
      (async () => ({ status: 'success', error: null, vars: {}, logs: [], screenshots: [], pages: 1 })) as never,
      checkUrl,
    );
    return handler!;
  }

  /** route falso: `chain` es la cadena de respuestas (status + location) que devuelve route.fetch por salto. */
  function fakeRoute(initialUrl: string, chain: Array<{ status: number; location?: string }>, opts: { noFetch?: boolean } = {}) {
    const log: { aborted?: string; fulfilled?: boolean; continued?: boolean; fetched: string[] } = { fetched: [] };
    let hop = 0;
    const route = {
      request: () => ({ url: () => initialUrl, method: () => 'GET', headers: () => ({}) }),
      abort: async (code?: string) => {
        log.aborted = code ?? 'aborted';
      },
      continue: async () => {
        log.continued = true;
      },
      fulfill: async () => {
        log.fulfilled = true;
      },
      fetch: opts.noFetch
        ? undefined
        : async (o?: { url?: string }) => {
            log.fetched.push(o?.url ?? initialUrl);
            const step = chain[Math.min(hop++, chain.length - 1)];
            return { status: () => step.status, headers: () => (step.location ? { location: step.location } : {}), body: async () => Buffer.from('') };
          },
    };
    return { route, log };
  }

  const checkUrl = async (url: string) => (/127\.0\.0\.1|169\.254|localhost|10\.0\.0/.test(url) ? 'private_host' : null);

  it('bloquea una redirección 302 de una página pública hacia la metadata interna', async () => {
    const handler = await captureRouteHandler(checkUrl);
    const { route, log } = fakeRoute('https://site.example/go', [{ status: 302, location: 'http://169.254.169.254/latest/meta-data/' }]);
    await handler(route);
    expect(log.aborted).toBe('blockedbyclient');
    expect(log.fulfilled).toBeUndefined();
  });

  it('una cadena que termina en un host privado: cada salto es un pedido nuevo y el prohibido se corta', async () => {
    const handler = await captureRouteHandler(checkUrl);
    // Salto 1: público → público. Se le devuelve el 30x al navegador (que lo sigue como pedido nuevo).
    const first = fakeRoute('https://site.example/a', [{ status: 301, location: 'https://site.example/b' }]);
    await handler(first.route);
    expect(first.log.fulfilled).toBe(true);
    expect(first.log.aborted).toBeUndefined();
    // Salto 2: el navegador pide /b, que redirige a la red interna: se corta.
    const second = fakeRoute('https://site.example/b', [{ status: 302, location: 'http://127.0.0.1:9222/json' }]);
    await handler(second.route);
    expect(second.log.aborted).toBe('blockedbyclient');
    expect(second.log.fulfilled).toBeUndefined();
  });

  it('deja pasar una redirección pública: el 30x vuelve al navegador para que la URL del documento quede bien', async () => {
    const handler = await captureRouteHandler(checkUrl);
    const { route, log } = fakeRoute('https://site.example/a', [{ status: 302, location: 'https://site.example/final' }]);
    await handler(route);
    expect(log.fulfilled).toBe(true);
    expect(log.aborted).toBeUndefined();
    expect(log.fetched).toEqual(['https://site.example/a']);
  });

  it('bloquea una redirección a un esquema que no es http(s)', async () => {
    const handler = await captureRouteHandler(checkUrl);
    const { route, log } = fakeRoute('https://site.example/a', [{ status: 302, location: 'file:///etc/passwd' }]);
    await handler(route);
    expect(log.aborted).toBe('blockedbyclient');
  });

  it('bloquea el pedido inicial a un host privado sin fetch', async () => {
    const handler = await captureRouteHandler(checkUrl);
    const { route, log } = fakeRoute('http://127.0.0.1:3871/x', [{ status: 200 }]);
    await handler(route);
    expect(log.aborted).toBe('blockedbyclient');
    expect(log.fetched).toEqual([]);
  });

  it('sin route.fetch (Playwright viejo) continúa tras validar el salto inicial', async () => {
    const handler = await captureRouteHandler(checkUrl);
    const { route, log } = fakeRoute('https://site.example/a', [], { noFetch: true });
    await handler(route);
    expect(log.continued).toBe(true);
    expect(log.aborted).toBeUndefined();
  });
});

// ---------- [6] Cancelar mientras se retoma ----------

describe('Flow: cancelar una corrida mientras se retoma', () => {
  it('si la cancelación entra antes de pasar a running, la corrida no sigue', async () => {
    const ws = (await makeUser('r5-cancel-race')).id;
    const flow = await newFlow(
      ws,
      manual(
        [node('wait', 'logic.delay', { amount: 3, unit: 'days' }), node('send', 'data.set', { fields: [{ key: 'msg', value: 'oferta' }] })],
        [edge('t', 'wait'), edge('wait', 'send')],
      ),
    );
    await updateFlow(ws, flow.id, { enabled: true });
    const runId = (await enqueueRun((await getFlowRow(ws, flow.id))!, 'trigger.event', { deal: 1 }))!;
    await processFlowQueue();
    expect((await getRunWithSteps(ws, runId))?.status).toBe('waiting');
    await getDb().prepare("UPDATE flow_jobs SET run_at = '2000-01-01T00:00:00.000Z' WHERE run_id = ?").run(runId);

    // Se cancela justo antes de que resumeRun marque la corrida como running.
    const db = getDb();
    const prepare = db.prepare.bind(db);
    let cancelled = false;
    vi.spyOn(db, 'prepare').mockImplementation((sql: string) => {
      const stmt = prepare(sql);
      if (!cancelled && /SET status = 'running'/.test(sql)) {
        const run = stmt.run.bind(stmt);
        return {
          ...stmt,
          run: async (...args: unknown[]) => {
            cancelled = true;
            expect(await cancelRun(ws, runId)).toEqual({ ok: true });
            return run(...(args as []));
          },
        } as typeof stmt;
      }
      return stmt;
    });
    await processFlowQueue();
    vi.restoreAllMocks();
    expect(cancelled).toBe(true);
    const run = await getRunWithSteps(ws, runId);
    expect(run).toMatchObject({ status: 'failed', error: 'cancelled' });
    expect(step(run, 'send')).toBeUndefined();
  });
});
