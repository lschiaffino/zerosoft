import { afterAll, describe, expect, it } from 'vitest';
import { nanoid } from 'nanoid';
import { getDb, upsertUser } from '@/lib/db';
import { parseIngestBody } from '@/lib/analytics/ingest-core';
import { storeEvents } from '@/lib/analytics/ingest';
import { createProject, getProject, type ProjectRow } from '@/lib/analytics/projects';
import { runTrends } from '@/lib/analytics/query';
import { activeInWindow, bucketEndDay, formatTrendValue, isWeekend, rolling } from '@/lib/analytics/trend-core';
import { createCohort } from '@/lib/analytics/records';
import { addCohortMembers } from '@/lib/analytics/records-more';
import { cohortDefinitionSchema, trendsQuerySchema } from '@/lib/analytics/types';

const DAY = 86_400_000;

describe('trend core', () => {
  it('rolling average uses what it has at the start', () => {
    expect(rolling([1, 2, 3, 4], 2)).toEqual([1, 1.5, 2.5, 3.5]);
    expect(rolling([7], 7)).toEqual([7]);
    expect(rolling([], 7)).toEqual([]);
  });

  it('weekends are local dates', () => {
    expect(isWeekend('2030-01-05')).toBe(true); // sábado
    expect(isWeekend('2030-01-06')).toBe(true); // domingo
    expect(isWeekend('2030-01-07')).toBe(false);
  });

  it('a bucket ends on its last day, never past today', () => {
    expect(bucketEndDay('2030-01-07', 'day', '2030-12-31')).toBe('2030-01-07');
    expect(bucketEndDay('2030-01-07', 'week', '2030-12-31')).toBe('2030-01-13');
    expect(bucketEndDay('2030-02-01', 'month', '2030-12-31')).toBe('2030-02-28');
    expect(bucketEndDay('2030-01-07', 'week', '2030-01-09')).toBe('2030-01-09');
    expect(bucketEndDay('2030-01-07 10:00', 'hour', '2030-12-31')).toBe('2030-01-07');
  });

  it('active people in a trailing window, each once', () => {
    const rows = [
      { day: '2030-01-01', person: 'a' },
      { day: '2030-01-03', person: 'a' },
      { day: '2030-01-03', person: 'b' },
      { day: '2030-01-08', person: 'c' },
    ];
    const buckets = ['2030-01-01', '2030-01-03', '2030-01-07', '2030-01-08', '2030-01-10', '2030-01-11'];
    // Ventana de 7 días: el 7 todavía ve el 1; el 8 ya no y ve el 3 y el 8; el 10 mira del 4 al 10, solo el 8.
    expect(activeInWindow(rows, buckets, 'day', 7, '2030-12-31')).toEqual([1, 2, 2, 3, 1, 1]);
  });

  it('values take their unit, prefix and suffix', () => {
    expect(formatTrendValue(1234.5, null, 'en')).toBe('1,234.5');
    expect(formatTrendValue(1234, { unit: 'short' }, 'en')).toBe('1.2K');
    expect(formatTrendValue(90, { unit: 'duration' }, 'en')).toBe('1m 30s');
    expect(formatTrendValue(1500, { unit: 'duration_ms' }, 'en')).toBe('2s');
    expect(formatTrendValue(250, { unit: 'duration_ms' }, 'en')).toBe('250ms');
    expect(formatTrendValue(12.5, { unit: 'percentage' }, 'en')).toBe('12.5%');
    expect(formatTrendValue(10, { unit: 'currency', currency: 'EUR' }, 'en')).toBe('€10.00');
    expect(formatTrendValue(10, { prefix: '$', suffix: ' ok' }, 'en')).toBe('$10 ok');
  });
});

describe('trends on stored events', () => {
  const created: string[] = [];
  const NOW = Date.now();
  afterAll(async () => {
    for (const id of created) {
      await getDb().prepare('DELETE FROM analytics_events WHERE project_id = ?').run(id);
      await getDb().prepare('DELETE FROM analytics_projects WHERE id = ?').run(id);
    }
  });

  async function setup(): Promise<ProjectRow> {
    const user = await upsertUser({ email: `an-trends-${nanoid(8)}@test.dev` });
    const project = await createProject(user.id, user.id, 'T');
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
  const query = (series: Array<Record<string, unknown>>, extra: Record<string, unknown> = {}) => trendsQuerySchema.parse({ kind: 'trends', series, dateRange: { from: '-14d' }, ...extra });

  it('or events make one series, and first occurrence counts each person once', async () => {
    const p = await setup();
    await ingest(p, [
      { event: 'buy', who: 'a', at: NOW - 40 * DAY },
      { event: 'buy', who: 'a', at: NOW - 2 * DAY },
      { event: 'buy', who: 'b', at: NOW - 2 * DAY },
      { event: 'buy', who: 'b', at: NOW - DAY },
      { event: 'purchase', who: 'c', at: NOW - DAY },
    ]);
    const or = await runTrends(p, query([{ event: 'buy', orEvents: ['purchase'] }]));
    expect(or.series[0].total).toBe(4);
    expect(or.series[0].label).toBe('buy / purchase');
    // La primera de 'a' fue hace 40 días, fuera del rango: solo 'b'.
    const first = await runTrends(p, query([{ event: 'buy', first: 'ever' }]));
    expect(first.series[0].total).toBe(1);
    const both = await runTrends(p, query([{ event: 'buy', orEvents: ['purchase'], first: 'ever' }]));
    expect(both.series[0].total).toBe(2);
  });

  it('first occurrence: ever needs the first to fit the filter, matching looks for the first that fits', async () => {
    const p = await setup();
    await ingest(p, [
      { event: 'buy', who: 'a', at: NOW - 3 * DAY, props: { plan: 'free' } },
      { event: 'buy', who: 'a', at: NOW - 2 * DAY, props: { plan: 'pro' } },
      { event: 'buy', who: 'a', at: NOW - DAY, props: { plan: 'pro' } },
    ]);
    const filters = [{ key: 'plan', op: 'eq', value: 'pro', type: 'event' }];
    expect((await runTrends(p, query([{ event: 'buy', filters, first: 'ever' }]))).series[0].total).toBe(0);
    expect((await runTrends(p, query([{ event: 'buy', filters, first: 'matching' }]))).series[0].total).toBe(1);
  });

  it('weekly and monthly active look back past the range, and the total is the latest value', async () => {
    const p = await setup();
    await ingest(p, [
      { event: 'use', who: 'a', at: NOW - 10 * DAY },
      { event: 'use', who: 'b', at: NOW - 5 * DAY },
      { event: 'use', who: 'c', at: NOW - 1000 },
      { event: 'use', who: 'old', at: NOW - 20 * DAY },
    ]);
    const q = { dateRange: { from: '-1d' } };
    const wau = await runTrends(p, query([{ event: 'use', math: 'wau' }], q));
    // b y c en los últimos 7 días.
    expect(wau.series[0].total).toBe(2);
    const mau = await runTrends(p, query([{ event: 'use', math: 'mau' }], q));
    expect(mau.series[0].total).toBe(4);
  });

  it('per-person counts: min, max, median and percentiles', async () => {
    const p = await setup();
    const at = NOW - 1000;
    const times = (who: string, n: number) => Array.from({ length: n }, (_, i) => ({ event: 'x', who, at: at - i }));
    await ingest(p, [...times('a', 1), ...times('b', 2), ...times('c', 9)]);
    const total = async (math: string) => (await runTrends(p, query([{ event: 'x', math }]))).series[0].total;
    expect(await total('per_user_min')).toBe(1);
    expect(await total('per_user_max')).toBe(9);
    expect(await total('per_user_median')).toBe(2);
    expect(await total('per_user_p75')).toBe(5.5);
    expect(await total('per_user')).toBe(4);
  });

  it('p75 of a property', async () => {
    const p = await setup();
    await ingest(p, [1, 2, 3, 4, 5].map((v, i) => ({ event: 'x', who: `p${i}`, at: NOW - 1000, props: { v } })));
    const r = await runTrends(p, query([{ event: 'x', math: 'p75', mathProperty: 'v' }]));
    expect(r.series[0].total).toBe(4);
  });

  it('smoothing reads days before the range so the first day is a real average', async () => {
    const p = await setup();
    await ingest(p, [
      { event: 'x', who: 'a', at: NOW - 3 * DAY },
      { event: 'x', who: 'a', at: NOW - 3 * DAY + 1 },
      { event: 'x', who: 'a', at: NOW - 3 * DAY + 2 },
    ]);
    const plain = await runTrends(p, query([{ event: 'x' }], { dateRange: { from: '-1d' } }));
    expect(plain.series[0].total).toBe(0);
    const r = await runTrends(p, query([{ event: 'x' }], { dateRange: { from: '-1d' }, options: { smoothing: 7 } }));
    // Tres eventos hace tres días: en la ventana de 7, 3/7 = 0,43 por día.
    expect(r.series[0].data[0]).toBe(0.43);
    expect(r.series[0].total).toBe(0);
    expect(r.buckets).toEqual(plain.buckets);
  });

  it('hiding weekends drops those days and the total follows what is shown', async () => {
    const p = await setup();
    const events = [];
    for (let i = 0; i < 14; i++) events.push({ event: 'x', who: 'a', at: NOW - i * DAY - 1000 });
    await ingest(p, events);
    const all = await runTrends(p, query([{ event: 'x' }], { dateRange: { from: '-14d' } }));
    const r = await runTrends(p, query([{ event: 'x' }], { dateRange: { from: '-14d' }, options: { hideWeekends: true } }));
    expect(r.weekendsHidden).toBe(true);
    expect(r.buckets.some(isWeekend)).toBe(false);
    expect(r.buckets.length).toBeLessThan(all.buckets.length);
    expect(r.series[0].total).toBe(r.series[0].data.reduce((a, b) => a + b, 0));
    // Por semana no aplica.
    const weekly = await runTrends(p, query([{ event: 'x' }], { interval: 'week', options: { hideWeekends: true } }));
    expect(weekly.weekendsHidden).toBe(false);
  });

  it('marks the last bucket incomplete only if it is still running, and options travel with the result', async () => {
    const p = await setup();
    await ingest(p, [{ event: 'x', who: 'a', at: NOW - 1000 }]);
    const r = await runTrends(p, query([{ event: 'x' }], { options: { unit: 'percentage', goalLines: [{ value: 5 }] } }));
    expect(r.lastIncomplete).toBe(true);
    expect(r.options?.unit).toBe('percentage');
    const past = await runTrends(p, query([{ event: 'x' }], { dateRange: { from: '2020-01-01', to: '2020-01-03' } }));
    expect(past.lastIncomplete).toBe(false);
  });

  it('breakdowns: two properties, a group property, ranges, cohorts and the limit', async () => {
    const p = await setup();
    await ingest(p, [
      { event: 'x', who: 'a', at: NOW - 1000, props: { $browser: 'Chrome', $os: 'Mac', amount: 5, $groups: { company: 'acme' } } },
      { event: 'x', who: 'b', at: NOW - 1000, props: { $browser: 'Chrome', $os: 'Win', amount: 15 } },
      { event: 'x', who: 'c', at: NOW - 1000, props: { $browser: 'Safari', amount: 95 } },
      { event: '$groupidentify', who: 'a', at: NOW - 1000, props: { $group_type: 'company', $group_key: 'acme', $group_set: { tier: 'gold' } } },
    ]);
    const by = (r: { series: Array<{ breakdownValue: string | null; total: number }> }) => Object.fromEntries(r.series.map((s) => [s.breakdownValue, s.total]));
    const two = await runTrends(p, query([{ event: 'x' }], { breakdown: { key: '$browser' }, breakdownsMore: [{ key: '$os' }] }));
    expect(by(two)).toEqual({ 'Chrome / Mac': 1, 'Chrome / Win': 1, 'Safari / (none)': 1 });
    const group = await runTrends(p, query([{ event: 'x' }], { breakdown: { key: 'tier', type: 'group', groupType: 'company' } }));
    expect(by(group)).toEqual({ gold: 1, '(none)': 2 });
    const bins = await runTrends(p, query([{ event: 'x' }], { breakdown: { key: 'amount', bins: 3 } }));
    expect(by(bins)).toEqual({ '5 to 35': 2, '65 to 95': 1 });
    const limited = await runTrends(p, query([{ event: 'x' }], { breakdown: { key: 'amount' }, breakdownLimit: 2 }));
    expect(limited.series.map((s) => s.breakdownValue)).toContain('$other');
    const more = await runTrends(p, query([{ event: 'x' }], { breakdown: { key: 'amount' }, breakdownLimit: 3 }));
    expect(more.series.map((s) => s.breakdownValue)).not.toContain('$other');
    await expect(runTrends(p, query([{ event: 'x' }], { breakdown: { key: 'tier', type: 'group' } }))).rejects.toThrow('group_type_required');
    await expect(runTrends(p, query([{ event: 'x' }], { breakdownCohorts: ['nope'] }))).rejects.toThrow('cohort_not_found');
  });

  it('breakdown by cohorts counts each cohort with its name', async () => {
    const p = await setup();
    await ingest(p, [
      { event: 'x', who: 'a', at: NOW - 1000 },
      { event: 'x', who: 'b', at: NOW - 1000 },
    ]);
    const cohort = await createCohort(p.id, 'u', { name: 'Only a', definition: cohortDefinitionSchema.parse({ type: 'static', properties: [], behavior: null, groups: [] }) });
    await addCohortMembers(p.id, cohort.id, ['a']);
    const r = await runTrends(p, query([{ event: 'x' }], { breakdownCohorts: [cohort.id] }));
    expect(r.series.map((s) => [s.breakdownValue, s.total])).toEqual([['Only a', 1]]);
  });

  it('a saved insight from before still parses', () => {
    const q = trendsQuerySchema.parse({ kind: 'trends', series: [{ event: 'x', math: 'unique' }] });
    expect(q.options).toBeUndefined();
    expect(q.display).toBe('line');
  });
});
