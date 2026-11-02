import { afterAll, describe, expect, it } from 'vitest';
import { nanoid } from 'nanoid';
import { getDb, upsertUser } from '@/lib/db';
import { computeRetention, periodLabel, periodOf, periodStartLocal, retentionCellPeople, retentionMean, retentionRate } from '@/lib/analytics/compute';
import { parseIngestBody } from '@/lib/analytics/ingest-core';
import { storeEvents } from '@/lib/analytics/ingest';
import { createProject, getProject, type ProjectRow } from '@/lib/analytics/projects';
import { runRetention } from '@/lib/analytics/query';
import { publicResult } from '@/lib/analytics/share-view';
import { retentionQuerySchema, shareableQuery } from '@/lib/analytics/types';

const DAY = 86_400_000;
const ev = (person: string, period: number) => ({ person, period });

describe('retention core', () => {
  it('first time: one cohort per person; recurring: every period they start', () => {
    const starts = [ev('a', 10), ev('a', 11), ev('b', 11)];
    expect(computeRetention(starts, starts, 10, 3).map((c) => c.size)).toEqual([1, 1, 0]);
    expect(computeRetention(starts, starts, 10, 3, { recurring: true }).map((c) => c.size)).toEqual([1, 2, 0]);
  });

  it('on or after counts a later return in the earlier periods too', () => {
    const starts = [ev('a', 10)];
    const back = [ev('a', 12)];
    expect(computeRetention(starts, back, 10, 3)[0].values).toEqual([1, 0, 1]);
    expect(computeRetention(starts, back, 10, 3, { cumulative: true })[0].values).toEqual([1, 1, 1]);
  });

  it('the example from the docs: on or after adds both days', () => {
    const starts = Array.from({ length: 200 }, (_, i) => ev(`p${i}`, 0));
    const back = [...Array.from({ length: 80 }, (_, i) => ev(`p${i}`, 2)), ...Array.from({ length: 40 }, (_, i) => ev(`p${100 + i}`, 3))];
    const on = computeRetention(starts, back, 0, 4)[0];
    expect(retentionRate(on.values, on.size, 3)).toBe(0.2);
    expect(retentionRate(on.values, on.size, 3, 'previous')).toBe(0.5);
    const after = computeRetention(starts, back, 0, 4, { cumulative: true })[0];
    expect(retentionRate(after.values, after.size, 2)).toBe(0.6);
  });

  it('mean: the example from the docs', () => {
    const a = { size: 100, values: [100, 50] };
    const b = { size: 300, values: [300, 30] };
    expect(retentionMean([a, b], 2, 'period0', 'simple')[1]).toBeCloseTo(0.3);
    expect(retentionMean([a, b], 2, 'period0', 'weighted')[1]).toBeCloseTo(0.2);
    // Una cohorte joven no tiene ese período y no cuenta para el promedio.
    expect(retentionMean([a, { size: 10, values: [10] }], 2)[1]).toBe(0.5);
    expect(retentionMean([], 2)[0]).toBeNull();
  });

  it('no division by zero with an empty previous period', () => {
    expect(retentionRate([5, 0, 3], 5, 2, 'previous')).toBeNull();
    expect(retentionRate([0], 0, 0)).toBeNull();
    expect(retentionRate([1], 1, 3)).toBeNull();
  });

  it('the cell lists exactly who is counted there', () => {
    const starts = [ev('a', 10), ev('b', 10), ev('c', 11)];
    const back = [ev('a', 11), ev('c', 12)];
    expect(retentionCellPeople(starts, back, 10, 3, {}, 0, 0).sort()).toEqual(['a', 'b']);
    expect(retentionCellPeople(starts, back, 10, 3, {}, 0, 1)).toEqual(['a']);
    expect(retentionCellPeople(starts, back, 10, 3, {}, 1, 1)).toEqual(['c']);
  });

  it('periods round trip, across a year boundary and in a time zone', () => {
    const ts = Date.UTC(2030, 0, 15, 12, 30);
    for (const p of ['hour', 'day', 'week', 'month'] as const) {
      const n = periodOf(ts, p);
      expect(periodStartLocal(n, p)).toBeLessThanOrEqual(ts);
      expect(periodOf(periodStartLocal(n, p), p)).toBe(n);
      expect(periodOf(periodStartLocal(n + 1, p), p)).toBe(n + 1);
    }
    expect(periodLabel(periodOf(ts, 'month'), 'month')).toBe('2030-01-01');
    expect(periodLabel(periodOf(ts, 'hour'), 'hour')).toBe('2030-01-15 12:00');
    expect(periodOf(Date.UTC(2030, 0, 1, 1), 'month', 'America/Argentina/Buenos_Aires')).toBe(periodOf(Date.UTC(2029, 11, 15), 'month'));
    expect(periodOf(Date.UTC(2030, 0, 1, 1), 'month')).toBe(2030 * 12);
  });
});

describe('retention on stored events', () => {
  const created: string[] = [];
  const NOW = Date.now();
  afterAll(async () => {
    for (const id of created) {
      await getDb().prepare('DELETE FROM analytics_events WHERE project_id = ?').run(id);
      await getDb().prepare('DELETE FROM analytics_projects WHERE id = ?').run(id);
    }
  });
  async function setup(): Promise<ProjectRow> {
    const user = await upsertUser({ email: `an-ret-${nanoid(8)}@test.dev` });
    const project = await createProject(user.id, user.id, 'R');
    created.push(project.id);
    return project;
  }
  async function ingest(project: ProjectRow, events: Array<{ event: string; who: string; at: number; props?: Record<string, unknown> }>) {
    const parsed = parseIngestBody(
      JSON.stringify({ api_key: project.public_key, batch: events.map((e) => ({ event: e.event, distinct_id: e.who, timestamp: new Date(e.at).toISOString(), properties: e.props ?? {} })) }),
    );
    if (!parsed.ok) throw new Error(parsed.error);
    await storeEvents((await getProject(project.workspace_id, project.id))!, parsed.events, null);
  }
  const query = (extra: Record<string, unknown>) => retentionQuerySchema.parse({ kind: 'retention', startEvent: 'x', returnEvent: 'x', period: 'day', periods: 5, ...extra });
  const sizes = (r: { cohorts: Array<{ size: number }> }) => r.cohorts.map((c) => c.size);

  it('types: recurring, first in range and first ever', async () => {
    const p = await setup();
    await ingest(p, [
      // old ya lo hacía antes del rango.
      { event: 'x', who: 'old', at: NOW - 20 * DAY },
      { event: 'x', who: 'old', at: NOW - 3 * DAY },
      { event: 'x', who: 'new', at: NOW - 3 * DAY },
      { event: 'x', who: 'new', at: NOW - 2 * DAY },
    ]);
    // Primera vez en el rango: los dos entran hace tres días.
    expect(sizes(await runRetention(p, query({}))).reduce((a, b) => a + b, 0)).toBe(2);
    expect(sizes(await runRetention(p, query({ type: 'first_time' }))).reduce((a, b) => a + b, 0)).toBe(2);
    // Recurrente: new entra en dos cohortes.
    expect(sizes(await runRetention(p, query({ type: 'recurring' }))).reduce((a, b) => a + b, 0)).toBe(3);
    // Primera de todas: old queda afuera.
    const ever = await runRetention(p, query({ type: 'first_ever' }));
    expect(sizes(ever).reduce((a, b) => a + b, 0)).toBe(1);
    const c = ever.cohorts.find((x) => x.size === 1)!;
    expect(c.values[1]).toBe(1);
  });

  it('hours and months run on the database with the same numbers as the code', async () => {
    const p = await setup();
    await ingest(p, [{ event: 'x', who: 'a', at: NOW - 1000 }]);
    const h = await runRetention(p, query({ period: 'hour', periods: 3 }));
    expect(h.cohorts[h.cohorts.length - 1].size).toBe(1);
    expect(h.cohorts[0].start).toMatch(/^\d{4}-\d{2}-\d{2} \d{2}:00$/);
    const m = await runRetention(p, query({ period: 'month', periods: 3 }));
    expect(m.cohorts[m.cohorts.length - 1].size).toBe(1);
    expect(m.cohorts[0].start).toMatch(/^\d{4}-\d{2}-01$/);
  });

  it('breakdown: a return only counts under the value it started with', async () => {
    const p = await setup();
    await ingest(p, [
      { event: 'x', who: 'a', at: NOW - 2 * DAY, props: { $browser: 'Chrome' } },
      { event: 'x', who: 'a', at: NOW - DAY, props: { $browser: 'Firefox' } },
      { event: 'x', who: 'b', at: NOW - 2 * DAY, props: { $browser: 'Chrome' } },
      { event: 'x', who: 'b', at: NOW - DAY, props: { $browser: 'Chrome' } },
    ]);
    const r = await runRetention(p, query({ breakdown: { key: '$browser', type: 'event' } }));
    const chrome = r.breakdown?.find((b) => b.value === 'Chrome')?.cohorts.find((c) => c.size === 2);
    expect(chrome?.values[1]).toBe(1);
    // Sin apertura, los dos vuelven.
    expect((await runRetention(p, query({}))).cohorts.find((c) => c.size === 2)?.values[1]).toBe(2);
  });

  it('counting groups and asking for the people in a cell', async () => {
    const p = await setup();
    const g = (c: string) => ({ $groups: { company: c } });
    await ingest(p, [
      { event: 'x', who: 'a', at: NOW - 2 * DAY, props: g('acme') },
      { event: 'x', who: 'b', at: NOW - 2 * DAY, props: g('acme') },
      { event: 'x', who: 'b', at: NOW - DAY, props: g('acme') },
      { event: 'x', who: 'c', at: NOW - 2 * DAY },
    ]);
    const r = await runRetention(p, query({ groupType: 'company' }));
    expect(r.unit).toBe('group');
    expect(sizes(r).reduce((a, b) => a + b, 0)).toBe(1);

    const plain = await runRetention(p, query({}));
    const idx = plain.cohorts.findIndex((c) => c.size === 3);
    const drill = await runRetention(p, query({ drill: { cohort: idx, k: 1 } }));
    expect(drill.drillPersons).toHaveLength(1);
    const pub = publicResult(drill);
    expect(pub.kind === 'retention' && pub.drillPersons).toBeUndefined();
  });

  it('old saved queries parse and a person breakdown does not go public', () => {
    const q = retentionQuerySchema.parse({ kind: 'retention' });
    expect(q.type).toBeUndefined();
    expect(shareableQuery(retentionQuerySchema.parse({ kind: 'retention', breakdown: { key: 'email', type: 'person' } }))).toBe(false);
  });
});
