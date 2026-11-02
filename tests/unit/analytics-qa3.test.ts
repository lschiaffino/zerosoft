import { afterAll, describe, expect, it } from 'vitest';
import { nanoid } from 'nanoid';
import { getDb, upsertUser } from '@/lib/db';
import { handleCapture } from '@/lib/analytics/ingest-http';
import { parseIngestBody } from '@/lib/analytics/ingest-core';
import { storeEvents } from '@/lib/analytics/ingest';
import { createProject, getProject, type ProjectRow } from '@/lib/analytics/projects';
import { runTrends } from '@/lib/analytics/query';
import { createDashboard, createInsight, updateDashboard } from '@/lib/analytics/records';
import { createShare, hasActiveShare } from '@/lib/analytics/records-more';
import { funnelQuerySchema, shareableQuery, trendsQuerySchema } from '@/lib/analytics/types';

const DAY = 86_400_000;
const created: string[] = [];
afterAll(async () => {
  for (const id of created) {
    await getDb().prepare('DELETE FROM analytics_events WHERE project_id = ?').run(id);
    await getDb().prepare('DELETE FROM analytics_projects WHERE id = ?').run(id);
  }
});
async function setup(): Promise<{ project: ProjectRow; userId: string }> {
  const user = await upsertUser({ email: `an-qa3-${nanoid(8)}@test.dev` });
  const project = await createProject(user.id, user.id, 'Q');
  created.push(project.id);
  return { project, userId: user.id };
}
async function ingest(project: ProjectRow, events: Array<{ event: string; who: string; at: number; props?: Record<string, unknown> }>) {
  const parsed = parseIngestBody(JSON.stringify({ api_key: project.public_key, batch: events.map((e) => ({ event: e.event, distinct_id: e.who, timestamp: new Date(e.at).toISOString(), properties: e.props ?? {} })) }));
  if (!parsed.ok) throw new Error(parsed.error);
  await storeEvents((await getProject(project.workspace_id, project.id))!, parsed.events, null);
}

/** Mediodía UTC del último sábado y del lunes anterior a él. */
function lastSaturday(): { sat: number; mon: number; prevSat: number; prevMon: number } {
  const d = new Date();
  d.setUTCHours(12, 0, 0, 0);
  while (d.getUTCDay() !== 6) d.setTime(d.getTime() - DAY);
  const sat = d.getTime();
  return { sat, mon: sat - 5 * DAY, prevSat: sat - 7 * DAY, prevMon: sat - 12 * DAY };
}

describe('hide weekends', () => {
  const day = (ms: number) => new Date(ms).toISOString().slice(0, 10);
  const q = (math: string, t: ReturnType<typeof lastSaturday>, extra: Record<string, unknown> = {}) =>
    trendsQuerySchema.parse({ kind: 'trends', series: [{ event: 'x', math, ...(math === 'sum' ? { mathProperty: 'v' } : {}) }], dateRange: { from: day(t.mon), to: day(t.sat + DAY) }, compare: true, options: { hideWeekends: true }, ...extra });

  it('totals and comparison leave out Saturdays and Sundays, for every math', async () => {
    const { project } = await setup();
    const t = lastSaturday();
    await ingest(project, [
      { event: 'x', who: 'weekday', at: t.mon, props: { v: 1 } },
      { event: 'x', who: 'weekend-only', at: t.sat, props: { v: 100 } },
      { event: 'x', who: 'weekend-only', at: t.sat + 1, props: { v: 100 } },
      // La semana anterior: uno en lunes y 9 en sábado.
      { event: 'x', who: 'prev', at: t.prevMon, props: { v: 2 } },
      ...Array.from({ length: 9 }, (_, i) => ({ event: 'x', who: `prev-sat-${i}`, at: t.prevSat + i, props: { v: 50 } })),
    ]);
    const total = await runTrends(project, q('total', t));
    expect(total.series[0].total).toBe(1);
    expect(total.series[0].compareTotal).toBe(1);
    const unique = await runTrends(project, q('unique', t));
    expect(unique.series[0].total).toBe(1);
    expect(unique.series[0].compareTotal).toBe(1);
    const sum = await runTrends(project, q('sum', t));
    expect(sum.series[0].total).toBe(1);
    expect(sum.series[0].compareTotal).toBe(2);
    const perUser = await runTrends(project, q('per_user_max', t));
    expect(perUser.series[0].total).toBe(1);
    expect(unique.buckets.some((b) => [0, 6].includes(new Date(`${b}T00:00:00Z`).getUTCDay()))).toBe(false);
  });

  it('a formula uses the totals without weekends', async () => {
    const { project } = await setup();
    const t = lastSaturday();
    await ingest(project, [
      { event: 'x', who: 'a', at: t.mon },
      { event: 'x', who: 'a', at: t.sat },
    ]);
    const r = await runTrends(project, q('total', t, { compare: false, formula: 'A * 10' }));
    expect(r.series[0].total).toBe(10);
  });

  it('active people keep the weekend in their window and report the last day shown', async () => {
    const { project } = await setup();
    const t = lastSaturday();
    await ingest(project, [
      { event: 'x', who: 'fri', at: t.sat - DAY },
      { event: 'x', who: 'sat', at: t.sat },
    ]);
    const r = await runTrends(project, q('wau', t, { compare: false }));
    // El último día que se ve es el viernes: 'sat' todavía no pasó.
    expect(r.series[0].data[r.series[0].data.length - 1]).toBe(1);
    expect(r.series[0].total).toBe(1);
  });

  it('smoothing averages real days, weekends included', async () => {
    const { project } = await setup();
    const t = lastSaturday();
    await ingest(project, Array.from({ length: 7 }, (_, i) => ({ event: 'x', who: 'a', at: t.sat - i * DAY })));
    const r = await runTrends(project, q('total', t, { compare: false, options: { hideWeekends: true, smoothing: 7 } }));
    expect(r.series[0].data[r.series[0].data.length - 1]).toBeGreaterThan(0);
  });
});

describe('active public links', () => {
  it('an insight counts directly and through a shared board; revoked or unshared does not', async () => {
    const { project, userId } = await setup();
    const q = trendsQuerySchema.parse({ kind: 'trends', series: [{ event: 'x' }] });
    const a = await createInsight(project.id, userId, { name: 'A', query: q });
    const b = await createInsight(project.id, userId, { name: 'B', query: q });
    const c = await createInsight(project.id, userId, { name: 'C', query: q });
    const board = await createDashboard(project.id, userId, { name: 'B' });
    const other = await createDashboard(project.id, userId, { name: 'O' });
    await updateDashboard(project.id, board.id, { insightIds: [b.id] });
    await updateDashboard(project.id, other.id, { insightIds: [c.id] });
    await createShare(project.id, userId, { insightId: a.id });
    await createShare(project.id, userId, { dashboardId: board.id });
    expect(await hasActiveShare(project.id, { insightId: a.id })).toBe(true);
    expect(await hasActiveShare(project.id, { insightId: b.id })).toBe(true);
    expect(await hasActiveShare(project.id, { dashboardId: board.id })).toBe(true);
    expect(await hasActiveShare(project.id, { insightId: c.id })).toBe(false);
    expect(await hasActiveShare(project.id, { dashboardId: other.id })).toBe(false);
  });
});

describe('what can go public', () => {
  const trend = (key: string, type = 'event') => trendsQuerySchema.parse({ kind: 'trends', series: [{ event: 'x' }], breakdown: { key, type } });
  it('only breakdowns from the safe list', () => {
    for (const key of ['email', 'user_id', 'customer', 'distinct_id', 'name', 'phone', 'plan']) expect(shareableQuery(trend(key)), key).toBe(false);
    for (const key of ['$browser', '$os', '$geoip_country_code', '$pathname', 'utm_source']) expect(shareableQuery(trend(key)), key).toBe(true);
    expect(shareableQuery(trend('$browser', 'person'))).toBe(false);
    expect(shareableQuery(funnelQuerySchema.parse({ kind: 'funnel', steps: [{ event: 'a' }, { event: 'b' }], breakdown: { key: 'email', type: 'event' } }))).toBe(false);
  });
});

describe('ingest', () => {
  const capture = (key: string, headers: Record<string, string>, distinct = 'a', properties: Record<string, unknown> = {}) =>
    handleCapture(
      new Request('http://x/api/ingest/e', {
        method: 'POST',
        headers: { 'user-agent': 'Mozilla/5.0 Chrome/130.0 Safari/537.36', origin: 'http://shop.test', ...headers },
        body: JSON.stringify({ api_key: key, event: '$pageview', distinct_id: distinct, properties }),
      }),
    );

  it('a country sent by the browser does not win over the server', async () => {
    const { project } = await setup();
    await capture(project.public_key, { 'x-forwarded-for': '203.0.113.7' }, 'a', { $geoip_country_code: 'ZZ' });
    const row = (await getDb().prepare('SELECT country FROM analytics_events WHERE project_id = ?').get(project.id)) as { country: string | null };
    expect(row.country).not.toBe('ZZ');
  });

  it('the rate limit table never holds the IP', async () => {
    const { project } = await setup();
    const prev = process.env.RATE_LIMIT_DISABLED;
    delete process.env.RATE_LIMIT_DISABLED;
    try {
      await capture(project.public_key, { 'x-forwarded-for': '198.51.100.23' });
    } finally {
      if (prev !== undefined) process.env.RATE_LIMIT_DISABLED = prev;
    }
    const keys = (await getDb().prepare('SELECT key FROM rate_limits WHERE key LIKE ?').all(`aingest:${project.id}%`)) as Array<{ key: string }>;
    expect(keys.length).toBe(2);
    expect(keys.some((k) => k.key.includes('198.51.100.23'))).toBe(false);
  });

  it('cookieless events with the setting off are dropped and counted for the owner', async () => {
    const { project } = await setup();
    await capture(project.public_key, { 'x-forwarded-for': '203.0.113.7' }, '$zs_cookieless');
    const row = (await getDb().prepare('SELECT cookieless_dropped AS n FROM analytics_projects WHERE id = ?').get(project.id)) as { n: number };
    expect(Number(row.n)).toBe(1);
    const n = (await getDb().prepare('SELECT count(*) AS n FROM analytics_events WHERE project_id = ?').get(project.id)) as { n: number };
    expect(Number(n.n)).toBe(0);
  });
});
