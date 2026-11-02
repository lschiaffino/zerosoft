import { afterAll, describe, expect, it } from 'vitest';
import { nanoid } from 'nanoid';
import { getDb, upsertUser } from '@/lib/db';
import { decideFlagsFull, forgetFlagsCache } from '@/lib/analytics/flags';
import { createFlag } from '@/lib/analytics/records';
import { handleCapture } from '@/lib/analytics/ingest-http';
import { createProject, forgetProjectCache, updateProject, type ProjectRow } from '@/lib/analytics/projects';
import { runTrends, runWeb } from '@/lib/analytics/query';
import { trendsQuerySchema } from '@/lib/analytics/types';

/** Lo que estaba marcado como listo sin una prueba propia: acá con números. */
const created: string[] = [];
afterAll(async () => {
  for (const id of created) {
    await getDb().prepare('DELETE FROM analytics_events WHERE project_id = ?').run(id);
    await getDb().prepare('DELETE FROM analytics_projects WHERE id = ?').run(id);
  }
});
async function setup(): Promise<{ project: ProjectRow; userId: string }> {
  const user = await upsertUser({ email: `an-audit-${nanoid(8)}@test.dev` });
  const project = await createProject(user.id, user.id, 'A');
  created.push(project.id);
  return { project, userId: user.id };
}
const capture = (key: string, event: string, who: string, headers: Record<string, string>, properties: Record<string, unknown> = {}) =>
  handleCapture(
    new Request('http://x/api/ingest/e', {
      method: 'POST',
      headers: { 'user-agent': 'Mozilla/5.0 Chrome/130.0 Safari/537.36', origin: 'http://shop.test', ...headers },
      body: JSON.stringify({ api_key: key, event, distinct_id: who, properties }),
    }),
  );

describe('country and IP', () => {
  const stored = async (projectId: string) => (await getDb().prepare('SELECT ip, country FROM analytics_events WHERE project_id = ?').get(projectId)) as { ip: string | null; country: string | null };

  it('the last part of the IP is dropped by default, and the country comes through', async () => {
    const { project } = await setup();
    // El header de país solo se cree en Vercel, que es quien lo pone.
    process.env.VERCEL = '1';
    const res = await capture(project.public_key, '$pageview', 'a', { 'x-forwarded-for': '203.0.113.77', 'x-vercel-ip-country': 'AR' }).finally(() => {
      delete process.env.VERCEL;
    });
    expect(res.status).toBe(200);
    const row = await stored(project.id);
    expect(row.ip).toBe('203.0.113.0');
    expect(row.country).toBe('AR');
    // Y la apertura por país cuenta con eso.
    const r = await runTrends(project, trendsQuerySchema.parse({ kind: 'trends', series: [{ event: '$pageview' }], dateRange: { from: '-1d' }, breakdown: { key: '$geoip_country_code', type: 'event' } }));
    expect(r.series.map((s) => s.breakdownValue)).toEqual(['AR']);
  });

  it('outside Vercel a country header from the client is not believed', async () => {
    const { project } = await setup();
    await capture(project.public_key, '$pageview', 'a', { 'x-forwarded-for': '203.0.113.77', 'x-vercel-ip-country': 'AR' });
    expect((await stored(project.id)).country).not.toBe('AR');
  });

  it('turned off, the IP stays whole', async () => {
    const { project } = await setup();
    await updateProject(project.workspace_id, project.id, { anonymizeIp: false });
    forgetProjectCache();
    await capture(project.public_key, '$pageview', 'a', { 'x-forwarded-for': '203.0.113.77' });
    expect((await stored(project.id)).ip).toBe('203.0.113.77');
  });
});

describe('web overview', () => {
  it('bounce rate: sessions with one pageview over all sessions', async () => {
    const { project } = await setup();
    const h = { 'x-forwarded-for': '203.0.113.1' };
    await capture(project.public_key, '$pageview', 'a', h, { $session_id: 's1', $pathname: '/' });
    await capture(project.public_key, '$pageview', 'b', h, { $session_id: 's2', $pathname: '/' });
    await capture(project.public_key, '$pageview', 'b', h, { $session_id: 's2', $pathname: '/two' });
    const web = await runWeb(project, { kind: 'web', dateRange: { from: '-1d' }, compare: false });
    expect(web.stats.sessions.value).toBe(2);
    expect(web.stats.pageviews.value).toBe(3);
    expect(web.stats.bounceRate.value).toBe(0.5);
  });
});

describe('where a visit came from', () => {
  it('counts the source once per session: moving inside the site adds nothing', async () => {
    const { project } = await setup();
    const h = { 'x-forwarded-for': '203.0.113.1' };
    const first = { $session_id: 's1', $pathname: '/landing', $current_url: 'https://shop.test/landing?utm_source=news&utm_medium=email', $referrer: 'https://news.example.com/post', utm_source: 'news', utm_medium: 'email' };
    await capture(project.public_key, '$pageview', 'a', h, first);
    await new Promise((r) => setTimeout(r, 5));
    await capture(project.public_key, '$pageview', 'a', h, { $session_id: 's1', $pathname: '/two', $current_url: 'https://shop.test/two', $referrer: 'https://shop.test/landing' });
    const web = await runWeb(project, { kind: 'web', dateRange: { from: '-1d' }, compare: false });
    expect(web.referrers).toEqual([{ key: 'news.example.com', visitors: 1, views: 2 }]);
    expect(web.channels.map((c) => [c.key, c.visitors, c.views])).toEqual([['email', 1, 2]]);
    expect(web.utmSources.map((c) => c.key)).toEqual(['news']);
    expect(web.pages.map((c) => c.key).sort()).toEqual(['/landing', '/two']);
  });
});

describe('flag payloads', () => {
  it('each variant has its own payload and decide returns the one that was assigned', async () => {
    const { project } = await setup();
    const flag = await createFlag(project.id, 'u', {
      key: 'exp',
      name: '',
      active: true,
      rollout: 100,
      variants: [
        { key: 'a', rollout: 50 },
        { key: 'b', rollout: 50 },
      ],
      conditions: [],
      groups: [],
      payloads: { a: JSON.stringify({ color: 'red' }), b: JSON.stringify({ color: 'blue' }) },
    } as never);
    expect(typeof flag).toBe('object');
    forgetFlagsCache(project.id);
    const seen = new Map<string, unknown>();
    for (let i = 0; i < 40 && seen.size < 2; i++) {
      const r = await decideFlagsFull(project.id, `u${i}`);
      seen.set(String(r.flags.exp), r.payloads.exp);
    }
    expect(seen.get('a')).toEqual({ color: 'red' });
    expect(seen.get('b')).toEqual({ color: 'blue' });
  });
});
