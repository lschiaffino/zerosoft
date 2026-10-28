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

// ---------- [5b] Robots locales: proxy de salida guardián (SSRF) ----------

describe('Robots: el proxy guardián valida cada conexión', () => {
  const dnsp = {
    async lookup(host: string) {
      const map: Record<string, Array<{ address: string }>> = {
        'site.example': [{ address: '93.184.216.34' }],
        'rebind.example': [{ address: '93.184.216.34' }, { address: '169.254.169.254' }],
        'intranet.example': [{ address: '10.0.0.5' }],
      };
      if (map[host]) return map[host];
      throw new Error('ENOTFOUND');
    },
  };

  async function startGuard() {
    const { guardProxy } = await import('@/lib/robots-interpreter');
    const { isPrivateAddress } = await import('@/lib/robots-interpreter');
    const http = await import('node:http');
    const net = await import('node:net');
    return guardProxy(http, net, dnsp as unknown as typeof import('dns/promises'), isPrivateAddress);
  }

  /** Pide por el proxy (http) a `url` con el Host del nombre y devuelve el status o el error. */
  function throughProxy(port: number, url: string): Promise<{ status?: number; error?: string }> {
    return new Promise((resolve) => {
      const http = require('node:http') as typeof import('http');
      const u = new URL(url);
      const req = http.request(
        { host: '127.0.0.1', port, method: 'GET', path: url, headers: { host: u.host }, timeout: 4000 },
        (res) => {
          res.resume();
          resolve({ status: res.statusCode });
        },
      );
      req.on('error', (e) => resolve({ error: (e as Error).message }));
      req.on('timeout', () => { req.destroy(); resolve({ error: 'timeout' }); });
      req.end();
    });
  }

  /** Bloqueado = el proxy corta la conexión (sin status), no un 403 con cuerpo. */
  const blocked = (r: { status?: number; error?: string }) => r.status === undefined && !!r.error;

  it('corta la conexión a un destino que resuelve a una IP privada o a metadata', async () => {
    const g = await startGuard();
    try {
      expect(blocked(await throughProxy(g.port, 'http://169.254.169.254/latest/meta-data/'))).toBe(true);
      expect(blocked(await throughProxy(g.port, 'http://127.0.0.1:9222/json'))).toBe(true);
      expect(blocked(await throughProxy(g.port, 'http://intranet.example/'))).toBe(true);
      expect(blocked(await throughProxy(g.port, 'http://localhost:3871/x'))).toBe(true);
      // blockedSince marca que hubo un corte.
      expect(g.blockedSince(0)).toBe('private_host');
    } finally {
      await g.close();
    }
  });

  it('bloquea si cualquiera de las IPs del nombre es privada (DNS rebinding)', async () => {
    const g = await startGuard();
    try {
      expect(blocked(await throughProxy(g.port, 'http://rebind.example/'))).toBe(true);
    } finally {
      await g.close();
    }
  });

  it('un nombre que no resuelve se corta', async () => {
    const g = await startGuard();
    try {
      expect(blocked(await throughProxy(g.port, 'http://nope.example/'))).toBe(true);
    } finally {
      await g.close();
    }
  });

  it('ALLOW_PRIVATE_WEBHOOKS / ROBOTS_ALLOWED_PRIVATE_HOSTS habilitan hosts privados a propósito', async () => {
    const { guardProxy, isPrivateAddress } = await import('@/lib/robots-interpreter');
    const http = await import('node:http');
    const net = await import('node:net');
    // Un sitio en loopback que, habilitado, el proxy debe dejar pasar.
    const site = http.createServer((_req, res) => { res.writeHead(200); res.end('ok'); });
    await new Promise<void>((r) => site.listen(0, '127.0.0.1', () => r()));
    const port = (site.address() as { port: number }).port;
    try {
      const any = await guardProxy(http, net, dnsp as unknown as typeof import('dns/promises'), isPrivateAddress, null, { any: true, hosts: [] });
      expect((await throughProxy(any.port, `http://127.0.0.1:${port}/`)).status).toBe(200);
      await any.close();
      const listed = await guardProxy(http, net, dnsp as unknown as typeof import('dns/promises'), isPrivateAddress, null, { any: false, hosts: [`127.0.0.1:${port}`] });
      expect((await throughProxy(listed.port, `http://127.0.0.1:${port}/`)).status).toBe(200);
      // Otro host privado no listado sigue cortado.
      expect(blocked(await throughProxy(listed.port, 'http://169.254.169.254/'))).toBe(true);
      await listed.close();
    } finally {
      await new Promise<void>((r) => site.close(() => r()));
    }
  });

  it('con un proxy de país encadena por él tras validar, y sigue bloqueando lo privado', async () => {
    const http = await import('node:http');
    // "Sitio" real al que el upstream debe llegar.
    let gotPath = '';
    const site = http.createServer((req, res) => {
      gotPath = req.url ?? '';
      res.writeHead(200, { 'content-type': 'text/plain' });
      res.end('from-upstream');
    });
    await new Promise<void>((r) => site.listen(0, '127.0.0.1', () => r()));
    const sitePort = (site.address() as { port: number }).port;
    // Upstream falso: reenvía el pedido HTTP absoluto al destino (como un proxy).
    let upstreamSawConnect = false;
    const upstreamSrv = http.createServer((req, res) => {
      const u = new URL(req.url ?? '');
      const preq = http.request({ host: u.hostname, port: Number(u.port) || 80, method: req.method, path: u.pathname + u.search, headers: { host: u.host } }, (pres) => {
        res.writeHead(pres.statusCode || 502, pres.headers);
        pres.pipe(res);
      });
      preq.on('error', () => { res.writeHead(502); res.end(); });
      req.pipe(preq);
    });
    upstreamSrv.on('connect', (_req, socket) => {
      upstreamSawConnect = true;
      socket.end('HTTP/1.1 200 OK\r\n\r\n');
    });
    await new Promise<void>((r) => upstreamSrv.listen(0, '127.0.0.1', () => r()));
    const upstreamPort = (upstreamSrv.address() as { port: number }).port;

    const { guardProxy, isPrivateAddress } = await import('@/lib/robots-interpreter');
    const net = await import('node:net');
    // Guard que trata 127.0.0.1 como público (para que el sitio/upstream locales anden),
    // pero bloquea metadata y 10.x. En producción isPrivateAddress bloquea loopback.
    const isPrivForTest = (ip: string) => (ip === '127.0.0.1' ? false : isPrivateAddress(ip));
    const g = await guardProxy(http, net, dnsp as unknown as typeof import('dns/promises'), isPrivForTest, {
      server: `http://127.0.0.1:${upstreamPort}`,
    });
    try {
      // Un pedido público sale por el upstream y llega al sitio.
      const r = await throughProxy(g.port, `http://127.0.0.1:${sitePort}/hola`);
      expect(r.status).toBe(200);
      expect(gotPath).toBe('/hola');
      void upstreamSawConnect;
      // Un destino que resuelve a metadata se corta ANTES de salir por el upstream.
      expect(blocked(await throughProxy(g.port, 'http://169.254.169.254/latest/meta-data/'))).toBe(true);
    } finally {
      await g.close();
      await new Promise<void>((r) => site.close(() => r()));
      await new Promise<void>((r) => upstreamSrv.close(() => r()));
    }
  });

  it('el arnés lanza Chromium con el proxy guardián y route() solo filtra esquemas', async () => {
    const { guardProxy, isPrivateAddress } = await import('@/lib/robots-interpreter');
    const http = await import('node:http');
    const net = await import('node:net');
    let launchedProxy: { server: string } | undefined;
    let routeHandler: ((route: unknown) => Promise<void>) | null = null;
    const chromium = {
      async launch(opts: { proxy?: { server: string } }) {
        launchedProxy = opts.proxy;
        return {
          async newContext() {
            return {
              async route(_p: string, h: (route: unknown) => Promise<void>) { routeHandler = h; },
              on() {},
              async newPage() { return {}; },
              async storageState() { return {}; },
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
      async () => null,
      () => guardProxy(http, net, dnsp as unknown as typeof import('dns/promises'), isPrivateAddress),
    );
    expect(launchedProxy?.server).toMatch(/^http:\/\/127\.0\.0\.1:\d+$/);
    // route(): http(s) pasa (lo valida el proxy), otros esquemas se cortan.
    const mk = (url: string) => {
      const log: { aborted?: string; continued?: boolean } = {};
      return { log, route: { request: () => ({ url: () => url }), abort: async (c?: string) => { log.aborted = c ?? 'aborted'; }, continue: async () => { log.continued = true; } } };
    };
    const https = mk('https://site.example/x'); await routeHandler!(https.route); expect(https.log.continued).toBe(true);
    const file = mk('file:///etc/passwd'); await routeHandler!(file.route); expect(file.log.aborted).toBe('blockedbyclient');
    const data = mk('data:text/html,<h1>x</h1>'); await routeHandler!(data.route); expect(data.log.continued).toBe(true);
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
