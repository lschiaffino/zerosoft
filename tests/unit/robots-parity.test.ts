import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { getDb } from '@/lib/db';
import { createCredential } from '@/lib/flow-credentials';
import {
  canSeeRobotData,
  createRobot,
  exportRobot,
  getRobot,
  listRobotRuns,
  startRobotRun,
  updateRobot,
  usageByRobot,
} from '@/lib/robots';
import { renderChangeEmail } from '@/lib/robots-alerts';
import { normalizeNlSteps, robotFromDetection } from '@/lib/robots-ai';
import { parseCsv } from '@/lib/robots-csv';
import { listDataset, mergeDataset, rowKey } from '@/lib/robots-dataset';
import { normalizeSnapshot } from '@/lib/robots-detect';
import { stepPath } from '@/lib/robots-editor';
import { geoOptions, proxyFor } from '@/lib/robots-geo';
import { robotHarness, robotInterpreter, type HarnessChromium, type InterpreterStep, type RobotLocator, type RobotPage } from '@/lib/robots-interpreter';
import { setRobotBackendForTests, type RobotBackend, type RobotJob } from '@/lib/robots-runner';
import { datasetVariable, listVariables, robotSettingsSchema, ROBOT_TEMPLATES, validateSteps } from '@/lib/robots-schema';
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

/** Página falsa: `counts[selector]` dice cuántos elementos hay (puede cambiar con los clics). */
function countPage(initial: Record<string, number>, onClick?: (sel: string, counts: Record<string, number>) => void) {
  const counts: Record<string, number> = { ...initial };
  const actions: string[] = [];
  const loc = (sel: string): RobotLocator => {
    const l: RobotLocator = {
      first: () => l,
      count: async () => counts[sel] ?? 0,
      click: async () => {
        if (!(counts[sel] ?? 0)) throw new Error('Timeout 15000ms exceeded');
        actions.push(`click:${sel}`);
        onClick?.(sel, counts);
      },
      fill: async (v) => {
        if (!(counts[sel] ?? 0)) throw new Error('Timeout 15000ms exceeded');
        actions.push(`fill:${sel}=${v}`);
      },
      selectOption: async () => [],
      press: async () => {},
      innerText: async () => `text of ${sel}\nsecond line`,
      getAttribute: async () => null,
      allInnerTexts: async () => [],
      evaluateAll: async <R,>() => Array.from({ length: counts[sel] ?? 0 }, (_, i) => ({ n: String(i + 1) })) as unknown as R,
      evaluate: async <R,>() => [['Home', 'https://x.test/']] as unknown as R,
      waitFor: async () => {},
      scrollIntoViewIfNeeded: async () => {},
    };
    return l;
  };
  const page: RobotPage = {
    goto: async (url) => void actions.push(`goto:${url}`),
    url: () => 'https://x.test/list',
    locator: loc,
    getByText: (text) => loc(`text=${text}`),
    keyboard: { press: async () => {} },
    waitForTimeout: async () => {},
    screenshot: async () => new Uint8Array([1]),
    evaluate: async <R,>() => {
      actions.push('scroll-bottom');
      onClick?.('__scroll', counts);
      return true as unknown as R;
    },
  };
  return { page, actions, counts };
}

const opts = { deadline: Date.now() + 60_000, checkUrl: async () => null };

describe('robots: autorreparación con selectores alternativos', () => {
  it('usa el alternativo cuando el principal no está y lo deja en el log', async () => {
    const { page, actions } = countPage({ '#new-btn': 1 });
    const res = await robotInterpreter(page, steps([{ type: 'click', selector: '#old-btn', fallbacks: ['#missing', '#new-btn'] }]), {}, opts);
    expect(res.status).toBe('success');
    expect(actions).toContain('click:#new-btn');
    expect(res.healed).toEqual([{ step: '1', from: '#old-btn', to: '#new-btn' }]);
    expect(res.logs[0].detail).toContain('healed: #new-btn');
  });

  it('con el principal en la página no toca los alternativos', async () => {
    const { page, actions } = countPage({ '#ok': 1, '#alt': 1 });
    const res = await robotInterpreter(page, steps([{ type: 'fill', selector: '#ok', value: 'x', fallbacks: ['#alt'] }]), {}, opts);
    expect(actions).toEqual(['fill:#ok=x']);
    expect(res.healed).toBeUndefined();
  });

  it('el esquema acota a 4 alternativos', () => {
    expect(validateSteps([{ type: 'click', selector: 'a', fallbacks: ['1', '2', '3', '4', '5'] }]).ok).toBe(false);
  });
});

describe('robots: paginación con Cargar más y scroll infinito', () => {
  it('load_more hace clic hasta que no aparecen filas nuevas y lee todo junto', async () => {
    const { page, actions } = countPage({ '.card': 10, 'button.more': 1 }, (sel, c) => {
      if (sel === 'button.more') {
        c['.card'] += 10;
        if (c['.card'] >= 30) c['button.more'] = 0;
      }
    });
    const res = await robotInterpreter(
      page,
      steps([{ type: 'extract_list', selector: '.card', name: 'items', fields: [{ name: 'n' }], paginateMode: 'load_more', nextSelector: 'button.more', maxPages: 10 }]),
      {},
      opts,
    );
    expect(res.status).toBe('success');
    expect((res.vars.items as unknown[]).length).toBe(30);
    expect(actions.filter((a) => a === 'click:button.more')).toHaveLength(2);
    expect(res.logs[0].detail).toContain('3 pages');
  });

  it('scroll baja hasta el final mientras cargan filas, con tope', async () => {
    const { page, actions } = countPage({ '.q': 10 }, (sel, c) => {
      if (sel === '__scroll') c['.q'] += 10;
    });
    const res = await robotInterpreter(
      page,
      steps([{ type: 'extract_list', selector: '.q', name: 'quotes', fields: [{ name: 'n' }], paginateMode: 'scroll', maxPages: 4 }]),
      {},
      opts,
    );
    expect(actions.filter((a) => a === 'scroll-bottom')).toHaveLength(3);
    expect((res.vars.quotes as unknown[]).length).toBe(40);
  });
});

describe('robots: paso ai_extract', () => {
  it('captura texto y links de la página para que la IA arme filas al terminar', async () => {
    const { page } = countPage({ body: 1 });
    const res = await robotInterpreter(
      page,
      steps([{ type: 'ai_extract', instruction: 'products', name: 'items', fields: [{ name: 'title' }, { name: 'price', description: 'in USD' }] }]),
      {},
      opts,
    );
    expect(res.vars.items).toMatchObject({ __aiExtract: 1, instruction: 'products', url: 'https://x.test/list', text: expect.stringContaining('text of body') });
    expect((res.vars.items as { fields: unknown[] }).fields).toEqual([
      { name: 'title', description: '' },
      { name: 'price', description: 'in USD' },
    ]);
  });
});

describe('robots: arnés con país, proxy y sin descargas', () => {
  function fakeChromium(seen: { launch?: Record<string, unknown>; context?: Record<string, unknown> }): HarnessChromium {
    return {
      launch: async (o) => {
        seen.launch = o as Record<string, unknown>;
        return {
          newContext: async (c) => {
            seen.context = c;
            return {
              route: async () => {},
              on: () => {},
              newPage: async () => countPage({}).page,
              storageState: async () => ({}),
            };
          },
          close: async () => {},
        };
      },
    };
  }

  it('pasa el proxy al lanzar y el idioma y la zona horaria al contexto', async () => {
    const seen: { launch?: Record<string, unknown>; context?: Record<string, unknown> } = {};
    await robotHarness(
      fakeChromium(seen),
      {
        steps: [{ type: 'goto', url: 'https://x.test' }],
        inputs: {},
        robotName: 'r',
        deadline: Date.now() + 10_000,
        maxPages: 5,
        maxScreenshots: 1,
        maxExecuted: 10,
        maxLoopItems: 5,
        proxy: { server: 'http://proxy.test:7000', username: 'u-cc-ar', password: 'p' },
        locale: 'es-AR',
        timezoneId: 'America/Argentina/Buenos_Aires',
      },
      robotInterpreter,
      async () => null,
    );
    expect(seen.launch?.proxy).toEqual({ server: 'http://proxy.test:7000', username: 'u-cc-ar', password: 'p' });
    expect(seen.launch?.args).toEqual(expect.arrayContaining(['--js-flags=--max-old-space-size=512']));
    expect(seen.context).toMatchObject({ locale: 'es-AR', timezoneId: 'America/Argentina/Buenos_Aires', acceptDownloads: false });
    expect((seen.context?.extraHTTPHeaders as Record<string, string>)['accept-language']).toMatch(/^es-AR/);
  });

  it('acepta descargas solo si el robot tiene un paso download', async () => {
    const seen: { context?: Record<string, unknown> } = {};
    await robotHarness(
      fakeChromium(seen),
      { steps: [{ type: 'download', selector: 'a', text: '', name: 'f' }], inputs: {}, robotName: 'r', deadline: Date.now() + 5000, maxPages: 5, maxScreenshots: 1, maxExecuted: 10, maxLoopItems: 5 },
      robotInterpreter,
      async () => null,
    );
    expect(seen.context?.acceptDownloads).toBe(true);
  });

  it('proxyFor arma server y usuario con el país y una sesión por corrida', () => {
    vi.stubEnv('ROBOTS_PROXY_URL', 'http://cust-cc-{country}-sess-{session}:s%40cret@gw.proxy.test:7777');
    expect(proxyFor('br', 'abc')).toEqual({ server: 'http://gw.proxy.test:7777', username: 'cust-cc-br-sess-abc', password: 's@cret' });
    expect(geoOptions('ar')).toMatchObject({ locale: 'es-AR', timezoneId: 'America/Argentina/Buenos_Aires', proxy: { server: 'http://gw.proxy.test:7777' } });
    vi.stubEnv('ROBOTS_PROXY_URL', '');
    expect(geoOptions('ar').proxy).toBeUndefined();
    expect(geoOptions('zz')).toEqual({});
  });
});

describe('robots: ajustes, plantillas y exportar / importar', () => {
  it('el esquema de ajustes valida envíos y deduce la variable de la tabla', () => {
    const s = steps([
      { type: 'goto', url: 'https://x.test' },
      { type: 'extract_list', selector: '.c', name: 'items', fields: [{ name: 'a' }] },
      { type: 'extract_table', selector: 'table', name: 'rows' },
    ]) as never;
    expect(listVariables(s)).toEqual(['items', 'rows']);
    expect(datasetVariable(s, {})).toBe('items');
    expect(datasetVariable(s, { dataset: { enabled: true, variable: 'rows', keyFields: [] } })).toBe('rows');
    expect(datasetVariable(s, { dataset: { enabled: false, variable: '', keyFields: [] } })).toBeNull();
    expect(robotSettingsSchema.safeParse({ destinations: [{ id: 'a', kind: 'sheets', credential: 'g', spreadsheetId: 'short', sheet: 'S' }] }).success).toBe(false);
    expect(robotSettingsSchema.safeParse({ destinations: [{ id: 'a', kind: 'airtable', credential: 'tok', baseId: 'appABCDEFGH12', table: 'Leads' }] }).success).toBe(true);
    expect(robotSettingsSchema.safeParse({ country: 'AR' }).success).toBe(false);
  });

  it('todas las plantillas son robots válidos', () => {
    expect(ROBOT_TEMPLATES.length).toBeGreaterThanOrEqual(15);
    for (const tpl of ROBOT_TEMPLATES) {
      expect(validateSteps(tpl.steps).ok, tpl.key).toBe(true);
      expect(robotSettingsSchema.safeParse(tpl.settings ?? {}).success, tpl.key).toBe(true);
    }
  });

  it('exportar e importar un robot conserva pasos y ajustes, con los envíos apagados', async () => {
    const ws = (await makeUser('rexp')).id;
    const a = await createRobot(ws, ws, { name: 'Jobs', template: 'remoteJobs' });
    if (!a.ok) throw new Error(a.error);
    await updateRobot(ws, a.robot.id, {
      settings: { ...a.robot.settings, destinations: [{ id: 'd1', kind: 'crm', enabled: true, variable: '', object: 'companies', mapping: { name: 'company' } }] },
    });
    const file = exportRobot((await getRobot(ws, a.robot.id))!);
    expect(JSON.stringify(file)).not.toContain(ws);
    const other = (await makeUser('rimp')).id;
    const b = await createRobot(other, other, { name: '', import: JSON.parse(JSON.stringify(file)) });
    if (!b.ok) throw new Error(b.error);
    expect(b.robot.name).toBe('Jobs');
    expect(b.robot.steps).toEqual(a.robot.steps);
    expect(b.robot.settings.destinations?.[0]).toMatchObject({ kind: 'crm', enabled: false });
    expect(await createRobot(other, other, { name: 'x', import: { hello: 1 } })).toEqual({ ok: false, error: 'invalid_import' });
  });

  it('el constructor crea un robot con los pasos que le pasan', async () => {
    const ws = (await makeUser('rai')).id;
    const r = await createRobot(ws, ws, { name: 'AI', steps: [{ type: 'goto', url: 'https://x.test' }] });
    expect(r.ok && r.robot.steps).toEqual([{ type: 'goto', url: 'https://x.test' }]);
    expect(await createRobot(ws, ws, { name: 'AI', steps: [{ type: 'teleport' }] })).toMatchObject({ ok: false, error: 'invalid_steps' });
  });
});

describe('robots: tabla acumulada', () => {
  it('suma nuevas, marca cambiadas y las que ya no están (solo con las mismas entradas)', async () => {
    const ws = (await makeUser('rds')).id;
    const r = await createRobot(ws, ws, { name: 'DS' });
    if (!r.ok) throw new Error(r.error);
    const db = getDb();
    const run = async (input: string) => {
      const id = crypto.randomUUID();
      await db
        .prepare("INSERT INTO robot_runs (id, robot_id, user_id, status, trigger, input, created_at) VALUES (?, ?, ?, 'success', 'manual', ?, ?)")
        .run(id, r.robot.id, ws, input, new Date().toISOString());
      return id;
    };
    const base = { workspaceId: ws, robotId: r.robot.id, variable: 'items', keyFields: ['link'], capturedBy: null };
    const r1 = await run('{"q":"a"}');
    const m1 = await mergeDataset({ ...base, runId: r1, input: '{"q":"a"}', rows: [{ link: '1', p: '10' }, { link: '2', p: '20' }] });
    expect(m1).toMatchObject({ added: 2, changed: 0, removed: 0, total: 2 });
    const r2 = await run('{"q":"a"}');
    const m2 = await mergeDataset({ ...base, runId: r2, input: '{"q":"a"}', rows: [{ link: '1', p: '11' }, { link: '3', p: '30' }] });
    expect(m2).toMatchObject({ added: 1, changed: 1, removed: 1, total: 2 });
    expect(m2.fresh.map((x) => x.link)).toEqual(['1', '3']);
    // Otra entrada (un lote): no marca como quitadas las filas de la otra.
    const r3 = await run('{"q":"b"}');
    const m3 = await mergeDataset({ ...base, runId: r3, input: '{"q":"b"}', rows: [{ link: '9', p: '90' }] });
    expect(m3).toMatchObject({ added: 1, removed: 0, total: 3 });
    const list = await listDataset(ws, r.robot.id, { filter: 'all' });
    expect(list.total).toBe(4);
    expect(list.counts).toEqual({ active: 3, removed: 1 });
    const search = await listDataset(ws, r.robot.id, { filter: 'all', q: '90' });
    expect(search.rows.map((x) => x.data.link)).toEqual(['9']);
    expect(rowKey({ link: '' , p: 1 }, ['link'])).toBe(rowKey({ p: 1, link: '' }, ['link']));
  });

  it('las filas capturadas con un login solo las ven quien armó el robot y los admins', async () => {
    const ws = (await makeUser('rcap')).id;
    const r = await createRobot(ws, ws, { name: 'Cap' });
    if (!r.ok) throw new Error(r.error);
    await mergeDataset({ workspaceId: ws, robotId: r.robot.id, runId: 'x', variable: 'i', keyFields: [], capturedBy: 'builder', rows: [{ secret: 'invoice 1' }] });
    await mergeDataset({ workspaceId: ws, robotId: r.robot.id, runId: 'y', variable: 'i', keyFields: [], capturedBy: null, rows: [{ public: 'news' }] });
    const member = await listDataset(ws, r.robot.id, { viewer: { personId: 'member', admin: false }, filter: 'all' });
    expect(member.rows.map((x) => Object.keys(x.data)[0])).toEqual(['public']);
    expect(member.hidden).toBe(1);
    expect((await listDataset(ws, r.robot.id, { viewer: { personId: 'builder', admin: false }, filter: 'all' })).total).toBe(2);
    expect((await listDataset(ws, r.robot.id, { viewer: { personId: 'admin', admin: true }, filter: 'all' })).total).toBe(2);
    expect(canSeeRobotData({ personId: 'member', admin: false }, { captured_by: 'builder' })).toBe(false);
    expect(canSeeRobotData({ personId: 'member', admin: false }, { captured_by: null })).toBe(true);
  });
});

describe('robots: corrida completa con tabla, columna con IA, CRM y datos con login', () => {
  function backend(rows: Array<Record<string, string>>, seen: RobotJob[] = []): RobotBackend {
    return {
      name: 'local',
      run: async (job) => {
        seen.push(job);
        return { status: 'success', error: null, vars: { leads: rows }, logs: [], screenshots: [], pages: 1, healed: [{ step: '2', from: '#a', to: '#b' }] };
      },
    };
  }

  it('junta filas, calcula la columna con IA (fake, con caché), manda al CRM y guarda captured_by', async () => {
    vi.stubEnv('ROBOTS_AI_FAKE', '1');
    const ws = (await makeUser('rfull')).id;
    await createCredential(ws, ws, { name: 'LOGIN', type: 'basic', data: { username: 'ada', password: 'pw-secret-1' } });
    const r = await createRobot(ws, ws, {
      name: 'Leads',
      steps: [
        { type: 'goto', url: 'https://x.test' },
        { type: 'fill', selector: '#p', value: '{{credentials.LOGIN.password}}' },
        { type: 'extract_list', selector: '.lead', name: 'leads', fields: [{ name: 'email' }, { name: 'name' }] },
      ],
    });
    if (!r.ok) throw new Error(r.error);
    const up = await updateRobot(ws, r.robot.id, {
      settings: {
        country: 'br',
        dataset: { enabled: true, variable: 'leads', keyFields: ['email'] },
        aiColumns: [{ variable: 'leads', name: 'size', prompt: 'short or long name' }],
        destinations: [{ id: 'c1', kind: 'crm', enabled: true, variable: '', object: 'contacts', mapping: { email: 'email', firstName: 'name' } }],
      },
    });
    expect(up.ok).toBe(true);
    const seen: RobotJob[] = [];
    setRobotBackendForTests(backend([{ email: 'ana@acme.test', name: 'Ana' }, { email: 'not-an-email', name: 'Bo' }], seen));
    const res = await startRobotRun(ws, r.robot.id, {}, { trigger: 'manual', actorId: ws });
    if (!res.ok) throw new Error(res.error);
    expect(seen[0]).toMatchObject({ locale: 'pt-BR', timezoneId: 'America/Sao_Paulo' });
    const run = res.run;
    expect(run.status).toBe('success');
    expect(run.capturedBy).toBe(ws);
    expect((run.output.leads as Array<Record<string, string>>)[0]).toMatchObject({ email: 'ana@acme.test', size: 'short' });
    expect(run.exports.dataset).toMatchObject({ added: 2, total: 2 });
    expect(run.exports.destinations?.[0]).toMatchObject({ kind: 'crm', ok: true, created: 1, skipped: 1 });
    expect(run.exports.healed).toEqual([{ step: '2', from: '#a', to: '#b' }]);
    const contact = await getDb().prepare("SELECT first_name FROM crm_contacts WHERE user_id = ? AND email = 'ana@acme.test'").get(ws);
    expect(contact).toMatchObject({ first_name: 'Ana' });
    const cache = (await getDb().prepare('SELECT COUNT(*) AS n FROM robot_ai_cache WHERE robot_id = ?').get(r.robot.id)) as { n: number };
    expect(Number(cache.n)).toBe(2);

    // Segunda corrida: la fila existente se actualiza en el CRM (sin duplicar) y la IA reusa la caché.
    const again = await startRobotRun(ws, r.robot.id, {}, { trigger: 'manual', actorId: ws });
    if (!again.ok) throw new Error(again.error);
    expect(again.run.exports.dataset).toMatchObject({ added: 0, changed: 0, total: 2 });
    expect(again.run.exports.destinations?.[0]).toMatchObject({ ok: true, count: 0 });

    // Un miembro sin ser quien armó el robot no ve los datos capturados con el login.
    const hidden = await listRobotRuns(ws, r.robot.id, 10, { personId: 'someone', admin: false });
    expect(hidden[0]).toMatchObject({ dataHidden: true, output: {} });
    const admin = await listRobotRuns(ws, r.robot.id, 10, { personId: 'admin', admin: true });
    expect(admin[0].dataHidden).toBeUndefined();

    const usage = await usageByRobot(ws);
    expect(usage[0]).toMatchObject({ robotId: r.robot.id, runs: 2 });
  });

  it('sin IA la columna queda vacía y la corrida termina con advertencia', async () => {
    vi.stubEnv('ROBOTS_AI_FAKE', '');
    vi.stubEnv('AI_GATEWAY_API_KEY', '');
    vi.stubEnv('VERCEL_OIDC_TOKEN', '');
    const ws = (await makeUser('rnoai')).id;
    const r = await createRobot(ws, ws, {
      name: 'NoAI',
      steps: [
        { type: 'goto', url: 'https://x.test' },
        { type: 'extract_list', selector: '.lead', name: 'leads', fields: [{ name: 'email' }] },
      ],
    });
    if (!r.ok) throw new Error(r.error);
    await updateRobot(ws, r.robot.id, { settings: { aiColumns: [{ variable: 'leads', name: 'size', prompt: 'x' }] } });
    setRobotBackendForTests(backend([{ email: 'a@b.test', name: 'A' }]));
    const res = await startRobotRun(ws, r.robot.id, {}, { trigger: 'manual' });
    if (!res.ok) throw new Error(res.error);
    expect(res.run.status).toBe('success');
    expect(res.run.warnings).toBeGreaterThan(0);
    expect(res.run.exports.ai?.errors[0]).toEqual({ variable: 'leads', error: 'ai_disabled' });
    expect(res.run.capturedBy).toBeNull();
  });
});

describe('robots: IA y helpers', () => {
  it('normaliza pasos de la IA y descarta los inválidos', () => {
    const empty = { url: '', selector: '', text: '', value: '', key: '', name: '', ms: 0, mode: '', attribute: '', fields: [] };
    const out = normalizeNlSteps([
      { ...empty, type: 'goto', url: 'https://x.test' },
      { ...empty, type: 'goto', url: 'javascript:alert(1)' },
      { ...empty, type: 'evaluate', selector: 'x' },
      { ...empty, type: 'click', text: 'Sign in' },
      { ...empty, type: 'extract', selector: 'h1', name: 'Título del 1', mode: 'weird' },
    ]);
    expect(out).toEqual([
      { type: 'goto', url: 'https://x.test' },
      { type: 'click', selector: '', text: 'Sign in' },
      { type: 'extract', selector: 'h1', name: 'Titulo_del_1', mode: 'text', attribute: '' },
    ]);
  });

  it('arma un robot desde la lista detectada (con paginación)', () => {
    const snap = normalizeSnapshot({
      url: 'https://books.test/',
      title: 'Books',
      html: '<ul></ul>',
      lists: [{ selector: 'article.pod', count: 20, fields: [{ name: 'title', selector: 'h3 a', attribute: 'title' }, { name: 'bad name!', selector: 'p', attribute: '' }], sample: [{ title: 'A' }] }],
      next: { selector: 'li.next a', text: 'next', mode: 'next' },
    })!;
    expect(snap.lists[0].fields.map((f) => f.name)).toEqual(['title', 'bad_name_']);
    const built = robotFromDetection('https://books.test/', snap)!;
    expect(built.steps[2]).toMatchObject({ type: 'extract_list', selector: 'article.pod', nextSelector: 'li.next a', paginateMode: 'next', maxPages: 5 });
    expect(built.sample).toEqual([{ title: 'A', bad_name_: '' }]);
  });

  it('parseCsv: comillas, punto y coma, BOM y filas vacías', () => {
    expect(parseCsv('﻿url;name\n"https://a.test/?x=1;2";"Ana ""A"""\n\n https://b.test ;Bo\r\n')).toEqual([
      ['url', 'name'],
      ['https://a.test/?x=1;2', 'Ana "A"'],
      ['https://b.test', 'Bo'],
    ]);
  });

  it('email de cambios: filas nuevas en verde, quitadas en rojo, escapado', () => {
    const mail = renderChangeEmail(
      'es',
      'Precios <b>',
      [
        { key: 'items', kind: 'rows', added: [{ t: 'Nuevo' }], removed: [{ t: 'Viejo' }], addedCount: 1, removedCount: 1, before: 1, after: 1 },
        { key: 'price', kind: 'changed', before: '$10', after: '$12' },
      ],
      'https://zs.test/r',
    );
    expect(mail.subject).toBe('Cambiaron los datos: Precios <b>');
    expect(mail.text).toContain('+ t: Nuevo');
    expect(mail.text).toContain('price: $10 → $12');
    expect(mail.html).toContain('#e7f6ec');
    expect(mail.html).toContain('#fdecec');
    expect(mail.html).not.toContain('Precios <b>');
  });

  it('stepPath traduce la etiqueta del log al paso del robot', () => {
    expect(stepPath('3')).toEqual({ index: 2, child: null });
    expect(stepPath('3.2.1')).toEqual({ index: 2, child: 0 });
    expect(stepPath('3.2')).toBeNull();
    expect(stepPath('x')).toBeNull();
  });
});
