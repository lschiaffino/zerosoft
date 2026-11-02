import { afterAll, describe, expect, it } from 'vitest';
import { nanoid } from 'nanoid';
import { getDb, upsertUser } from '@/lib/db';
import { computeFunnel, pathWindow, timeBins, type FunnelRow } from '@/lib/analytics/funnel-core';
import { parseIngestBody } from '@/lib/analytics/ingest-core';
import { storeEvents } from '@/lib/analytics/ingest';
import { createProject, getProject, type ProjectRow } from '@/lib/analytics/projects';
import { runFunnel, runPaths } from '@/lib/analytics/query';
import { publicResult } from '@/lib/analytics/share-view';
import { funnelQuerySchema, funnelWindowMs, pathsQuerySchema, shareableQuery } from '@/lib/analytics/types';

const MIN = 60_000;
const DAY = 86_400_000;
const WIDE = { from: 0, to: 10_000 * DAY };
const rows = (person: string, list: Array<[number, number[], number[]?, (string | null)?]>): FunnelRow[] =>
  list.map(([ts, steps, excl, value]) => ({ person, ts, steps, excl, value }));

describe('funnel core: order', () => {
  // a(0) x b(1) c(2) con otro evento en el medio.
  const events = rows('p', [
    [0, [0]],
    [1, []],
    [2, [1]],
    [3, [2]],
  ]);

  it('sequential lets other events happen in between', () => {
    expect(computeFunnel(events, 3, DAY, WIDE, { order: 'ordered' }).counts).toEqual([1, 1, 1]);
  });

  it('strict needs the next step right after', () => {
    expect(computeFunnel(events, 3, DAY, WIDE, { order: 'strict' }).counts).toEqual([1, 0, 0]);
    const direct = rows('p', [
      [0, [0]],
      [1, [1]],
      [2, []],
      [3, [2]],
    ]);
    expect(computeFunnel(direct, 3, DAY, WIDE, { order: 'strict' }).counts).toEqual([1, 1, 0]);
  });

  it('strict takes the attempt that goes furthest', () => {
    const second = rows('p', [
      [0, [0]],
      [1, []],
      [2, [0]],
      [3, [1]],
    ]);
    expect(computeFunnel(second, 2, DAY, WIDE, { order: 'strict' }).counts).toEqual([1, 1]);
  });

  it('any order counts distinct steps done, whatever the sequence', () => {
    const backwards = rows('p', [
      [0, [2]],
      [1, [0]],
      [2, [1]],
    ]);
    expect(computeFunnel(backwards, 3, DAY, WIDE, { order: 'unordered' }).counts).toEqual([1, 1, 1]);
    expect(computeFunnel(backwards, 3, DAY, WIDE, { order: 'ordered' }).counts).toEqual([1, 1, 0]);
    const one = rows('q', [
      [0, [1]],
      [1, [1]],
    ]);
    expect(computeFunnel(one, 3, DAY, WIDE, { order: 'unordered' }).counts).toEqual([1, 0, 0]);
  });

  it('a repeated step needs two events, in every order', () => {
    const once = rows('p', [[0, [0, 1]]]);
    const twice = rows('p', [
      [0, [0, 1]],
      [1, [0, 1]],
    ]);
    for (const order of ['ordered', 'strict', 'unordered'] as const) {
      expect(computeFunnel(once, 2, DAY, WIDE, { order }).counts).toEqual([1, 0]);
      expect(computeFunnel(twice, 2, DAY, WIDE, { order }).counts).toEqual([1, 1]);
    }
  });

  it('the window counts from the first step and ends the attempt at its exact limit', () => {
    const on = rows('p', [
      [0, [0]],
      [DAY, [1]],
    ]);
    const past = rows('p', [
      [0, [0]],
      [DAY + 1, [1]],
    ]);
    expect(computeFunnel(on, 2, DAY, WIDE).counts).toEqual([1, 1]);
    expect(computeFunnel(past, 2, DAY, WIDE).counts).toEqual([1, 0]);
  });

  it('the date range applies to every step', () => {
    const late = rows('p', [
      [0, [0]],
      [5 * DAY, [1]],
    ]);
    expect(computeFunnel(late, 2, 30 * DAY, { from: 0, to: 2 * DAY }).counts).toEqual([1, 0]);
  });
});

describe('funnel core: exclusions', () => {
  const exclusions = [{ fromStep: 0, toStep: 1 }];
  it('removes the person from the whole funnel', () => {
    const r = computeFunnel(
      rows('p', [
        [0, [0]],
        [1, [], [0]],
        [2, [1]],
      ]),
      2,
      DAY,
      WIDE,
      { exclusions },
    );
    expect(r.counts).toEqual([0, 0]);
    expect(r.dropped[0]).toEqual([]);
  });

  it('a clean later attempt does not bring them back', () => {
    const r = computeFunnel(
      rows('p', [
        [0, [0]],
        [1, [], [0]],
        [2, [0]],
        [3, [1]],
      ]),
      2,
      DAY,
      WIDE,
      { exclusions },
    );
    expect(r.counts).toEqual([0, 0]);
  });

  it('does not touch people who did it outside those steps or after converting', () => {
    const before = rows('a', [
      [0, [], [0]],
      [1, [0]],
      [2, [1]],
    ]);
    const after = rows('b', [
      [0, [0]],
      [1, [1]],
      [2, [], [0]],
    ]);
    expect(computeFunnel([...before, ...after], 2, DAY, WIDE, { exclusions }).counts).toEqual([2, 2]);
  });

  it('between step 2 and 3 only applies once step 2 is done', () => {
    const list = rows('p', [
      [0, [0]],
      [1, [], [0]],
      [2, [1]],
      [3, [2]],
    ]);
    expect(computeFunnel(list, 3, DAY, WIDE, { exclusions: [{ fromStep: 1, toStep: 2 }] }).counts).toEqual([1, 1, 1]);
    expect(computeFunnel(list, 3, DAY, WIDE, { exclusions: [{ fromStep: 0, toStep: 1 }] }).counts).toEqual([0, 0, 0]);
  });

  it('an exclusion outside the window is ignored', () => {
    const list = rows('p', [
      [0, [0]],
      [2 * DAY, [], [0]],
    ]);
    expect(computeFunnel(list, 2, DAY, WIDE, { exclusions }).counts).toEqual([1, 0]);
  });

  it('in any order it applies while the steps are being completed', () => {
    const list = rows('p', [
      [0, [1]],
      [1, [], [0]],
      [2, [0]],
    ]);
    expect(computeFunnel(list, 2, DAY, WIDE, { order: 'unordered', exclusions: [{ fromStep: 0, toStep: 1 }] }).counts).toEqual([0, 0]);
  });
});

describe('funnel core: attribution', () => {
  // Del ejemplo de la documentación: pageview en Chrome, signup en Firefox.
  const chromeThenFirefox = rows('p', [
    [0, [0], [], 'Chrome'],
    [1, [1], [], 'Firefox'],
  ]);

  it('first and last touchpoint', () => {
    expect(computeFunnel(chromeThenFirefox, 2, DAY, WIDE, { attribution: 'first' }).breakdown).toEqual([{ value: 'Chrome', counts: [1, 1] }]);
    expect(computeFunnel(chromeThenFirefox, 2, DAY, WIDE, { attribution: 'last' }).breakdown).toEqual([{ value: 'Firefox', counts: [1, 1] }]);
  });

  it('first skips events without a value', () => {
    const list = rows('p', [
      [0, [0], [], null],
      [1, [1], [], 'Safari'],
    ]);
    expect(computeFunnel(list, 2, DAY, WIDE, { attribution: 'first' }).breakdown).toEqual([{ value: 'Safari', counts: [1, 1] }]);
  });

  it('nobody with a value lands in the empty value', () => {
    const list = rows('p', [[0, [0], [], null]]);
    expect(computeFunnel(list, 2, DAY, WIDE, { attribution: 'first' }).breakdown).toEqual([{ value: null, counts: [1, 0] }]);
  });

  it('all steps counts the person in each value with the steps done with it', () => {
    // Chrome hace los tres pasos; Firefox solo el pageview.
    const list = rows('p', [
      [0, [0], [], 'Chrome'],
      [1, [0], [], 'Firefox'],
      [2, [1], [], 'Chrome'],
      [3, [2], [], 'Chrome'],
    ]);
    const b = computeFunnel(list, 3, DAY, WIDE, { attribution: 'all' }).breakdown;
    expect(b.find((x) => x.value === 'Chrome')?.counts).toEqual([1, 1, 1]);
    expect(b.find((x) => x.value === 'Firefox')?.counts).toEqual([1, 0, 0]);
    expect(computeFunnel(list, 3, DAY, WIDE, { attribution: 'all' }).counts).toEqual([1, 1, 1]);
  });

  it('a specific step takes the value there and leaves out who has none', () => {
    const r = computeFunnel(chromeThenFirefox, 2, DAY, WIDE, { attribution: 'step', attributionStep: 1 });
    expect(r.breakdown).toEqual([{ value: 'Firefox', counts: [1, 1] }]);
    const onlyView = rows('q', [[0, [0], [], 'Chrome']]);
    const s = computeFunnel(onlyView, 2, DAY, WIDE, { attribution: 'step', attributionStep: 1 });
    expect(s.breakdown).toEqual([]);
  });

  it('more than 25 values fold into Other', () => {
    const list: FunnelRow[] = [];
    for (let i = 0; i < 30; i++) list.push({ person: `p${String(i).padStart(2, '0')}`, ts: 0, steps: [0], value: `v${i}` });
    const b = computeFunnel(list, 2, DAY, WIDE, { attribution: 'first' }).breakdown;
    expect(b).toHaveLength(25);
    expect(b[24]).toEqual({ value: '$other', counts: [6, 0] });
  });
});

describe('funnel core: time to convert', () => {
  it('reports pairs of steps and first to last', () => {
    const list = [
      ...rows('a', [
        [0, [0]],
        [10 * MIN, [1]],
        [30 * MIN, [2]],
      ]),
      ...rows('b', [
        [0, [0]],
        [20 * MIN, [1]],
        [60 * MIN, [2]],
      ]),
    ];
    const { times, medians } = computeFunnel(list, 3, DAY, WIDE);
    expect(times.map((t) => [t.fromStep, t.toStep])).toEqual([
      [0, 1],
      [1, 2],
      [0, 2],
    ]);
    expect(times[0].avgMs).toBe(15 * MIN);
    expect(times[2].avgMs).toBe(45 * MIN);
    expect(times[2].bins.reduce((a, b) => a + b.count, 0)).toBe(2);
    expect(medians[1]).toBe(15 * MIN);
  });

  it('bins hold every value, and all-equal values make one bin', () => {
    expect(timeBins([])).toEqual([]);
    expect(timeBins([5, 5, 5])).toEqual([{ fromMs: 5, toMs: 5, count: 3 }]);
    const xs = Array.from({ length: 1000 }, (_, i) => i * 7);
    const bins = timeBins(xs);
    expect(bins.length).toBe(12);
    expect(bins.reduce((a, b) => a + b.count, 0)).toBe(1000);
  });
});

describe('funnel core: historical', () => {
  const NOW = Date.UTC(2030, 0, 10, 12);
  const day = (n: number) => Date.UTC(2030, 0, n, 12);
  const range = { from: Date.UTC(2030, 0, 1), to: NOW };

  it('counts each person in each period by entry date, with their best attempt', () => {
    const list = rows('p', [
      [day(1), [0]],
      [day(1) + 1, [1]],
      [day(3), [0]],
    ]);
    const r = computeFunnel(list, 2, MIN, range, { historical: { interval: 'day', tz: 0, now: NOW } });
    const at = (b: string) => r.historical?.find((x) => x.bucket === b);
    expect(at('2030-01-01')?.counts).toEqual([1, 1]);
    expect(at('2030-01-02')?.counts).toEqual([0, 0]);
    expect(at('2030-01-03')?.counts).toEqual([1, 0]);
  });

  it('marks as incomplete the periods still inside the window', () => {
    const r = computeFunnel(rows('p', [[day(1), [0]]]), 2, 2 * DAY, range, { historical: { interval: 'day', tz: 0, now: NOW } });
    const inc = r.historical?.filter((b) => b.incomplete).map((b) => b.bucket);
    expect(inc).toEqual(['2030-01-08', '2030-01-09', '2030-01-10']);
  });

  it('uses the project time zone for the entry date', () => {
    // 01:00 UTC del 2 de enero es 22:00 del 1 en Buenos Aires.
    const ts = Date.UTC(2030, 0, 2, 1);
    const r = computeFunnel(rows('p', [[ts, [0]]]), 2, MIN, range, { historical: { interval: 'day', tz: 'America/Argentina/Buenos_Aires', now: NOW } });
    expect(r.historical?.find((b) => b.counts[0] > 0)?.bucket).toBe('2030-01-01');
  });
});

describe('paths from a funnel step', () => {
  it('each mode looks at the right part, and only at the right people', () => {
    const conv = [10, 20, 30];
    expect(pathWindow('before', 1, conv)).toEqual({ from: Number.NEGATIVE_INFINITY, to: 20 });
    expect(pathWindow('between', 1, conv)).toEqual({ from: 10, to: 20 });
    expect(pathWindow('after', 1, conv)).toEqual({ from: 20, to: Number.POSITIVE_INFINITY });
    expect(pathWindow('between', 0, conv)).toBeNull();
    // Abandonó en el paso 3 (índice 2): llegó al 2 y no al 3.
    const left = [10, 20];
    expect(pathWindow('after_dropoff', 2, left)).toEqual({ from: 20, to: Number.POSITIVE_INFINITY });
    expect(pathWindow('before_dropoff', 2, left)).toEqual({ from: Number.NEGATIVE_INFINITY, to: 20 });
    expect(pathWindow('after_dropoff', 1, left)).toBeNull();
    expect(pathWindow('after', 2, left)).toBeNull();
  });
});

describe('funnel query', () => {
  it('window units convert, with a cap of a year', () => {
    expect(funnelWindowMs({ windowDays: 14 })).toBe(14 * DAY);
    expect(funnelWindowMs({ windowDays: 14, window: { value: 90, unit: 'minute' } })).toBe(90 * MIN);
    expect(funnelWindowMs({ windowDays: 14, window: { value: 2, unit: 'week' } })).toBe(14 * DAY);
    expect(funnelWindowMs({ windowDays: 14, window: { value: 1, unit: 'month' } })).toBe(30 * DAY);
    expect(funnelWindowMs({ windowDays: 14, window: { value: 10_000, unit: 'month' } })).toBe(365 * DAY);
  });

  it('a saved funnel from before keeps working', () => {
    const q = funnelQuerySchema.parse({ kind: 'funnel', steps: [{ event: 'a' }, { event: 'b' }], windowDays: 7 });
    expect(q.order).toBeUndefined();
    expect(funnelWindowMs(q)).toBe(7 * DAY);
  });

  it('a funnel opened by a person property does not go on a public link, and an event one does', () => {
    const base = { kind: 'funnel', steps: [{ event: 'a' }, { event: 'b' }] };
    expect(shareableQuery(funnelQuerySchema.parse({ ...base, breakdown: { key: 'email', type: 'person' } }))).toBe(false);
    expect(shareableQuery(funnelQuerySchema.parse({ ...base, breakdown: { key: 'distinct_id', type: 'event' } }))).toBe(false);
    expect(shareableQuery(funnelQuerySchema.parse({ ...base, breakdown: { key: '$browser', type: 'event' } }))).toBe(true);
  });

  it('a public result carries nobody', () => {
    const r = publicResult({ kind: 'funnel', steps: [], droppedPersons: [['x']], reachedPersons: [['x']], truncated: false });
    expect(JSON.stringify(r)).not.toContain('"x"');
  });
});

describe('funnel query on stored events', () => {
  const created: string[] = [];
  const NOW = Date.now();
  afterAll(async () => {
    for (const id of created) {
      await getDb().prepare('DELETE FROM analytics_events WHERE project_id = ?').run(id);
      await getDb().prepare('DELETE FROM analytics_projects WHERE id = ?').run(id);
    }
  });

  async function setup(): Promise<ProjectRow> {
    const user = await upsertUser({ email: `an-funnel-${nanoid(8)}@test.dev` });
    const project = await createProject(user.id, user.id, 'F');
    created.push(project.id);
    return project;
  }
  async function ingest(project: ProjectRow, events: Array<{ event: string; who: string; at: number; props?: Record<string, unknown> }>) {
    const parsed = parseIngestBody(
      JSON.stringify({
        api_key: project.public_key,
        batch: events.map((e) => ({ event: e.event, distinct_id: e.who, timestamp: new Date(e.at).toISOString(), properties: e.props ?? {} })),
      }),
    );
    if (!parsed.ok) throw new Error(parsed.error);
    await storeEvents((await getProject(project.workspace_id, project.id))!, parsed.events, null);
  }
  const query = (extra: Record<string, unknown>) => funnelQuerySchema.parse({ kind: 'funnel', steps: [{ event: 'view' }, { event: 'buy' }], dateRange: { from: '-7d' }, ...extra });

  it('strict order sees events that are not steps', async () => {
    const p = await setup();
    await ingest(p, [
      { event: 'view', who: 'direct', at: NOW - 5000 },
      { event: 'buy', who: 'direct', at: NOW - 4000 },
      { event: 'view', who: 'wander', at: NOW - 5000 },
      { event: 'other', who: 'wander', at: NOW - 4500 },
      { event: 'buy', who: 'wander', at: NOW - 4000 },
    ]);
    expect((await runFunnel(p, query({}))).steps.map((s) => s.count)).toEqual([2, 2]);
    expect((await runFunnel(p, query({ order: 'strict' }))).steps.map((s) => s.count)).toEqual([2, 1]);
  });

  it('or events in one step, exclusions by event and the same event as a step is ignored', async () => {
    const p = await setup();
    await ingest(p, [
      { event: 'view', who: 'a', at: NOW - 5000 },
      { event: 'purchase', who: 'a', at: NOW - 4000 },
      { event: 'view', who: 'b', at: NOW - 5000 },
      { event: 'refund', who: 'b', at: NOW - 4500 },
      { event: 'buy', who: 'b', at: NOW - 4000 },
    ]);
    const or = await runFunnel(p, query({ steps: [{ event: 'view' }, { event: 'buy', orEvents: ['purchase'] }] }));
    expect(or.steps.map((s) => s.count)).toEqual([2, 2]);
    expect(or.steps[1].label).toBe('buy / purchase');
    const ex = await runFunnel(p, query({ exclusions: [{ event: 'refund', fromStep: 0, toStep: 1 }] }));
    expect(ex.steps.map((s) => s.count)).toEqual([1, 0]);
    const ignored = await runFunnel(p, query({ exclusions: [{ event: 'buy', fromStep: 0, toStep: 1 }] }));
    expect(ignored.steps.map((s) => s.count)).toEqual([2, 1]);
  });

  it('counts sessions, and the people behind them are who gets listed', async () => {
    const p = await setup();
    await ingest(p, [
      { event: 'view', who: 'a', at: NOW - 5000, props: { $session_id: 's1' } },
      { event: 'buy', who: 'a', at: NOW - 4000, props: { $session_id: 's1' } },
      { event: 'view', who: 'a', at: NOW - 3000, props: { $session_id: 's2' } },
      { event: 'view', who: 'b', at: NOW - 3000 },
    ]);
    const r = await runFunnel(p, query({ bySession: true }));
    expect(r.unit).toBe('session');
    expect(r.steps.map((s) => s.count)).toEqual([2, 1]);
    expect(r.droppedPersons[0]).toHaveLength(1);
    expect(r.droppedPersons[0][0]).not.toBe('s2');
  });

  it('first occurrence: ever needs the first time in the whole history, matching only among those that fit', async () => {
    const p = await setup();
    await ingest(p, [
      // Volvió: su primer "view" fue hace rato, fuera del rango.
      { event: 'view', who: 'old', at: NOW - 20 * DAY, props: { plan: 'free' } },
      { event: 'view', who: 'old', at: NOW - 5000, props: { plan: 'pro' } },
      { event: 'view', who: 'new', at: NOW - 5000, props: { plan: 'pro' } },
    ]);
    expect((await runFunnel(p, query({}))).steps[0].count).toBe(2);
    expect((await runFunnel(p, query({ steps: [{ event: 'view', first: 'ever' }, { event: 'buy' }] }))).steps[0].count).toBe(1);
    const filters = [{ key: 'plan', op: 'eq', value: 'pro', type: 'event' }];
    expect((await runFunnel(p, query({ steps: [{ event: 'view', filters, first: 'ever' }, { event: 'buy' }] }))).steps[0].count).toBe(1);
    expect((await runFunnel(p, query({ steps: [{ event: 'view', filters, first: 'matching' }, { event: 'buy' }] }))).steps[0].count).toBe(2);
  });

  it('first-ever on a later step leaves out the whole person when that first time does not count, and not who has yet to do it', async () => {
    const p = await setup();
    await ingest(p, [
      // Su primera compra fue fuera del rango: afuera de todo, también del primer paso.
      { event: 'buy', who: 'old', at: NOW - 20 * DAY },
      { event: 'view', who: 'old', at: NOW - 5000 },
      { event: 'buy', who: 'old', at: NOW - 4000 },
      // Su primera compra no cumple el filtro: también afuera, aunque la segunda sí.
      { event: 'view', who: 'nofit', at: NOW - 5000 },
      { event: 'buy', who: 'nofit', at: NOW - 4500, props: { plan: 'free' } },
      { event: 'buy', who: 'nofit', at: NOW - 4000, props: { plan: 'pro' } },
      // Nunca compró: abandona en el paso 1.
      { event: 'view', who: 'yet', at: NOW - 5000 },
      // Primera compra en rango y con el filtro: convierte.
      { event: 'view', who: 'fits', at: NOW - 5000 },
      { event: 'buy', who: 'fits', at: NOW - 4000, props: { plan: 'pro' } },
    ]);
    const filters = [{ key: 'plan', op: 'eq', value: 'pro', type: 'event' }];
    const ever = await runFunnel(p, query({ steps: [{ event: 'view' }, { event: 'buy', filters, first: 'ever' }] }));
    expect(ever.steps.map((s) => s.count)).toEqual([2, 1]);
    // La primera que cumple los filtros ignora las anteriores que no: 'nofit' vuelve.
    const matching = await runFunnel(p, query({ steps: [{ event: 'view' }, { event: 'buy', filters, first: 'matching' }] }));
    expect(matching.steps.map((s) => s.count)).toEqual([4, 2]);
  });

  it('first occurrence ignores a row with an impossible date', async () => {
    const p = await setup();
    await ingest(p, [{ event: 'view', who: 'a', at: NOW - 5000 }]);
    await getDb().prepare("INSERT INTO analytics_events (project_id, event, distinct_id, ts, properties) VALUES (?, 'view', 'a', -1152921504606846976, '{}')").run(p.id);
    expect((await runFunnel(p, query({ steps: [{ event: 'view', first: 'ever' }, { event: 'buy' }] }))).steps[0].count).toBe(1);
  });

  it('paths from a step only take who is there, in the right stretch', async () => {
    const p = await setup();
    const s = (who: string) => ({ $session_id: `s-${who}` });
    await ingest(p, [
      { event: 'before', who: 'conv', at: NOW - 9000, props: s('conv') },
      { event: 'view', who: 'conv', at: NOW - 8000, props: s('conv') },
      { event: 'middle', who: 'conv', at: NOW - 7000, props: s('conv') },
      { event: 'buy', who: 'conv', at: NOW - 6000, props: s('conv') },
      { event: 'later', who: 'conv', at: NOW - 5000, props: s('conv') },
      { event: 'view', who: 'gone', at: NOW - 8000, props: s('gone') },
      { event: 'left', who: 'gone', at: NOW - 7000, props: s('gone') },
    ]);
    const funnel = funnelQuerySchema.parse({ kind: 'funnel', steps: [{ event: 'view' }, { event: 'buy' }], dateRange: { from: '-7d' } });
    const nodes = async (mode: string, step: number) => {
      const r = await runPaths(p, pathsQuerySchema.parse({ kind: 'paths', dateRange: { from: '-7d' }, steps: 6, source: 'all', funnel: { query: funnel, step, mode } }));
      return r.topPaths.map((x) => x.path);
    };
    expect(await nodes('before', 1)).toEqual([['before', 'view', 'middle', 'buy']]);
    expect(await nodes('between', 1)).toEqual([['view', 'middle', 'buy']]);
    expect(await nodes('after', 1)).toEqual([['buy', 'later']]);
    expect(await nodes('after_dropoff', 1)).toEqual([['view', 'left']]);
    expect(await nodes('before_dropoff', 1)).toEqual([['view']]);
    // Sin embudo se ve todo.
    const all = await runPaths(p, pathsQuerySchema.parse({ kind: 'paths', dateRange: { from: '-7d' }, steps: 6, source: 'all' }));
    expect(all.sessions).toBe(2);
  });

  it('breakdown by event property and historical view', async () => {
    const p = await setup();
    await ingest(p, [
      { event: 'view', who: 'a', at: NOW - 5000, props: { $browser: 'Chrome' } },
      { event: 'buy', who: 'a', at: NOW - 4000, props: { $browser: 'Firefox' } },
      { event: 'view', who: 'b', at: NOW - 5000, props: { $browser: 'Chrome' } },
    ]);
    const r = await runFunnel(p, query({ breakdown: { key: '$browser', type: 'event' } }));
    expect(r.breakdown).toEqual([{ value: 'Chrome', counts: [2, 1] }]);
    const last = await runFunnel(p, query({ breakdown: { key: '$browser', type: 'event' }, attribution: 'last' }));
    expect(last.breakdown?.map((b) => [b.value, b.counts])).toEqual([
      ['Chrome', [1, 0]],
      ['Firefox', [1, 1]],
    ]);
    const h = await runFunnel(p, query({ display: 'trends', interval: 'day' }));
    expect(h.historical?.reduce((a, b) => a + b.counts[0], 0)).toBe(2);
    expect(h.historical?.reduce((a, b) => a + b.counts[1], 0)).toBe(1);
    expect(h.historical?.[h.historical.length - 1].incomplete).toBe(true);
  });
});
