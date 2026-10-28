import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';
import { getDb } from '@/lib/db';
import { createCredential } from '@/lib/flow-credentials';
import { REDACTED } from '@/lib/flow-credentials-schema';
import { createRobot, getRobot, startRobotRun, updateRobot } from '@/lib/robots';
import { robotInterpreter, type InterpreterStep, type RobotLocator, type RobotPage } from '@/lib/robots-interpreter';
import { robotBackendName, setRobotBackendForTests, type RobotBackend, type RobotJob } from '@/lib/robots-runner';
import {
  buildRecorderScript,
  generateSelector,
  parseRecordedSteps,
  PASSWORD_PLACEHOLDER,
  recorderBookmarklet,
  type ElementInfo,
} from '@/lib/robots-recorder';
import { robotScheduleSchema, validateSteps } from '@/lib/robots-schema';
import { makeUser } from './helpers';

const session = vi.hoisted(() => ({ user: null as null | Record<string, unknown> }));
vi.mock('@/lib/session', () => ({ getCurrentUser: async () => session.user }));

const sessionRoute = await import('@/lib/routes/robots/[id]/session/route');

beforeEach(() => {
  vi.stubEnv('RATE_LIMIT_DISABLED', 'true');
  vi.stubEnv('FLOW_WORKER_KICK', 'false');
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  setRobotBackendForTests(undefined);
  session.user = null;
});

function steps(list: unknown[]): InterpreterStep[] {
  const v = validateSteps(list);
  if (!v.ok) throw new Error(`invalid: ${v.error} at ${v.index}`);
  return v.steps as unknown as InterpreterStep[];
}

/** Página falsa mínima: cada selector existe; `failures[sel]` = clics que fallan antes de andar. */
function fakePage(opts: { failures?: Record<string, number>; evaluate?: (expr: string) => unknown } = {}) {
  const actions: string[] = [];
  const failures = { ...(opts.failures ?? {}) };
  const loc = (sel: string): RobotLocator => {
    const l: RobotLocator = {
      first: () => l,
      count: async () => 1,
      click: async () => {
        if ((failures[sel] ?? 0) > 0) {
          failures[sel] -= 1;
          throw new Error('Element is not attached to the DOM');
        }
        actions.push(`click:${sel}`);
      },
      fill: async (v) => void actions.push(`fill:${sel}=${v}`),
      selectOption: async (v) => [v],
      press: async (k) => void actions.push(`press:${k}`),
      innerText: async () => 'text',
      getAttribute: async () => null,
      allInnerTexts: async () => [],
      evaluateAll: async <R,>() => [] as unknown as R,
      evaluate: async <R,>() => [] as unknown as R,
      waitFor: async () => {},
      scrollIntoViewIfNeeded: async () => {},
      setInputFiles: async (f) => void actions.push(`upload:${sel}=${f.name}:${f.mimeType}:${(f.buffer as Buffer).length}`),
    };
    return l;
  };
  const page: RobotPage = {
    goto: async (url) => void actions.push(`goto:${url}`),
    url: () => '',
    locator: loc,
    getByText: (t) => loc(`text=${t}`),
    keyboard: { press: async () => {} },
    waitForTimeout: async (ms) => void actions.push(`wait:${ms}`),
    screenshot: async () => new Uint8Array([1]),
    evaluate: async <R,>(fn: unknown) => (typeof fn === 'string' ? (opts.evaluate?.(fn) as R) : (true as unknown as R)),
    waitForEvent: async () => ({
      suggestedFilename: () => 'report.csv',
      createReadStream: async () =>
        (async function* () {
          yield new Uint8Array(Buffer.from('a,b\n'));
          yield new Uint8Array(Buffer.from('1,2\n'));
        })(),
    }),
    pdf: async () => new Uint8Array(Buffer.from('%PDF-1.4 fake')),
  };
  return { page, actions };
}

const opts = (extra: Partial<Parameters<typeof robotInterpreter>[3]> = {}) => ({
  deadline: Date.now() + 30_000,
  checkUrl: async () => null,
  ...extra,
});

// ---------- Credenciales ----------

describe('robots: credenciales', () => {
  it('resuelve {{credentials.<name>.x}} en el intérprete', async () => {
    const { page, actions } = fakePage();
    const res = await robotInterpreter(
      page,
      steps([
        { type: 'fill', selector: '#user', value: '{{credentials.login.username}}' },
        { type: 'fill', selector: '#pass', value: '{{credentials.login.password}}' },
      ]),
      {},
      opts({ credentials: { login: { username: 'ada', password: 'hunter2-secret' } } }),
    );
    expect(res.status).toBe('success');
    expect(actions).toEqual(['fill:#user=ada', 'fill:#pass=hunter2-secret']);
    // El log del fill muestra el selector, nunca el valor.
    expect(JSON.stringify(res.logs)).not.toContain('hunter2');
  });

  it('el servidor resuelve solo credenciales del workspace y redacta logs, salidas y errores', async () => {
    const ws = (await makeUser('rcred')).id;
    const other = (await makeUser('rcred')).id;
    await createCredential(ws, ws, { name: 'login', type: 'basic', data: { username: 'ada', password: 'hunter2-secret' } });
    await createCredential(other, other, { name: 'theirs', type: 'basic', data: { username: 'x', password: 'other-secret' } });
    const r = await createRobot(ws, ws, { name: 'Login' });
    if (!r.ok) throw new Error(r.error);
    await updateRobot(ws, r.robot.id, {
      steps: [
        { type: 'goto', url: 'https://app.example.com/login' },
        { type: 'fill', selector: '#pass', value: '{{credentials.login.password}}' },
      ],
    });
    let job: RobotJob | null = null;
    const backend: RobotBackend = {
      name: 'local',
      async run(j) {
        job = j;
        // Un sitio que muestra la contraseña: igual no queda guardada.
        return {
          status: 'failed',
          error: '2: wrong password hunter2-secret',
          vars: { echo: 'you typed hunter2-secret' },
          logs: [{ step: '2', type: 'fill', status: 'failed', ms: 1, detail: 'hunter2-secret' }],
          screenshots: [{ name: 'shot-hunter2-secret', data: 'AAAA', type: 'image/jpeg' }],
          pages: 1,
        };
      },
    };
    setRobotBackendForTests(backend);
    const res = await startRobotRun(ws, r.robot.id, {}, { trigger: 'manual' });
    expect(res.ok).toBe(true);
    expect(job!.credentials).toEqual({ login: { username: 'ada', password: 'hunter2-secret' } });
    const run = res.ok ? res.run : null;
    expect(JSON.stringify(run)).not.toContain('hunter2-secret');
    expect(run?.error).toBe(`2: wrong password ${REDACTED}`);
    expect(run?.output).toEqual({ echo: `you typed ${REDACTED}` });
    const stored = (await getDb().prepare('SELECT * FROM robot_runs WHERE id = ?').get(run!.id)) as Record<string, string>;
    expect(JSON.stringify(stored)).not.toContain('hunter2-secret');

    // Credencial inexistente (u otro workspace): no corre.
    await updateRobot(ws, r.robot.id, { steps: [{ type: 'fill', selector: '#p', value: '{{credentials.theirs.password}}' }] });
    expect(await startRobotRun(ws, r.robot.id, {}, { trigger: 'manual' })).toEqual({ ok: false, error: 'missing_credential', name: 'theirs' });
  });
});

// ---------- Pasos nuevos y reintentos ----------

describe('robots: pasos nuevos', () => {
  it('reintenta un paso (cantidad + espera) y registra los intentos', async () => {
    const { page, actions } = fakePage({ failures: { '#flaky': 2 } });
    const ok = await robotInterpreter(page, steps([{ type: 'click', selector: '#flaky', retries: 2, retryDelayMs: 250 }]), {}, opts());
    expect(ok.status).toBe('success');
    expect(actions).toEqual(['wait:250', 'wait:250', 'click:#flaky']);
    expect(ok.logs[0].detail).toContain('2 retries');

    const { page: p2 } = fakePage({ failures: { '#flaky': 2 } });
    const bad = await robotInterpreter(p2, steps([{ type: 'click', selector: '#flaky', retries: 1 }]), {}, opts());
    expect(bad).toMatchObject({ status: 'failed', error: '1: action_failed' });

    // Errores que no se arreglan reintentando (URL privada) no se reintentan.
    const { page: p3, actions: a3 } = fakePage();
    const blocked = await robotInterpreter(
      p3,
      steps([{ type: 'goto', url: 'http://10.0.0.1', retries: 3, retryDelayMs: 100 }]),
      {},
      opts({ checkUrl: async () => 'private_host' }),
    );
    expect(blocked.error).toBe('1: private_host');
    expect(a3).toEqual([]);
  });

  it('evaluate (JSON desde la página), pdf y download generan variables y archivos', async () => {
    const { page } = fakePage({
      evaluate: (expr) => {
        expect(expr).toContain('return document.title;');
        return JSON.stringify({ title: 'Home', n: 2 });
      },
    });
    const res = await robotInterpreter(
      page,
      steps([
        { type: 'evaluate', script: 'return document.title;', name: 'info' },
        { type: 'pdf', name: 'page' },
        { type: 'download', selector: 'a.export', name: 'report' },
      ]),
      {},
      opts(),
    );
    expect(res.status).toBe('success');
    expect(res.vars.info).toEqual({ title: 'Home', n: 2 });
    expect(res.files?.map((f) => [f.name, f.filename, f.contentType, f.size])).toEqual([
      ['page', 'page.pdf', 'application/pdf', 13],
      ['report', 'report.csv', 'text/csv', 8],
    ]);
    expect(Buffer.from(res.files![1].data, 'base64').toString()).toBe('a,b\n1,2\n');

    const { page: big } = fakePage();
    const tooBig = await robotInterpreter(big, steps([{ type: 'download', selector: 'a', name: 'f' }]), {}, opts({ maxFileBytes: 4 }));
    expect(tooBig.error).toBe('1: file_too_large');
  });

  it('upload baja el archivo de una URL pública y lo pone en el input', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('hello', { headers: { 'content-type': 'text/plain' } })));
    const { page, actions } = fakePage();
    const res = await robotInterpreter(
      page,
      steps([{ type: 'upload', selector: 'input[type=file]', url: 'https://files.example.com/docs/cv.txt' }]),
      {},
      opts(),
    );
    expect(res.status).toBe('success');
    expect(actions).toEqual(['upload:input[type=file]=cv.txt:text/plain:5']);
    const blocked = await robotInterpreter(
      page,
      steps([{ type: 'upload', selector: 'input', url: 'http://169.254.169.254/x' }]),
      {},
      opts({ checkUrl: async () => 'private_host' }),
    );
    expect(blocked.error).toBe('1: private_host');
  });

  it('el servidor sube los archivos y deja la URL en la variable', async () => {
    const ws = (await makeUser('rfiles')).id;
    const r = await createRobot(ws, ws, { name: 'Files' });
    if (!r.ok) throw new Error(r.error);
    setRobotBackendForTests({
      name: 'local',
      async run() {
        return {
          status: 'success',
          error: null,
          vars: { report: { filename: 'r.csv', size: 3 } },
          logs: [],
          screenshots: [],
          pages: 1,
          files: [{ name: 'report', filename: 'r.csv', contentType: 'text/csv', size: 3, data: Buffer.from('a,b').toString('base64') }],
        };
      },
    });
    const res = await startRobotRun(ws, r.robot.id, {}, { trigger: 'manual' });
    const out = res.ok ? (res.run.output.report as { url: string; filename: string }) : null;
    expect(out?.url).toMatch(/^\/uploads\/robots\/.+-r\.csv$/);
    expect(out?.filename).toBe('r.csv');
  });
});

// ---------- Sesiones ----------

describe('robots: sesiones guardadas', () => {
  it('guarda cookies/localStorage cifrados entre corridas y "Borrar sesión" las descarta', async () => {
    const ws = (await makeUser('rsess')).id;
    const r = await createRobot(ws, ws, { name: 'Sess' });
    if (!r.ok) throw new Error(r.error);
    const jobs: RobotJob[] = [];
    setRobotBackendForTests({
      name: 'local',
      async run(j) {
        jobs.push(j);
        return {
          status: 'success',
          error: null,
          vars: {},
          logs: [],
          screenshots: [],
          pages: 1,
          storageState: { cookies: [{ name: 'sid', value: `cookie-${jobs.length}` }], origins: [] },
        };
      },
    });
    // Sin la opción, no se guarda nada.
    await startRobotRun(ws, r.robot.id, {}, { trigger: 'manual' });
    expect(jobs[0]).toMatchObject({ saveSession: false, storageState: undefined });
    expect((await getRobot(ws, r.robot.id))?.hasSession).toBe(false);

    await updateRobot(ws, r.robot.id, { persistSession: true });
    await startRobotRun(ws, r.robot.id, {}, { trigger: 'manual' });
    expect(jobs[1]).toMatchObject({ saveSession: true, storageState: undefined });
    const row = (await getDb().prepare('SELECT data FROM robot_sessions WHERE robot_id = ?').get(r.robot.id)) as { data: string };
    expect(row.data).not.toContain('cookie-2');
    expect((await getRobot(ws, r.robot.id))?.hasSession).toBe(true);
    await startRobotRun(ws, r.robot.id, {}, { trigger: 'manual' });
    expect(jobs[2].storageState).toEqual({ cookies: [{ name: 'sid', value: 'cookie-2' }], origins: [] });

    const other = await makeUser('rsess');
    session.user = { ...other, role: 'owner' };
    const ctx = { params: Promise.resolve({ id: r.robot.id }) };
    expect((await sessionRoute.DELETE(new NextRequest('http://localhost/x', { method: 'DELETE' }), ctx)).status).toBe(404);
    session.user = { ...(await makeUser('x')), id: ws, role: 'owner' };
    expect((await sessionRoute.DELETE(new NextRequest('http://localhost/x', { method: 'DELETE' }), ctx)).status).toBe(200);
    expect((await getRobot(ws, r.robot.id))?.hasSession).toBe(false);
    await startRobotRun(ws, r.robot.id, {}, { trigger: 'manual' });
    expect(jobs[3].storageState).toBeUndefined();
  });
});

// ---------- Schedules y runner ----------

describe('robots: schedules y runner', () => {
  it('intervalos en minutos (mínimo 5) y cron', async () => {
    expect(robotScheduleSchema.safeParse({ mode: 'interval', every: 4, unit: 'minutes' }).success).toBe(false);
    expect(robotScheduleSchema.safeParse({ mode: 'interval', every: 5, unit: 'minutes' }).success).toBe(true);
    expect(robotScheduleSchema.safeParse({ mode: 'interval', every: 15, unit: 'minutes' }).success).toBe(true);
    expect(robotScheduleSchema.safeParse({ mode: 'interval', every: 200, unit: 'hours' }).success).toBe(false);
    const ws = (await makeUser('rsched')).id;
    const r = await createRobot(ws, ws, { name: 'S' });
    if (!r.ok) throw new Error(r.error);
    const before = Date.now();
    const up = await updateRobot(ws, r.robot.id, { schedule: { mode: 'interval', every: 15, unit: 'minutes', time: '09:00', timezone: 'UTC' } });
    const next = new Date(up.ok ? up.robot.nextRunAt! : 0).getTime();
    expect(next - before).toBeGreaterThanOrEqual(15 * 60_000 - 1000);
    expect(next - before).toBeLessThan(16 * 60_000);
    const cron = await updateRobot(ws, r.robot.id, { schedule: { mode: 'cron', cron: '0 6 * * *', time: '09:00', timezone: 'UTC', every: 1, unit: 'hours' } });
    expect(cron.ok && new Date(cron.robot.nextRunAt!).getUTCHours()).toBe(6);
  });

  it('sin ROBOTS_RUNNER y fuera de Vercel usa el runner local si playwright-core está instalado', () => {
    vi.stubEnv('ROBOTS_RUNNER', '');
    vi.stubEnv('VERCEL', '');
    expect(robotBackendName()).toBe('local');
    vi.stubEnv('VERCEL', '1');
    expect(robotBackendName()).toBe('sandbox');
    vi.stubEnv('ROBOTS_RUNNER', 'none');
    expect(robotBackendName()).toBe('none');
  });
});

// ---------- Grabador ----------

function el(tag: string, extra: Partial<ElementInfo> = {}): ElementInfo {
  return { tag, attrs: {}, ...extra };
}

describe('robots: grabador', () => {
  const uniq = (set: string[]) => (sel: string) => set.includes(sel);

  it('prefiere data-testid, id estable, name y aria-label', () => {
    expect(generateSelector(el('button', { attrs: { 'data-testid': 'save' }, id: 'b1' }), uniq(['[data-testid="save"]', '#b1']))).toEqual({
      selector: '[data-testid="save"]',
    });
    expect(generateSelector(el('input', { id: 'email', attrs: { name: 'email' } }), uniq(['#email', 'input[name="email"]']))).toEqual({
      selector: '#email',
    });
    // Id autogenerado (con números o prefijos de librerías): se saltea.
    expect(generateSelector(el('input', { id: 'react-select-123', attrs: { name: 'q' } }), uniq(['#react-select-123', 'input[name="q"]']))).toEqual({
      selector: 'input[name="q"]',
    });
    expect(generateSelector(el('button', { attrs: { 'aria-label': 'Close "dialog"' } }), uniq(['button[aria-label="Close \\"dialog\\""]']))).toEqual({
      selector: 'button[aria-label="Close \\"dialog\\""]',
    });
  });

  it('usa el texto visible para clics y si no, un camino CSS corto', () => {
    expect(generateSelector(el('a', { text: '  Sign   in ' }), () => false, { allowText: true })).toEqual({ selector: '', text: 'Sign in' });
    const parent = el('form', { id: 'login', parent: el('body') });
    const input = el('input', { nth: 2, sameTag: 3, parent });
    expect(generateSelector(input, uniq(['#login > input:nth-of-type(2)']))).toEqual({ selector: '#login > input:nth-of-type(2)' });
    const deep = el('span', { parent: el('div', { nth: 1, sameTag: 2, parent: el('main', { parent: el('body') }) }) });
    expect(generateSelector(deep, uniq(['main > div:nth-of-type(1) > span']))).toEqual({ selector: 'main > div:nth-of-type(1) > span' });
    expect(generateSelector(el('td', { parent: el('body') }), () => false)).toEqual({ selector: 'body > td' });
  });

  it('el bookmarklet es JS válido, no graba contraseñas y los pasos pegados se validan', () => {
    const labels = { recording: 'Rec', steps: 'steps', copy: 'Copy', copied: 'Copied', clear: 'Clear', close: 'Close', hint: 'Hint' };
    const script = buildRecorderScript(labels);
    expect(() => new Function(script)).not.toThrow();
    expect(script).toContain(PASSWORD_PLACEHOLDER);
    expect(recorderBookmarklet(labels).startsWith('javascript:')).toBe(true);

    const pasted = parseRecordedSteps(
      JSON.stringify({
        zerosoftRobotSteps: 1,
        steps: [
          { type: 'goto', url: 'https://app.example.com' },
          { type: 'fill', selector: '#email', value: 'ada@example.com' },
          { type: 'fill', selector: '#password', value: PASSWORD_PLACEHOLDER },
          { type: 'click', selector: '', text: 'Sign in', junk: true },
        ],
      }),
    );
    expect(pasted.ok && pasted.steps.length).toBe(4);
    expect(pasted.ok && pasted.steps[3]).toEqual({ type: 'click', selector: '', text: 'Sign in' });
    expect(parseRecordedSteps('nope')).toEqual({ ok: false, error: 'invalid_json' });
    expect(parseRecordedSteps('{"steps": []}')).toEqual({ ok: false, error: 'no_steps' });
    expect(parseRecordedSteps('[{"type": "teleport"}]')).toMatchObject({ ok: false, error: 'invalid_steps', index: 0 });
  });
});
