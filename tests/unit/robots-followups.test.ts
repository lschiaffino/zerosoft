import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { getDb } from '@/lib/db';
import { createCredential } from '@/lib/flow-credentials';
import {
  adoptLoginRobot,
  batchExpiry,
  createRobot,
  createRobotRecording,
  enqueueRobotBatch,
  expireQueuedRobotRuns,
  getRobotRow,
  getUsage,
  pushRobotRecording,
  runDueRobots,
  startRobotRun,
} from '@/lib/robots';
import { buildRecorderScript, onlyRecorderSteps, selectorAlternatives } from '@/lib/robots-recorder';
import { robotInterpreter, type InterpreterStep, type RobotLocator, type RobotPage } from '@/lib/robots-interpreter';
import { setRobotBackendForTests, type RobotBackend } from '@/lib/robots-runner';
import { batchRowsCovered, validateSteps } from '@/lib/robots-schema';
import { makeUser } from './helpers';

beforeEach(() => {
  vi.stubEnv('RATE_LIMIT_DISABLED', 'true');
  vi.stubEnv('FLOW_WORKER_KICK', 'false');
  vi.stubEnv('ROBOTS_QUEUE_KICK', 'false');
});

afterEach(() => {
  vi.unstubAllEnvs();
  setRobotBackendForTests(undefined);
});

function steps(list: unknown[]): InterpreterStep[] {
  const v = validateSteps(list);
  if (!v.ok) throw new Error(`invalid: ${v.error} at ${v.index}`);
  return v.steps as unknown as InterpreterStep[];
}

type El = { t: string; type?: string; nm: string; pw?: boolean };

/** Página falsa: qué elementos hay por selector, y en qué URL está (cambia con goto o una redirección). */
function fakePage(els: Record<string, El>, opts: { redirect?: Record<string, string> } = {}) {
  const actions: string[] = [];
  let url = 'about:blank';
  const loc = (sel: string): RobotLocator => {
    const l: RobotLocator = {
      first: () => l,
      count: async () => (els[sel] ? 1 : 0),
      click: async () => {
        if (!els[sel]) throw new Error('Timeout 15000ms exceeded');
        actions.push(`click:${sel}`);
      },
      fill: async (v) => {
        if (!els[sel]) throw new Error('Timeout 15000ms exceeded');
        actions.push(`fill:${sel}=${v}`);
      },
      selectOption: async () => [],
      press: async () => {},
      innerText: async () => '',
      getAttribute: async () => null,
      allInnerTexts: async () => [],
      evaluateAll: async <R,>() => [] as unknown as R,
      evaluate: async <R,>() => {
        const e = els[sel];
        if (!e) throw new Error('no element');
        return { t: e.t, type: e.type ?? '', nm: e.nm, pw: !!e.pw } as unknown as R;
      },
      waitFor: async () => {},
      scrollIntoViewIfNeeded: async () => {},
    };
    return l;
  };
  const page: RobotPage = {
    goto: async (u) => {
      actions.push(`goto:${u}`);
      url = opts.redirect?.[u] ?? u;
    },
    url: () => url,
    locator: loc,
    getByText: (text) => loc(`text=${text}`),
    keyboard: { press: async () => {} },
    waitForTimeout: async () => {},
    screenshot: async () => new Uint8Array([1]),
    evaluate: async <R,>() => null as unknown as R,
  };
  return { page, actions };
}

const opts = { deadline: Date.now() + 60_000, checkUrl: async () => null, actionTimeout: 600 };
const creds = { LOGIN: { username: 'ada', password: 'pw-secret-1' } };

describe('robots: alternativos en acciones y logins', () => {
  it('un alternativo de solo clases que da con "Delete account" no se usa: el paso falla', async () => {
    const { page, actions } = fakePage({ 'button.btn-primary': { t: 'button', nm: 'Delete account' } });
    const res = await robotInterpreter(
      page,
      steps([{ type: 'click', selector: '#save', fallbacks: ['button.btn-primary'], identity: { tag: 'button', type: '', name: 'Save' } }]),
      {},
      opts,
    );
    expect(res.status).toBe('failed');
    expect(actions).not.toContain('click:button.btn-primary');
  });

  it('una acción sin el elemento grabado no usa alternativos', async () => {
    const { page, actions } = fakePage({ 'button.x': { t: 'button', nm: 'Save' } });
    const res = await robotInterpreter(page, steps([{ type: 'click', selector: '#save', fallbacks: ['button.x'] }]), {}, opts);
    expect(res.status).toBe('failed');
    expect(actions).toEqual([]);
  });

  it('usa el alternativo si es la misma etiqueta, tipo y nombre visible', async () => {
    const { page, actions } = fakePage({ 'button[name="save"]': { t: 'button', type: 'submit', nm: 'Save' } });
    const res = await robotInterpreter(
      page,
      steps([{ type: 'click', selector: '#save', fallbacks: ['button[name="save"]'], identity: { tag: 'button', type: 'submit', name: 'Save' } }]),
      {},
      opts,
    );
    expect(res.status).toBe('success');
    expect(actions).toEqual(['click:button[name="save"]']);
  });

  it('un fill con credencial nunca usa alternativos (la contraseña no va a un buscador)', async () => {
    const { page, actions } = fakePage({ 'input[name="q"]': { t: 'input', type: 'text', nm: 'Search' } });
    const res = await robotInterpreter(
      page,
      steps([
        { type: 'goto', url: 'https://app.test/login' },
        { type: 'fill', selector: '#password', value: '{{credentials.LOGIN.password}}', fallbacks: ['input[name="q"]'], identity: { tag: 'input', type: 'text', name: 'Search' } },
      ]),
      {},
      { ...opts, credentials: creds },
    );
    expect(res.status).toBe('failed');
    expect(actions.some((a) => a.startsWith('fill:'))).toBe(false);
    expect(JSON.stringify(res)).not.toContain('pw-secret-1');
  });

  it('un alternativo que da con un campo de contraseña no se usa', async () => {
    const { page, actions } = fakePage({ '#pw2': { t: 'input', type: 'password', nm: 'Email', pw: true } });
    const res = await robotInterpreter(
      page,
      steps([{ type: 'fill', selector: '#email', value: 'ada@x.test', fallbacks: ['#pw2'], identity: { tag: 'input', type: 'password', name: 'Email' } }]),
      {},
      opts,
    );
    expect(res.status).toBe('failed');
    expect(actions).toEqual([]);
  });

  it('el grabador no arma alternativos de solo clases', () => {
    const el = {
      tagName: 'BUTTON',
      id: '',
      classList: ['btn', 'btn-primary'],
      getAttribute: (a: string) => (a === 'aria-label' ? 'Save' : null),
    } as unknown as Element;
    const alts = selectorAlternatives(el, '#x', () => true, 'body > div > button:nth-of-type(2)');
    expect(alts).toContain('button[aria-label="Save"]');
    expect(alts.some((a) => /^button\.btn/.test(a))).toBe(false);
  });
});

describe('robots: el login va solo al sitio configurado', () => {
  it('después de una redirección a otro origen, el fill con contraseña falla sin escribirla', async () => {
    const { page, actions } = fakePage(
      { '#password': { t: 'input', type: 'password', nm: 'Password', pw: true } },
      { redirect: { 'https://app.test/login': 'https://evil.test/login' } },
    );
    const res = await robotInterpreter(
      page,
      steps([
        { type: 'goto', url: 'https://app.test/login' },
        { type: 'fill', selector: '#password', value: '{{credentials.LOGIN.password}}' },
      ]),
      {},
      { ...opts, credentials: creds },
    );
    expect(res.status).toBe('failed');
    expect(res.error).toBe('2: credential_origin');
    expect(actions.some((a) => a.startsWith('fill:'))).toBe(false);
    expect(res.logs.at(-1)?.detail).toContain('https://evil.test');
    expect(JSON.stringify(res)).not.toContain('pw-secret-1');
  });

  it('en el mismo origen escribe; el sitio del paso manda sobre el del goto', async () => {
    const els = { '#password': { t: 'input', type: 'password', nm: 'Password', pw: true } };
    const ok = fakePage(els);
    const a = await robotInterpreter(
      ok.page,
      steps([
        { type: 'goto', url: 'https://app.test/login' },
        { type: 'fill', selector: '#password', value: '{{credentials.LOGIN.password}}' },
      ]),
      {},
      { ...opts, credentials: creds },
    );
    expect(a.status).toBe('success');
    expect(ok.actions).toContain('fill:#password=pw-secret-1');
    // SSO en otro sitio: el paso grabado dice dónde va.
    const sso = fakePage(els, { redirect: { 'https://app.test/': 'https://login.idp.test/authorize' } });
    const b = await robotInterpreter(
      sso.page,
      steps([
        { type: 'goto', url: 'https://app.test/' },
        { type: 'fill', selector: '#password', value: '{{credentials.LOGIN.password}}', origin: 'https://login.idp.test' },
      ]),
      {},
      { ...opts, credentials: creds },
    );
    expect(b.status).toBe('success');
  });

  it('sin un goto con dirección fija ni sitio en el paso, no escribe el login', async () => {
    const { page, actions } = fakePage({ '#password': { t: 'input', type: 'password', nm: 'Password', pw: true } });
    const res = await robotInterpreter(
      page,
      steps([
        { type: 'goto', url: '{{inputs.site}}' },
        { type: 'fill', selector: '#password', value: '{{credentials.LOGIN.password}}' },
      ]),
      { site: 'https://app.test/' },
      { ...opts, credentials: creds },
    );
    expect(res.error).toBe('2: credential_origin');
    expect(actions.some((x) => x.startsWith('fill:'))).toBe(false);
  });

  it('el esquema acepta el sitio del login y lo valida', () => {
    expect(validateSteps([{ type: 'fill', selector: '#p', value: 'x', origin: 'https://a.test' }]).ok).toBe(true);
    expect(validateSteps([{ type: 'fill', selector: '#p', value: 'x', origin: '' }]).ok).toBe(true);
    expect(validateSteps([{ type: 'fill', selector: '#p', value: 'x', origin: 'https://a.test/path' }]).ok).toBe(false);
    expect(validateSteps([{ type: 'fill', selector: '#p', value: 'x', origin: 'javascript:alert(1)' }]).ok).toBe(false);
  });
});

describe('robots: grabador y página hostil', () => {
  it('con la extensión no lee ni escribe el sessionStorage de la página', () => {
    const js = buildRecorderScript({} as never, null);
    expect(js).toContain('if (CFG) state = CFG.state');
    expect(js).toMatch(/else \{ try \{ state = JSON\.parse\(sessionStorage\.getItem/);
    expect(js).toContain('if (!CFG) { try { sessionStorage.setItem');
  });

  it('la extensión arranca vacía aunque la página haya sembrado pasos', () => {
    const js = buildRecorderScript({} as never, null);
    const seeded = JSON.stringify({ steps: [{ type: 'evaluate', name: 'x', script: 'steal()' }], last: '' });
    const store: Record<string, string> = { 'zerosoft-robot-recorder': seeded };
    const sent: unknown[] = [];
    const fakeEl = () => {
      const el: Record<string, unknown> = {
        style: {},
        setAttribute: () => {},
        appendChild: () => {},
        addEventListener: () => {},
        querySelector: () => fakeEl(),
        attachShadow: () => fakeEl(),
        textContent: '',
        innerHTML: '',
      };
      return el;
    };
    const win: Record<string, unknown> = {
      __zsRecCfg: { url: 'https://zs.test/api/robots/recordings/r/steps', token: 't', state: null },
    };
    const run = new Function(
      'window',
      'document',
      'sessionStorage',
      'location',
      'fetch',
      'chrome',
      'navigator',
      'getComputedStyle',
      'WeakSet',
      `with (window) { ${js} }`,
    );
    run(
      win,
      { createElement: fakeEl, createTextNode: () => ({}), documentElement: fakeEl(), addEventListener: () => {} },
      { getItem: (k: string) => store[k] ?? null, setItem: (k: string, v: string) => (store[k] = v) },
      { href: 'https://shop.test/', origin: 'https://shop.test', pathname: '/', protocol: 'https:' },
      (_u: string, init: { body: string }) => {
        sent.push(JSON.parse(init.body));
        return Promise.resolve({ ok: true });
      },
      { runtime: { id: 'x', sendMessage: (m: { zsState?: { steps: unknown[] } }) => sent.push(m) } },
      {},
      () => ({ getPropertyValue: () => '' }),
      WeakSet,
    );
    const state = (sent.find((m) => (m as { zsState?: unknown }).zsState) as { zsState: { steps: Array<{ type: string }> } }).zsState;
    expect(state.steps.map((s) => s.type)).toEqual(['goto']);
    expect(store['zerosoft-robot-recorder']).toBe(seeded);
  });

  it('el endpoint de la grabación rechaza tipos de paso que el grabador no produce', async () => {
    const u = await makeUser();
    const r = await createRobot(u.id, u.id, { name: 'R', steps: [{ type: 'goto', url: 'https://a.test' }] });
    if (!r.ok) throw new Error(r.error);
    const rec = await createRobotRecording(u.id, r.robot.id, u.id);
    if (!rec) throw new Error('no rec');
    expect(await pushRobotRecording(rec.id, rec.token, [{ type: 'goto', url: 'https://a.test' }, { type: 'evaluate', name: 'x', script: 'return 1' }])).toEqual({
      ok: false,
      error: 'invalid_steps',
    });
    expect(await pushRobotRecording(rec.id, rec.token, [{ type: 'upload', selector: '#f', url: 'https://a.test/f' }])).toMatchObject({ ok: false });
    expect(await pushRobotRecording(rec.id, rec.token, [{ type: 'goto', url: 'https://a.test' }, { type: 'click', selector: '#b', text: '' }])).toEqual({ ok: true, count: 2 });
    expect(onlyRecorderSteps([{ type: 'loop_over' }])).toBe(false);
  });
});

const instant: RobotBackend = { name: 'local', run: async () => ({ status: 'success', error: null, vars: {}, logs: [], screenshots: [], pages: 1 }) };

async function team(owner: string, member: string, role = 'member') {
  const id = crypto.randomUUID();
  await getDb().prepare('INSERT INTO teams (id, name, slug, owner_id) VALUES (?, ?, ?, ?)').run(id, 'T', `t-${id}`, owner);
  await getDb().prepare('INSERT INTO team_members (team_id, user_id, role) VALUES (?, ?, ?)').run(id, member, role);
  return id;
}

describe('robots: robot con login de alguien que pasó a member', () => {
  it('el admin que lo corre o lo guarda se hace cargo; un member no', async () => {
    const owner = await makeUser();
    const admin = await makeUser();
    const m = await makeUser();
    const t = await team(owner.id, m.id);
    await getDb().prepare("INSERT INTO team_members (team_id, user_id, role) VALUES (?, ?, 'admin')").run(t, admin.id);
    await createCredential(owner.id, owner.id, { name: 'LOGIN', type: 'basic', data: { username: 'ada', password: 'pw-secret-1' } });
    const res = await createRobot(owner.id, m.id, { name: 'x', steps: [{ type: 'goto', url: 'https://a.test' }] });
    if (!res.ok) throw new Error(res.error);
    await getDb()
      .prepare('UPDATE robots SET steps = ? WHERE id = ?')
      .run(JSON.stringify([{ type: 'fill', selector: '#p', value: '{{credentials.LOGIN.password}}' }]), res.robot.id);
    const row = (await getRobotRow(owner.id, res.robot.id))!;
    expect((await adoptLoginRobot(row, m.id)).created_by).toBe(m.id);
    setRobotBackendForTests(instant);
    const run = await startRobotRun(owner.id, res.robot.id, undefined, { trigger: 'manual', actorId: admin.id });
    expect(run.ok).toBe(true);
    expect((await getRobotRow(owner.id, res.robot.id))?.created_by).toBe(admin.id);
  });
});

describe('robots: credencial mal usada', () => {
  it('falla antes de abrir el navegador', async () => {
    const u = await makeUser();
    const res = await createRobot(u.id, u.id, { name: 'x', steps: [{ type: 'goto', url: 'https://a.test' }] });
    if (!res.ok) throw new Error(res.error);
    await getDb()
      .prepare('UPDATE robots SET steps = ? WHERE id = ?')
      .run(JSON.stringify([{ type: 'goto', url: 'https://a.test' }, { type: 'goto', url: 'https://a.test/?p={{credentials.L.password}}' }]), res.robot.id);
    const run = vi.fn(instant.run);
    setRobotBackendForTests({ name: 'local', run });
    expect(await startRobotRun(u.id, res.robot.id, undefined, { trigger: 'manual', actorId: u.id })).toEqual({ ok: false, error: 'credential_misuse', index: 1 });
    expect(await enqueueRobotBatch(u.id, res.robot.id, [{}])).toMatchObject({ ok: false, error: 'credential_misuse', index: 1 });
    expect(run).not.toHaveBeenCalled();
  });

  it('las corridas programadas que fallan igual pausan el schedule después de 3, con un solo aviso', async () => {
    const u = await makeUser();
    const res = await createRobot(u.id, u.id, { name: 'x', steps: [{ type: 'goto', url: 'https://a.test' }] });
    if (!res.ok) throw new Error(res.error);
    const id = res.robot.id;
    await getDb()
      .prepare("UPDATE robots SET steps = ?, schedule = ?, enabled = 1, pause_after = 0 WHERE id = ?")
      .run(
        JSON.stringify([{ type: 'goto', url: 'https://a.test/{{credentials.L.password}}' }]),
        JSON.stringify({ mode: 'interval', every: 1, unit: 'hours', time: '09:00', timezone: 'UTC' }),
        id,
      );
    const run = vi.fn(instant.run);
    setRobotBackendForTests({ name: 'local', run });
    for (let i = 0; i < 5; i++) {
      await getDb().prepare('UPDATE robots SET next_run_at = ? WHERE id = ? AND enabled = 1').run(new Date(Date.now() - 1000).toISOString(), id);
      await runDueRobots(new Date(), 100, 240_000);
    }
    const runs = (await getDb().prepare("SELECT error FROM robot_runs WHERE robot_id = ? AND trigger = 'schedule'").all(id)) as Array<{ error: string }>;
    expect(runs).toHaveLength(3);
    expect(runs.every((r) => r.error === '1: credential_not_allowed')).toBe(true);
    const row = (await getRobotRow(u.id, id))!;
    expect(row.enabled).toBe(0);
    expect(row.paused_at).toBeTruthy();
    const notes = (await getDb().prepare("SELECT COUNT(*) AS n FROM notifications WHERE source_id = ?").get(`credential:${id}`)) as { n: number };
    expect(Number(notes.n)).toBe(1);
  });
});

describe('robots: lotes que vencen', () => {
  it('las filas vencidas de un lote mandan un aviso con la espera configurada', async () => {
    vi.stubEnv('ROBOTS_BATCH_QUEUE_MAX_AGE_H', '72');
    expect(batchExpiry()).toEqual({ unit: 'days', count: 3 });
    const u = await makeUser();
    const r = await createRobot(u.id, u.id, { name: 'Lote', steps: [{ type: 'goto', url: 'https://a.test' }] });
    if (!r.ok) throw new Error(r.error);
    const batch = crypto.randomUUID();
    const old = new Date(Date.now() - 4 * 86_400_000).toISOString();
    for (let i = 0; i < 3; i++) {
      await getDb()
        .prepare("INSERT INTO robot_runs (id, robot_id, user_id, status, trigger, created_by, batch_id, created_at) VALUES (?, ?, ?, 'queued', 'api', ?, ?, ?)")
        .run(crypto.randomUUID(), r.robot.id, u.id, u.id, batch, old);
    }
    await expireQueuedRobotRuns(u.id);
    await expireQueuedRobotRuns(u.id);
    const notes = (await getDb().prepare('SELECT title, body FROM notifications WHERE user_id = ? AND source_id = ?').all(u.id, `batch-expired:${batch}`)) as Array<{ title: string; body: string }>;
    expect(notes).toHaveLength(1);
    expect(notes[0].body).toContain('3 rows');
    expect(notes[0].body).toContain('3 days');
    expect((await getUsage(u.id)).batchExpiry).toEqual({ unit: 'days', count: 3 });
  });

  it('expiry en horas cuando no son días enteros', () => {
    vi.stubEnv('ROBOTS_BATCH_QUEUE_MAX_AGE_H', '36');
    expect(batchExpiry()).toEqual({ unit: 'hours', count: 36 });
  });

  it('cuántas filas cubre la cuota', () => {
    expect(batchRowsCovered(10, 30, 100)).toBe(20);
    expect(batchRowsCovered(1000, 30, 100)).toBe(100);
    expect(batchRowsCovered(0, 30, 100)).toBe(0);
  });
});
