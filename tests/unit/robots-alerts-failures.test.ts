import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { getDb } from '@/lib/db';
import { createRobot, getRobot, listRobotRuns, pruneRobotRuns, runUploadUrls, startRobotRun, updateRobot } from '@/lib/robots';
import { decideOutcome } from '@/lib/robots-alerts';
import { csvCell, csvFilename, toCsv, valueToCsv } from '@/lib/robots-csv';
import { robotInterpreter, type InterpreterStep, type RobotLocator, type RobotPage } from '@/lib/robots-interpreter';
import { setRobotBackendForTests, type RobotBackend } from '@/lib/robots-runner';
import { validateSteps } from '@/lib/robots-schema';
import { robotInputRows } from '@/components/flow/flow-ui';
import { makeUser } from './helpers';

const mail = vi.hoisted(() => ({ sent: [] as Array<{ to: string; subject: string; text: string }> }));
vi.mock('@/lib/email', async (orig) => ({
  ...(await orig<typeof import('@/lib/email')>()),
  sendEmail: async (o: { to: string; subject: string; text: string }) => {
    mail.sent.push(o);
    return { ok: true, provider: 'test' };
  },
}));

const uploads = vi.hoisted(() => ({ saved: [] as string[], deleted: [] as string[] }));
vi.mock('@/lib/uploads', () => ({
  saveUpload: async (folder: string, filename: string) => {
    const url = `/uploads/${folder}/${uploads.saved.length}-${filename}`;
    uploads.saved.push(url);
    return url;
  },
  deleteUploads: async (urls: string[]) => {
    uploads.deleted.push(...urls);
  },
}));

beforeEach(() => {
  vi.stubEnv('RATE_LIMIT_DISABLED', 'true');
  mail.sent = [];
  uploads.saved = [];
  uploads.deleted = [];
});

afterEach(() => {
  vi.unstubAllEnvs();
  setRobotBackendForTests(undefined);
});

// ---------- Página falsa mínima ----------

function page(present: Record<string, string>, opts: { dom?: string } = {}) {
  const evaluated: string[] = [];
  const loc = (sel: string): RobotLocator => {
    const has = () => sel in present;
    const l: RobotLocator = {
      first: () => l,
      count: async () => (has() ? 1 : 0),
      click: async () => {
        if (!has()) throw new Error('Timeout 15000ms exceeded');
      },
      fill: async () => {
        if (!has()) throw new Error('Timeout 15000ms exceeded');
      },
      selectOption: async () => [],
      press: async () => {},
      innerText: async () => {
        if (!has()) throw new Error('Timeout 15000ms exceeded');
        return present[sel];
      },
      getAttribute: async () => null,
      allInnerTexts: async () => [],
      evaluateAll: async <R,>() => [] as unknown as R,
      evaluate: async <R,>() => [] as unknown as R,
      waitFor: async () => {},
      scrollIntoViewIfNeeded: async () => {},
    };
    return l;
  };
  let url = '';
  const p: RobotPage = {
    goto: async (u) => {
      url = u;
      return null;
    },
    url: () => url,
    locator: loc,
    getByText: (t) => loc(`text=${t}`),
    keyboard: { press: async () => {} },
    waitForTimeout: async () => {},
    screenshot: async () => new Uint8Array([9, 9, 9]),
    evaluate: async <R,>(fn: unknown) => {
      if (typeof fn === 'string') {
        evaluated.push(fn);
        return (opts.dom ?? JSON.stringify({ matched: false, title: 'Shop', html: '<body><p>Sold out</p></body>' })) as unknown as R;
      }
      return true as unknown as R;
    },
  };
  return { page: p, evaluated };
}

const opts = () => ({ deadline: Date.now() + 30_000, checkUrl: async () => null });

function steps(list: unknown[]): InterpreterStep[] {
  const v = validateSteps(list);
  if (!v.ok) throw new Error(`invalid: ${v.error} at ${v.index}`);
  return v.steps as unknown as InterpreterStep[];
}

// ---------- Seguir si falla ----------

describe('continue on error', () => {
  it('keeps going after a step with continueOnError and counts a warning', async () => {
    const { page: p } = page({ h1: 'Title' });
    const res = await robotInterpreter(
      p,
      steps([
        { type: 'goto', url: 'https://shop.test/' },
        { type: 'click', selector: '.cookie-banner', continueOnError: true },
        { type: 'extract', selector: 'h1', name: 'title' },
      ]),
      {},
      opts(),
    );
    expect(res.status).toBe('success');
    expect(res.warnings).toBe(1);
    expect(res.vars).toEqual({ title: 'Title' });
    expect(res.logs.map((l) => l.status)).toEqual(['success', 'warning', 'success']);
    expect(res.failure).toBeUndefined();
  });

  it('per loop item: a failing item is a warning and the next item runs', async () => {
    const { page: p, evaluated } = page({ '.ok': 'fine' });
    const list = [
      { type: 'goto', url: 'https://shop.test/' },
      {
        type: 'loop_over',
        list: '{{inputs.items}}',
        continueOnItemError: true,
        steps: [{ type: 'extract', selector: '{{loop.item}}', name: 'last' }],
      },
    ];
    const res = await robotInterpreter(p, steps(list), { items: ['.ok', '.missing', '.ok'] }, opts());
    expect(res.status).toBe('success');
    expect(res.warnings).toBe(1);
    const item = res.logs.find((l) => l.type === 'loop_item');
    expect(item).toMatchObject({ step: '2.2', status: 'warning', error: 'action_timeout', detail: '.missing' });
    expect(res.vars.last).toBe('fine');
    // Elemento tolerado: no se captura la falla.
    expect(evaluated).toHaveLength(0);

    // Sin la opción, el primer elemento que falla corta la corrida.
    const strict = await robotInterpreter(page({ '.ok': 'fine' }).page, steps([list[0], { ...list[1], continueOnItemError: false }]), { items: ['.missing', '.ok'] }, opts());
    expect(strict.status).toBe('failed');
    expect(strict.error).toBe('2.1.1: action_timeout');
  });

  it('a run timeout still stops a step that continues on error', async () => {
    const { page: p } = page({});
    const res = await robotInterpreter(p, steps([{ type: 'click', selector: '.x', continueOnError: true }]), {}, {
      deadline: Date.now() - 1,
      checkUrl: async () => null,
    });
    expect(res.status).toBe('failed');
    expect(res.error).toMatch(/timeout/);
  });
});

// ---------- Captura de la falla ----------

describe('failure capture', () => {
  it('captures screenshot, URL, title and a DOM snippet of the failing step', async () => {
    const { page: p, evaluated } = page({});
    const res = await robotInterpreter(
      p,
      steps([
        { type: 'goto', url: 'https://shop.test/p/1' },
        { type: 'click', selector: 'button.buy' },
      ]),
      {},
      opts(),
    );
    expect(res.status).toBe('failed');
    expect(res.failure).toMatchObject({
      step: '2',
      type: 'click',
      error: 'action_timeout',
      url: 'https://shop.test/p/1',
      title: 'Shop',
      matched: false,
      dom: '<body><p>Sold out</p></body>',
      screenshot: Buffer.from([9, 9, 9]).toString('base64'),
    });
    // El selector va a la página como JSON (no se interpola crudo).
    expect(evaluated[0]).toContain('const sel = "button.buy"');
    expect(() => new Function(`return ${evaluated[0]}`)).not.toThrow();
  });

  it('stores the capture with uploads and shows it on the run', async () => {
    const user = await makeUser('rbf');
    const r = await createRobot(user.id, user.id, { name: 'Shop' });
    if (!r.ok) throw new Error(r.error);
    setRobotBackendForTests(stubBackend({
      status: 'failed',
      error: '2: action_timeout',
      failure: { step: '2', type: 'click', error: 'action_timeout', url: 'https://shop.test/', dom: '<p>x</p>', screenshot: 'AAAA' },
    }));
    const res = await startRobotRun(user.id, r.robot.id, {}, { trigger: 'manual' });
    if (!res.ok) throw new Error(res.error);
    expect(res.run.failure).toMatchObject({ step: '2', url: 'https://shop.test/', dom: '<p>x</p>' });
    expect(res.run.failure?.screenshot).toBe(uploads.saved[0]);
    expect(uploads.saved[0]).toMatch(/^\/uploads\/robots\/.*failure\.jpg$/);
  });

  it('records warnings on a successful run', async () => {
    const user = await makeUser('rbw');
    const r = await createRobot(user.id, user.id, { name: 'W' });
    if (!r.ok) throw new Error(r.error);
    setRobotBackendForTests(stubBackend({ warnings: 2 }));
    const res = await startRobotRun(user.id, r.robot.id, {}, { trigger: 'manual' });
    if (!res.ok) throw new Error(res.error);
    expect(res.run).toMatchObject({ status: 'success', warnings: 2, failure: null });
  });
});

// ---------- Avisos y pausa ----------

function stubBackend(overrides: Partial<Awaited<ReturnType<RobotBackend['run']>>> = {}): RobotBackend {
  return {
    name: 'local',
    async run() {
      return { status: 'success', error: null, vars: {}, logs: [], screenshots: [], pages: 1, ...overrides };
    },
  };
}

async function scheduledRobot(ws: string, pauseAfter = 3) {
  const r = await createRobot(ws, ws, { name: 'Price check' });
  if (!r.ok) throw new Error(r.error);
  await updateRobot(ws, r.robot.id, {
    enabled: true,
    schedule: { mode: 'daily', time: '09:00', timezone: 'UTC', every: 24, unit: 'hours' },
    pauseAfter,
    locale: 'es',
  });
  return r.robot.id;
}

describe('failure alerts and auto-pause', () => {
  it('decides reset, alert, throttle and pause', () => {
    const base = { trigger: 'schedule' as const, failures: 1, pauseAfter: 3, hasSchedule: true, enabled: true, alertsOn: true, lastAlertAt: null };
    expect(decideOutcome({ ...base, status: 'success' })).toBe('reset');
    expect(decideOutcome({ ...base, status: 'failed' })).toBe('alert');
    expect(decideOutcome({ ...base, status: 'failed', trigger: 'manual' })).toBe('none');
    expect(decideOutcome({ ...base, status: 'failed', alertsOn: false })).toBe('none');
    const now = Date.parse('2026-10-20T12:00:00Z');
    expect(decideOutcome({ ...base, status: 'failed', lastAlertAt: '2026-10-20T10:00:00Z', now })).toBe('none');
    expect(decideOutcome({ ...base, status: 'failed', lastAlertAt: '2026-10-20T01:00:00Z', now })).toBe('alert');
    expect(decideOutcome({ ...base, status: 'failed', failures: 3 })).toBe('pause');
    // Pausa aunque los emails de fallas estén apagados; sin schedule o con 0, nunca.
    expect(decideOutcome({ ...base, status: 'failed', failures: 3, alertsOn: false })).toBe('pause');
    expect(decideOutcome({ ...base, status: 'failed', failures: 9, hasSchedule: false })).toBe('alert');
    expect(decideOutcome({ ...base, status: 'failed', failures: 9, pauseAfter: 0 })).toBe('alert');
  });

  it('emails once per throttle window, pauses after N failures in a row and resets on resume', async () => {
    const user = await makeUser('rba');
    const id = await scheduledRobot(user.id, 3);
    setRobotBackendForTests(stubBackend({ status: 'failed', error: '1: action_timeout' }));

    await startRobotRun(user.id, id, undefined, { trigger: 'schedule' });
    expect(mail.sent).toHaveLength(1);
    expect(mail.sent[0].to).toBe(user.email);
    expect(mail.sent[0].subject).toBe('Falló un robot: Price check');
    expect(mail.sent[0].text).toContain('/es/app/robots/');

    // Manual: ni cuenta ni avisa.
    await startRobotRun(user.id, id, undefined, { trigger: 'manual' });
    await startRobotRun(user.id, id, undefined, { trigger: 'schedule' });
    expect(mail.sent).toHaveLength(1);
    expect((await getRobot(user.id, id))?.consecutiveFailures).toBe(2);

    await startRobotRun(user.id, id, undefined, { trigger: 'schedule' });
    const paused = await getRobot(user.id, id);
    expect(paused).toMatchObject({ enabled: false, nextRunAt: null, consecutiveFailures: 3 });
    expect(paused?.pausedAt).toBeTruthy();
    expect(mail.sent).toHaveLength(2);
    expect(mail.sent[1].subject).toBe('Robot pausado: Price check');

    // Pausado: el schedule ya no puede correrlo.
    expect(await startRobotRun(user.id, id, undefined, { trigger: 'schedule' })).toEqual({ ok: false, error: 'disabled' });

    const resumed = await updateRobot(user.id, id, { enabled: true });
    expect(resumed.ok && resumed.robot).toMatchObject({ enabled: true, consecutiveFailures: 0, pausedAt: null });
  });

  it('a success resets the streak', async () => {
    const user = await makeUser('rbs');
    const id = await scheduledRobot(user.id, 2);
    setRobotBackendForTests(stubBackend({ status: 'failed', error: 'x' }));
    await startRobotRun(user.id, id, undefined, { trigger: 'schedule' });
    setRobotBackendForTests(stubBackend());
    await startRobotRun(user.id, id, undefined, { trigger: 'manual' });
    expect((await getRobot(user.id, id))?.consecutiveFailures).toBe(0);
    setRobotBackendForTests(stubBackend({ status: 'failed', error: 'x' }));
    await startRobotRun(user.id, id, undefined, { trigger: 'flow' });
    expect(await getRobot(user.id, id)).toMatchObject({ enabled: true, consecutiveFailures: 1 });
  });
});

// ---------- CSV y retención ----------

describe('run CSV export', () => {
  it('neutralizes formulas and escapes CSV', () => {
    expect(csvCell('=HYPERLINK("http://x")')).toBe(`"'=HYPERLINK(""http://x"")"`);
    expect(csvCell('+1')).toBe("'+1");
    expect(csvCell('-2+3')).toBe("'-2+3");
    expect(csvCell('@SUM(A1)')).toBe("'@SUM(A1)");
    expect(csvCell('\tx')).toBe("'\tx");
    expect(csvCell(-5)).toBe('-5');
    expect(csvCell('a,b')).toBe('"a,b"');
    expect(csvCell('line\nbreak')).toBe('"line\nbreak"');
    expect(csvCell(null)).toBe('');
    expect(csvCell({ a: 1 })).toBe('"{""a"":1}"');
    expect(toCsv(['a'], [['1']])).toBe('a\r\n1\r\n');
  });

  it('turns extracted tables into CSV', () => {
    expect(valueToCsv([{ Name: 'A', Qty: '1' }, { Name: '=B', Price: '2' }])).toBe('Name,Qty,Price\r\nA,1,\r\n\'=B,,2\r\n');
    expect(valueToCsv([['x', 'y'], ['z']])).toBe('1,2\r\nx,y\r\nz,\r\n');
    expect(valueToCsv(['a', 'b'])).toBe('value\r\na\r\nb\r\n');
    expect(valueToCsv('text')).toBeNull();
    expect(csvFilename('Precio diario', 'rows', '2026-10-20T10:00:00Z')).toBe('precio-diario-rows-2026-10-20.csv');
  });
});

describe('run retention', () => {
  it('deletes finished runs older than the retention and their files', async () => {
    const user = await makeUser('rbr');
    const r = await createRobot(user.id, user.id, { name: 'Old' });
    if (!r.ok) throw new Error(r.error);
    await updateRobot(user.id, r.robot.id, { retentionDays: 7 });
    const db = getDb();
    const now = Date.parse('2026-10-20T12:00:00Z');
    const insert = (id: string, status: string, daysAgo: number, extra: { screenshots?: string; failure?: string; output?: string } = {}) =>
      db
        .prepare(
          `INSERT INTO robot_runs (id, robot_id, user_id, status, trigger, screenshots, failure, output, created_at)
           VALUES (?, ?, ?, ?, 'manual', ?, ?, ?, ?)`,
        )
        .run(
          id,
          r.robot.id,
          user.id,
          status,
          extra.screenshots ?? '[]',
          extra.failure ?? null,
          extra.output ?? '{}',
          new Date(now - daysAgo * 86_400_000).toISOString(),
        );
    const old = `${r.robot.id}-old`;
    await insert(old, 'failed', 10, {
      screenshots: JSON.stringify([{ name: 's', url: '/uploads/robots/a.jpg' }, { name: 'i', url: 'data:image/jpeg;base64,AA' }]),
      failure: JSON.stringify({ screenshot: 'https://store.public.blob.vercel-storage.com/robots/f.jpg' }),
      output: JSON.stringify({ file: { url: '/uploads/robots/b.pdf' }, other: { url: 'https://evil.test/x' } }),
    });
    await insert(`${r.robot.id}-new`, 'success', 3);
    await insert(`${r.robot.id}-queued`, 'queued', 30);
    const n = await pruneRobotRuns(now);
    expect(n).toBeGreaterThanOrEqual(1);
    const ids = (await listRobotRuns(user.id, r.robot.id)).map((x) => x.id).sort();
    expect(ids).toEqual([`${r.robot.id}-new`, `${r.robot.id}-queued`]);
    expect(uploads.deleted).toEqual(
      expect.arrayContaining(['/uploads/robots/a.jpg', 'https://store.public.blob.vercel-storage.com/robots/f.jpg', '/uploads/robots/b.pdf']),
    );
    expect(uploads.deleted).not.toContain('https://evil.test/x');
  });

  it('collects only our upload URLs from a run', () => {
    expect(
      runUploadUrls({
        screenshots: JSON.stringify([{ url: 'data:image/jpeg;base64,AA' }, { url: '/uploads/robots/x.jpg' }]),
        failure: null,
        output: '{"rows":[{"url":"/uploads/robots/nope.jpg"}]}',
      }),
    ).toEqual(['/uploads/robots/x.jpg']);
  });
});

// ---------- Flow: selector de robot ----------

describe('Flow robot picker', () => {
  it('loads the robot inputs keeping values already typed', () => {
    const defs = [
      { name: 'url', label: 'URL', required: true, default: '' },
      { name: 'q', label: '', required: false, default: 'x' },
    ];
    expect(robotInputRows(defs, [])).toEqual([
      { key: 'url', value: '' },
      { key: 'q', value: '' },
    ]);
    expect(
      robotInputRows(defs, [
        { key: 'q', value: '{{trigger.q}}' },
        { key: 'old', value: '' },
        { key: 'extra', value: 'keep' },
      ]),
    ).toEqual([
      { key: 'url', value: '' },
      { key: 'q', value: '{{trigger.q}}' },
      { key: 'extra', value: 'keep' },
    ]);
  });
});
