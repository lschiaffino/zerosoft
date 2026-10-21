import { createHmac } from 'node:crypto';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { getDb, type AgentRow } from '@/lib/db';
import { createApiKey } from '@/lib/api-auth';
import { createFlow } from '@/lib/flow';
import { createCredential, resolveCredential, secretValues, updateCredential, listCredentials } from '@/lib/flow-credentials';
import { createRobot, drainRobotQueue, getRobotBatch, listRobotRuns, startRobotRun, updateRobot } from '@/lib/robots';
import { diffRobotOutputs } from '@/lib/robots-diff';
import { robotInterpreter, type InterpreterStep, type RobotLocator, type RobotPage } from '@/lib/robots-interpreter';
import { setRobotBackendForTests, type RobotBackend, type RobotJob } from '@/lib/robots-runner';
import { buildRunnerScript } from '@/lib/robots-sandbox';
import { validateSteps } from '@/lib/robots-schema';
import { normalizeTotpSecret, parseTotpSecret } from '@/lib/totp';
import { setAiModelOverride } from '@/lib/ai';
import { createAgent, getAgentRow, sendAgentMessage, updateAgent } from '@/lib/agents';
import { isSimulatedOutput, type AgentToolsConfig } from '@/lib/agents-config';
import { FLOW_EVENT_TYPES } from '@/lib/flow-schema';
import { WEBHOOK_EVENTS } from '@/lib/webhooks-events';
import { endpointScope, API_ENDPOINTS } from '@/lib/api-docs';
import { makeUser } from './helpers';
import { scriptedModel } from './ai-mock';

const listRoute = await import('@/app/api/v1/robots/route');
const runsRoute = await import('@/app/api/v1/robots/[id]/runs/route');
const bulkRoute = await import('@/app/api/v1/robots/[id]/bulk/route');
const runRoute = await import('@/app/api/v1/robots/runs/[id]/route');
const batchRoute = await import('@/app/api/v1/robots/batches/[id]/route');

beforeEach(() => {
  vi.stubEnv('RATE_LIMIT_DISABLED', 'true');
  vi.stubEnv('FLOW_WORKER_KICK', 'false');
});

afterEach(() => {
  vi.unstubAllEnvs();
  setRobotBackendForTests(undefined);
  setAiModelOverride(null);
});

function steps(list: unknown[]): InterpreterStep[] {
  const v = validateSteps(list);
  if (!v.ok) throw new Error(`invalid: ${v.error} at ${v.index}`);
  return v.steps as unknown as InterpreterStep[];
}

// ---------- DOM falso con tarjetas y páginas ----------

interface Card {
  text: string;
  children?: Record<string, { text: string; attrs?: Record<string, string> }>;
  attrs?: Record<string, string>;
}

/** Elemento mínimo para la función que corre "en el navegador" (querySelector, getAttribute, innerText). */
function el(node: { text: string; attrs?: Record<string, string>; children?: Card['children'] }): Element {
  return {
    innerText: node.text,
    textContent: node.text,
    getAttribute: (n: string) => node.attrs?.[n] ?? null,
    href: node.attrs?.href ? `https://shop.test${node.attrs.href}` : undefined,
    querySelector: (sel: string) => {
      const c = node.children?.[sel];
      return c ? el(c) : null;
    },
  } as unknown as Element;
}

/**
 * Sitio de varias páginas: pages[i] = tarjetas de la página i. "Siguiente" es
 * a.next (falta en la última, o está deshabilitado si disabledOnLast).
 */
function pagedSite(pages: Card[][], opts: { disabledOnLast?: boolean; stuck?: boolean; tables?: unknown[][] } = {}) {
  let current = 0;
  const actions: string[] = [];
  const hasNext = () => current < pages.length - 1 || !!opts.disabledOnLast;
  const disabled = () => current >= pages.length - 1 && !!opts.disabledOnLast;
  const loc = (sel: string): RobotLocator => {
    const isNext = sel === 'a.next' || sel === 'text=Next';
    const count = async () => (isNext ? (hasNext() ? 1 : 0) : (pages[current] ?? []).length);
    const l: RobotLocator = {
      first: () => l,
      count,
      click: async () => {
        actions.push(`click:${sel}`);
        if (isNext && !opts.stuck) current += 1;
      },
      fill: async () => {},
      selectOption: async () => [],
      press: async () => {},
      innerText: async () => '',
      getAttribute: async () => null,
      allInnerTexts: async () => [],
      evaluateAll: async <R,>(fn: (els: Element[], arg: string) => R, arg: string) => fn((pages[current] ?? []).map(el), arg),
      evaluate: async <R,>() => (isNext ? disabled() : (opts.tables?.[current] ?? [])) as unknown as R,
      waitFor: async () => {
        if (!(await count())) throw new Error('Timeout');
      },
      scrollIntoViewIfNeeded: async () => {},
    };
    return l;
  };
  const page: RobotPage = {
    goto: async (url) => void actions.push(`goto:${url}`),
    url: () => `https://shop.test/p${current + 1}`,
    locator: (sel) => loc(sel),
    getByText: (text) => loc(`text=${text}`),
    keyboard: { press: async () => {} },
    waitForTimeout: async (ms) => void actions.push(`wait:${ms}`),
    screenshot: async () => new Uint8Array([1]),
    evaluate: async <R,>() => true as unknown as R,
  };
  return { page, actions };
}

const opts = (extra: Partial<Parameters<typeof robotInterpreter>[3]> = {}) => ({
  deadline: Date.now() + 30_000,
  checkUrl: async () => null,
  ...extra,
});

const card = (title: string, href: string, price: string): Card => ({
  text: `${title} ${price}`,
  children: { h2: { text: title }, a: { text: title, attrs: { href } }, '.price': { text: price } },
});

const LIST_STEP = {
  type: 'extract_list',
  selector: '.card',
  name: 'items',
  fields: [
    { name: 'title', selector: 'h2' },
    { name: 'link', selector: 'a', attribute: 'href' },
    { name: 'price', selector: '.price' },
    { name: 'missing', selector: '.nope' },
  ],
};

// ---------- extract_list ----------

describe('extract_list', () => {
  it('valida campos y rechaza nombres repetidos', () => {
    expect(validateSteps([LIST_STEP]).ok).toBe(true);
    expect(validateSteps([{ ...LIST_STEP, fields: [] }]).ok).toBe(false);
    expect(validateSteps([{ ...LIST_STEP, fields: [{ name: 'a' }, { name: 'a' }] }])).toMatchObject({ ok: false, error: 'invalid_steps', index: 0 });
    expect(validateSteps([{ type: 'loop_over', list: 'x', steps: [{ ...LIST_STEP, fields: [{ name: 'a' }, { name: 'a' }] }] }]).ok).toBe(false);
    expect(validateSteps([{ ...LIST_STEP, maxPages: 21 }]).ok).toBe(false);
  });

  it('convierte tarjetas en filas con campos con nombre (href absoluto, vacío si falta)', async () => {
    const { page } = pagedSite([[card('Book A', '/a', '£1'), card('Book B', '/b', '£2')]]);
    const res = await robotInterpreter(page, steps([LIST_STEP]), {}, opts());
    expect(res.status).toBe('success');
    expect(res.vars.items).toEqual([
      { title: 'Book A', link: 'https://shop.test/a', price: '£1', missing: '' },
      { title: 'Book B', link: 'https://shop.test/b', price: '£2', missing: '' },
    ]);
    expect(res.logs[0].detail).toBe('items: 2 rows');
  });

  it('respeta max filas y lee la tarjeta misma sin selector', async () => {
    const { page } = pagedSite([[card('A', '/a', '1'), card('B', '/b', '2'), card('C', '/c', '3')]]);
    const res = await robotInterpreter(page, steps([{ ...LIST_STEP, max: 2, fields: [{ name: 'all' }] }]), {}, opts());
    expect(res.vars.items).toEqual([{ all: 'A 1' }, { all: 'B 2' }]);
  });
});

// ---------- paginación ----------

describe('paginación', () => {
  const pages = [[card('A', '/a', '1')], [card('B', '/b', '2')], [card('C', '/c', '3')]];

  it('hace clic en Siguiente hasta que falta y junta las filas de todas las páginas', async () => {
    const { page, actions } = pagedSite(pages);
    const res = await robotInterpreter(page, steps([{ ...LIST_STEP, nextSelector: 'a.next', maxPages: 10, pageWaitMs: 0 }]), {}, opts());
    expect(res.status).toBe('success');
    expect((res.vars.items as Array<{ title: string }>).map((r) => r.title)).toEqual(['A', 'B', 'C']);
    expect(actions.filter((a) => a === 'click:a.next')).toHaveLength(2);
    expect(res.logs[0].detail).toBe('items: 3 rows · 3 pages');
    expect(res.pages).toBe(2);
  });

  it('para en el tope de páginas, con Siguiente deshabilitado o si la página no cambia', async () => {
    const capped = pagedSite(pages);
    const r1 = await robotInterpreter(capped.page, steps([{ ...LIST_STEP, nextText: 'Next', maxPages: 2, pageWaitMs: 0 }]), {}, opts());
    expect((r1.vars.items as unknown[]).length).toBe(2);

    const dis = pagedSite(pages, { disabledOnLast: true });
    const r2 = await robotInterpreter(dis.page, steps([{ ...LIST_STEP, nextSelector: 'a.next', maxPages: 10, pageWaitMs: 0 }]), {}, opts());
    expect((r2.vars.items as unknown[]).length).toBe(3);
    expect(dis.actions.filter((a) => a === 'click:a.next')).toHaveLength(2);

    const stuck = pagedSite(pages, { stuck: true });
    const r3 = await robotInterpreter(stuck.page, steps([{ ...LIST_STEP, nextSelector: 'a.next', maxPages: 10, pageWaitMs: 0 }]), {}, opts());
    expect((r3.vars.items as Array<{ title: string }>).map((r) => r.title)).toEqual(['A']);
  });

  it('cada clic cuenta contra el límite de páginas de la corrida', async () => {
    const { page } = pagedSite(pages);
    const res = await robotInterpreter(page, steps([{ ...LIST_STEP, nextSelector: 'a.next', maxPages: 10, pageWaitMs: 0 }]), {}, opts({ maxPages: 1 }));
    expect((res.vars.items as unknown[]).length).toBe(2);
  });

  it('extract_table también pagina', async () => {
    const { page } = pagedSite([[card('A', '/a', '1')], [card('B', '/b', '2')]], { tables: [[{ n: '1' }], [{ n: '2' }]] });
    const res = await robotInterpreter(page, steps([{ type: 'extract_table', selector: '.card', name: 'rows', nextSelector: 'a.next', maxPages: 5, pageWaitMs: 0 }]), {}, opts());
    expect(res.vars.rows).toEqual([{ n: '1' }, { n: '2' }]);
  });

  it('el script del sandbox sigue siendo autocontenido', () => {
    const script = buildRunnerScript();
    expect(script).toContain('extract_list');
    expect(() => new Function(script.replace(/^'use strict';/, ''))).not.toThrow();
  });
});

// ---------- TOTP ----------

/** RFC 6238, apéndice B (SHA-1): secreto ASCII "12345678901234567890". */
const RFC_SECRET = 'GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ';

function referenceTotp(b32: string, t: number, digits = 6, period = 30): string {
  const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
  let bits = '';
  for (const ch of b32) bits += alphabet.indexOf(ch).toString(2).padStart(5, '0');
  const key = Buffer.from(bits.match(/.{8}/g)!.map((b) => parseInt(b, 2)));
  const msg = Buffer.alloc(8);
  msg.writeBigUInt64BE(BigInt(Math.floor(t / 1000 / period)));
  const mac = createHmac('sha1', key).update(msg).digest();
  const off = mac[mac.length - 1] & 15;
  return String((mac.readUInt32BE(off) & 0x7fffffff) % 10 ** digits).padStart(digits, '0');
}

describe('TOTP', () => {
  it('normaliza el secreto: base32 con espacios, minúsculas y URI otpauth://', () => {
    expect(normalizeTotpSecret('gezd gnbv gy3t qojq gezd gnbv gy3t qojq')).toBe(RFC_SECRET);
    expect(normalizeTotpSecret(`otpauth://totp/Site:ana?secret=${RFC_SECRET}&issuer=Site`)).toBe(RFC_SECRET);
    expect(normalizeTotpSecret(`otpauth://totp/x?secret=${RFC_SECRET}&digits=8&period=60&algorithm=SHA256`)).toBe(`${RFC_SECRET}:8:60:SHA256`);
    expect(normalizeTotpSecret('short')).toBeNull();
    expect(normalizeTotpSecret('not base32 111111111111111')).toBeNull();
    expect(normalizeTotpSecret(`otpauth://hotp/x?secret=${RFC_SECRET}`)).toBeNull();
    expect(parseTotpSecret(`${RFC_SECRET}:8:60:SHA256`)).toEqual({ secret: RFC_SECRET, digits: 8, period: 60, algorithm: 'SHA256' });
  });

  it('{{credentials.x.totp}} escribe el código del momento (vectores de la RFC 6238) y no queda en el log', async () => {
    const cases: Array<[number, string, string]> = [
      [59_000, `${RFC_SECRET}:8:30:SHA1`, '94287082'],
      [1_111_111_109_000, `${RFC_SECRET}:8:30:SHA1`, '07081804'],
      [1_234_567_890_000, RFC_SECRET, '005924'],
    ];
    for (const [now, secret, code] of cases) {
      const filled: string[] = [];
      const { page } = pagedSite([[card('A', '/a', '1')]]);
      const base = page.locator;
      page.locator = (sel) => {
        const l = base(sel);
        return { ...l, first: () => ({ ...l, fill: async (v: string) => void filled.push(v) }) };
      };
      const res = await robotInterpreter(
        page,
        steps([
          { type: 'fill', selector: '.card', value: '{{credentials.site.totp}}' },
          { type: 'goto', url: 'https://shop.test/verify?code={{credentials.site.totp}}' },
        ]),
        {},
        opts({ now: () => now, credentials: { site: { username: 'ana', password: 'pw', totpSecret: secret } } }),
      );
      expect(res.status).toBe('success');
      expect(filled).toEqual([code]);
      expect(code).toBe(referenceTotp(secret.split(':')[0], now, code.length));
      expect(JSON.stringify(res.logs)).not.toContain(code);
      expect(res.logs[1].detail).toBe('https://shop.test/verify?code=[redacted]');
    }
  });

  it('sin secreto TOTP en la credencial, el paso falla con un código claro', async () => {
    const { page } = pagedSite([[card('A', '/a', '1')]]);
    const res = await robotInterpreter(
      page,
      steps([{ type: 'fill', selector: '.card', value: '{{credentials.site.totp}}' }]),
      {},
      opts({ credentials: { site: { username: 'ana', password: 'pw' } } }),
    );
    expect(res.error).toBe('1: missing_totp_secret');
  });

  it('el secreto va cifrado con secret-box en su columna y vuelve al resolver la credencial', async () => {
    const user = await makeUser('totp');
    const bad = await createCredential(user.id, user.id, { name: 'site', type: 'basic', data: { username: 'ana', password: 'pw', totpSecret: 'nope' } });
    expect(bad).toMatchObject({ ok: false, error: 'invalid_totp', field: 'totpSecret' });
    const res = await createCredential(user.id, user.id, {
      name: 'site',
      type: 'basic',
      data: { username: 'ana', password: 'secret-pw', totpSecret: 'gezd gnbv gy3t qojq gezd gnbv gy3t qojq' },
    });
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.credential.secretsSet).toEqual(['password', 'totpSecret']);
    expect(JSON.stringify(res.credential)).not.toContain(RFC_SECRET);
    const row = (await getDb().prepare('SELECT data, totp_secret FROM flow_credentials WHERE id = ?').get(res.credential.id)) as {
      data: string;
      totp_secret: string;
    };
    expect(row.totp_secret.startsWith('enc:v1:')).toBe(true);
    expect(row.totp_secret).not.toContain(RFC_SECRET);
    const resolved = await resolveCredential(user.id, 'site');
    expect(resolved?.data).toEqual({ username: 'ana', password: 'secret-pw', totpSecret: RFC_SECRET });
    expect(secretValues('basic', resolved!.data)).toContain(RFC_SECRET);
    // Editar sin mandar el secreto lo conserva.
    await updateCredential(user.id, res.credential.id, { data: { username: 'ana2' } });
    expect((await resolveCredential(user.id, 'site'))?.data).toMatchObject({ username: 'ana2', totpSecret: RFC_SECRET });
    expect((await listCredentials(user.id))[0].secretsSet).toContain('totpSecret');
  });

  it('una corrida recibe el secreto y lo tacha de la salida', async () => {
    const user = await makeUser('totp-run');
    await createCredential(user.id, user.id, { name: 'site', type: 'basic', data: { username: 'ana', password: 'secret-pw', totpSecret: RFC_SECRET } });
    const r = await createRobot(user.id, user.id, { name: 'Login' });
    if (!r.ok) throw new Error('robot');
    await updateRobot(user.id, r.robot.id, { steps: [{ type: 'fill', selector: '#otp', value: '{{credentials.site.totp}}' }] });
    let seen: RobotJob | null = null;
    setRobotBackendForTests({
      name: 'local',
      run: async (job) => {
        seen = job;
        return { status: 'success', error: null, vars: { leak: RFC_SECRET }, logs: [], screenshots: [], pages: 0 };
      },
    });
    const run = await startRobotRun(user.id, r.robot.id, {}, { trigger: 'manual' });
    expect(run.ok && run.run.output).toEqual({ leak: '[redacted]' });
    expect(seen!.credentials?.site.totpSecret).toBe(RFC_SECRET);
  });
});

// ---------- Cambios entre corridas ----------

describe('diffRobotOutputs', () => {
  it('detecta valores agregados, quitados y cambiados', () => {
    expect(diffRobotOutputs({ a: 1, b: 'x' }, { a: 1, b: 'x' })).toEqual({ changed: false, changes: [] });
    expect(diffRobotOutputs({ a: 1, b: 'x' }, { a: 2, c: true }).changes).toEqual([
      { key: 'a', kind: 'changed', before: 1, after: 2 },
      { key: 'b', kind: 'removed', before: 'x' },
      { key: 'c', kind: 'added', after: true },
    ]);
  });

  it('compara listas por fila sin importar el orden ni las URLs de archivos', () => {
    expect(diffRobotOutputs({ rows: [{ a: 1 }, { a: 2 }] }, { rows: [{ a: 2 }, { a: 1 }] }).changed).toBe(false);
    expect(
      diffRobotOutputs(
        { f: { url: 'https://blob/1', filename: 'r.pdf', size: 10 } },
        { f: { url: 'https://blob/2', filename: 'r.pdf', size: 10 } },
      ).changed,
    ).toBe(false);
    const d = diffRobotOutputs({ rows: [{ a: 1 }, { a: 2 }, { a: 2 }] }, { rows: [{ a: 2 }, { a: 3 }] });
    expect(d.changes).toEqual([
      { key: 'rows', kind: 'rows', added: [{ a: 3 }], removed: [{ a: 1 }, { a: 2 }], addedCount: 1, removedCount: 2, before: 3, after: 2 },
    ]);
  });
});

function backendWith(outputs: Array<Record<string, unknown>>): RobotBackend {
  let i = 0;
  return {
    name: 'local',
    run: async () => ({ status: 'success', error: null, vars: outputs[Math.min(i++, outputs.length - 1)], logs: [], screenshots: [], pages: 1 }),
  };
}

async function robotFor(ws: string, patch: Parameters<typeof updateRobot>[2] = {}) {
  const r = await createRobot(ws, ws, { name: 'Prices' });
  if (!r.ok) throw new Error(r.error);
  await updateRobot(ws, r.robot.id, { enabled: true, ...patch });
  return r.robot.id;
}

describe('robot.output.changed', () => {
  it('es un evento de Flow y de webhooks', () => {
    expect(FLOW_EVENT_TYPES).toContain('robot.output.changed');
    expect(WEBHOOK_EVENTS).toContain('robot.output.changed');
  });

  it('marca la corrida y emite el evento con el diff solo cuando cambian los datos', async () => {
    const user = await makeUser('chg');
    const id = await robotFor(user.id);
    const flow = await createFlow(user.id, user.id, {
      name: 'on change',
      graph: { nodes: [{ id: 't', type: 'trigger.event', position: { x: 0, y: 0 }, config: { event: 'robot.output.changed' } }], edges: [] },
    });
    if (!flow.ok) throw new Error('flow');
    await getDb().prepare('UPDATE flow_flows SET enabled = 1 WHERE id = ?').run(flow.flow.id);
    setRobotBackendForTests(backendWith([{ price: '10' }, { price: '10' }, { price: '12' }]));
    const first = await startRobotRun(user.id, id, {}, { trigger: 'manual' });
    expect(first.ok && first.run.changed).toBe(null);
    const second = await startRobotRun(user.id, id, {}, { trigger: 'manual' });
    expect(second.ok && second.run.changed).toBe(false);
    const third = await startRobotRun(user.id, id, {}, { trigger: 'manual' });
    expect(third.ok && third.run.changed).toBe(true);
    const queued = (await getDb().prepare('SELECT input FROM flow_runs WHERE flow_id = ?').all(flow.flow.id)) as Array<{ input: string }>;
    expect(queued).toHaveLength(1);
    expect(JSON.parse(queued[0].input)).toMatchObject({
      robot: { id },
      previousRunId: second.ok ? second.run.id : '',
      diff: [{ key: 'price', kind: 'changed', before: '10', after: '12' }],
      output: { price: '12' },
    });
  });

  it('compara solo con corridas de las mismas entradas', async () => {
    const user = await makeUser('chg-in');
    const id = await robotFor(user.id, { inputs: [{ name: 'url', default: '' }] });
    setRobotBackendForTests(backendWith([{ v: 1 }, { v: 2 }, { v: 1 }]));
    await startRobotRun(user.id, id, { url: 'a' }, { trigger: 'manual' });
    const b = await startRobotRun(user.id, id, { url: 'b' }, { trigger: 'manual' });
    expect(b.ok && b.run.changed).toBe(null);
    const a2 = await startRobotRun(user.id, id, { url: 'a' }, { trigger: 'manual' });
    expect(a2.ok && a2.run.changed).toBe(false);
  });
});

// ---------- API v1 ----------

function req(url: string, key: string, body?: unknown): Request {
  return new Request(`http://localhost${url}`, {
    method: body === undefined ? 'GET' : 'POST',
    headers: { authorization: `Bearer ${key}`, 'content-type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}
const params = (id: string) => ({ params: Promise.resolve({ id }) });

describe('API v1 de robots', () => {
  it('las rutas piden el scope robots:run', async () => {
    const robots = API_ENDPOINTS.filter((e) => e.sectionId === 'robots');
    expect(robots.length).toBe(5);
    expect(robots.every((e) => endpointScope(e) === 'robots:run')).toBe(true);
    const user = await makeUser('api-scope');
    const { key } = await createApiKey(user.id, 'crm only', user.id, ['crm:read']);
    const res = await listRoute.GET(req('/api/v1/robots', key));
    expect(res.status).toBe(403);
  });

  it('lista, corre en cola (202) y se consulta la corrida', async () => {
    const user = await makeUser('api-run');
    const id = await robotFor(user.id, { inputs: [{ name: 'url', required: true }] });
    setRobotBackendForTests(backendWith([{ title: 'Hello' }]));
    const { key } = await createApiKey(user.id, 'robots', user.id, ['robots:run']);
    const list = await (await listRoute.GET(req('/api/v1/robots', key))).json();
    expect(list.robots).toMatchObject([{ id, name: 'Prices', inputs: [{ name: 'url', required: true }] }]);

    const missing = await runsRoute.POST(req(`/api/v1/robots/${id}/runs`, key, {}), params(id));
    expect(missing.status).toBe(400);
    expect((await missing.json()).error.code).toBe('missing_input');

    const queued = await runsRoute.POST(req(`/api/v1/robots/${id}/runs`, key, { inputs: { url: 'https://a.test' } }), params(id));
    expect(queued.status).toBe(202);
    const { run } = await queued.json();
    expect(run).toMatchObject({ status: 'queued', trigger: 'api', input: { url: 'https://a.test' } });
    expect(run.logs).toBeUndefined();
    expect(await drainRobotQueue({ workspaceId: user.id })).toBe(1);
    const got = await (await runRoute.GET(req(`/api/v1/robots/runs/${run.id}`, key), params(run.id))).json();
    expect(got.run).toMatchObject({ status: 'success', output: { title: 'Hello' } });

    const waited = await runsRoute.POST(req(`/api/v1/robots/${id}/runs`, key, { inputs: { url: 'https://b.test' }, wait: true }), params(id));
    expect(waited.status).toBe(200);
    expect((await waited.json()).run.status).toBe('success');
    const history = await (await runsRoute.GET(req(`/api/v1/robots/${id}/runs`, key), params(id))).json();
    expect(history.runs).toHaveLength(2);
  });

  it('bulk: una corrida en cola por entrada, valida todas antes y se sigue por lote', async () => {
    const user = await makeUser('api-bulk');
    const id = await robotFor(user.id, { inputs: [{ name: 'url', required: true }] });
    setRobotBackendForTests({
      name: 'local',
      run: async (job) => ({ status: 'success', error: null, vars: { got: job.inputs.url }, logs: [], screenshots: [], pages: 1 }),
    });
    const { key } = await createApiKey(user.id, 'robots', user.id, ['robots:run']);
    const bad = await bulkRoute.POST(req(`/api/v1/robots/${id}/bulk`, key, { inputs: [{ url: 'a' }, {}] }), params(id));
    expect(bad.status).toBe(400);
    expect((await bad.json()).error.message).toContain('inputs[1]');
    expect(await listRobotRuns(user.id, id)).toHaveLength(0);

    const tooMany = await bulkRoute.POST(req(`/api/v1/robots/${id}/bulk`, key, { inputs: Array.from({ length: 101 }, () => ({ url: 'x' })) }), params(id));
    expect(tooMany.status).toBe(400);

    const ok = await bulkRoute.POST(req(`/api/v1/robots/${id}/bulk`, key, { inputs: [{ url: 'a' }, { url: 'b' }, { url: 'c' }] }), params(id));
    expect(ok.status).toBe(202);
    const body = await ok.json();
    expect(body.total).toBe(3);
    expect(body.runs.map((r: { status: string }) => r.status)).toEqual(['queued', 'queued', 'queued']);
    expect(await drainRobotQueue({ workspaceId: user.id })).toBe(3);
    const batch = await (await batchRoute.GET(req(`/api/v1/robots/batches/${body.batchId}`, key), params(body.batchId))).json();
    expect(batch).toMatchObject({ total: 3, done: true, counts: { success: 3, queued: 0 } });
    expect(batch.runs.map((r: { output: { got: string } }) => r.output.got)).toEqual(['a', 'b', 'c']);
    expect((await getRobotBatch(user.id, body.batchId))?.runs.every((r) => r.trigger === 'api' && r.batchId === body.batchId)).toBe(true);
    // Otro workspace no ve el lote.
    const other = await makeUser('api-bulk-2');
    const { key: otherKey } = await createApiKey(other.id, 'robots', other.id, ['robots:run']);
    expect((await batchRoute.GET(req(`/api/v1/robots/batches/${body.batchId}`, otherKey), params(body.batchId))).status).toBe(404);
  });

  it('un robot sin corridas automáticas no corre por la API', async () => {
    const user = await makeUser('api-off');
    const id = await robotFor(user.id, { enabled: false });
    setRobotBackendForTests(backendWith([{}]));
    const { key } = await createApiKey(user.id, 'robots', user.id, ['robots:run']);
    const res = await runsRoute.POST(req(`/api/v1/robots/${id}/runs`, key, {}), params(id));
    expect((await res.json()).error.code).toBe('disabled');
  });
});

// ---------- Agents: run_robot ----------

const BASE_TOOLS: Omit<AgentToolsConfig, 'enabled'> = {
  calEventTypeId: null,
  calDays: 7,
  trackProjectId: null,
  flowIds: [],
  robotIds: [],
  httpAllowedDomains: [],
};

describe('Agents: run_robot', () => {
  const ENV_KEYS = ['AI_GATEWAY_API_KEY', 'VERCEL_OIDC_TOKEN', 'VERCEL', 'AI_ENABLED', 'AI_FREE_TOKENS_PER_MONTH'];
  const saved: Record<string, string | undefined> = {};
  beforeEach(() => {
    for (const k of ENV_KEYS) {
      saved[k] = process.env[k];
      delete process.env[k];
    }
  });
  afterEach(() => {
    for (const k of ENV_KEYS) {
      if (saved[k] === undefined) delete process.env[k];
      else process.env[k] = saved[k];
    }
  });

  async function setup(label: string) {
    const owner = await makeUser(label);
    const robotId = await robotFor(owner.id, { inputs: [{ name: 'query', required: true }] });
    const created = await createAgent(owner.id, owner.id, { name: 'Browser' });
    const foreign = await makeUser(`${label}-x`);
    const foreignRobot = await robotFor(foreign.id);
    const bad = await updateAgent(owner.id, created.id, { tools: { ...BASE_TOOLS, enabled: ['run_robot'], robotIds: [foreignRobot] } });
    expect(bad).toEqual({ ok: false, error: 'invalid_robot' });
    const ok = await updateAgent(owner.id, created.id, { tools: { ...BASE_TOOLS, enabled: ['run_robot'], robotIds: [robotId, robotId] } });
    expect(ok.ok && ok.agent.tools.robotIds).toEqual([robotId]);
    return { owner, robotId, agent: (await getAgentRow(owner.id, created.id)) as AgentRow };
  }

  it('en el playground se simula: no abre el navegador ni crea corridas', async () => {
    const { owner, robotId, agent } = await setup('ag-rb-dry');
    const run = vi.fn();
    setRobotBackendForTests({ name: 'local', run });
    setAiModelOverride(
      scriptedModel([
        { tool: 'run_robot', input: { robotId, inputs: {} } },
        { tool: 'run_robot', input: { robotId, inputs: { query: 'shoes' } } },
        { text: 'Done.' },
      ]),
    );
    const res = await sendAgentMessage({ agent, channel: 'playground', text: 'find shoes' });
    const calls = res.result.toolCalls;
    expect(calls[0].output).toEqual({ error: 'missing_input', input: 'query' });
    expect(isSimulatedOutput(calls[1].output)).toBe(true);
    expect(calls[1].output).toMatchObject({ wouldRun: { action: 'run_robot', robot: 'Prices', inputs: { query: 'shoes' } } });
    expect(run).not.toHaveBeenCalled();
    expect(await listRobotRuns(owner.id, robotId)).toHaveLength(0);
  });

  it('fuera del playground corre el robot y devuelve su salida', async () => {
    const { owner, robotId, agent } = await setup('ag-rb-live');
    let seen: RobotJob | null = null;
    setRobotBackendForTests({
      name: 'local',
      run: async (job) => {
        seen = job;
        return { status: 'success', error: null, vars: { results: ['A', 'B'] }, logs: [], screenshots: [], pages: 1 };
      },
    });
    setAiModelOverride(scriptedModel([{ tool: 'run_robot', input: { robotId, inputs: { query: 'shoes' } } }, { text: 'Found 2.' }]));
    const res = await sendAgentMessage({ agent, channel: 'api', text: 'find shoes' });
    expect(res.result.toolCalls[0].output).toMatchObject({ status: 'success', output: { results: ['A', 'B'] } });
    expect(seen!.inputs).toEqual({ query: 'shoes' });
    expect(seen!.timeoutMs).toBeLessThanOrEqual(60_000);
    const runs = await listRobotRuns(owner.id, robotId);
    expect(runs.map((r) => r.trigger)).toEqual(['agent']);
  });
});
