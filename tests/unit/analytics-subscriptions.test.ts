import { afterAll, describe, expect, it, vi } from 'vitest';
import { nanoid } from 'nanoid';
import { getDb, upsertUser } from '@/lib/db';
import { parseIngestBody } from '@/lib/analytics/ingest-core';
import { storeEvents } from '@/lib/analytics/ingest';
import { createProject, getProject, type ProjectRow } from '@/lib/analytics/projects';
import { createDashboard, createInsight, updateDashboard } from '@/lib/analytics/records';
import { nextDelivery, summarize, type SubscriptionSchedule } from '@/lib/analytics/subscriptions-core';
import { insightQuerySchema } from '@/lib/analytics/types';

const sent: Array<{ to: string; subject: string; text: string; html: string }> = [];
vi.mock('@/lib/email', async (orig) => {
  const real = (await orig()) as Record<string, unknown>;
  return {
    ...real,
    sendEmail: async (o: { to: string; subject: string; text: string; html: string }) => {
      if (o.to.startsWith('fail')) return { ok: false, error: 'x' };
      sent.push(o);
      return { ok: true };
    },
  };
});
const { buildReport, createSubscription, deliverSubscription, getSubscription, parseUnsubscribeToken, runSubscriptionsCron, unsubscribe, unsubscribeToken, updateSubscription } = await import('@/lib/analytics/subscriptions');

const at = (s: string) => Date.parse(s);
const sch = (p: Partial<SubscriptionSchedule>): SubscriptionSchedule => ({ frequency: 'daily', interval: 1, hour: 9, ...p });

describe('next delivery', () => {
  const anchor = at('2030-01-07T00:00:00Z'); // lunes
  it('daily: today if the time has not passed, tomorrow if it has, every N days from the start', () => {
    expect(iso2(nextDelivery(sch({}), at('2030-01-07T08:00:00Z'), anchor))).toBe('2030-01-07T09');
    expect(iso2(nextDelivery(sch({}), at('2030-01-07T09:00:00Z'), anchor))).toBe('2030-01-08T09');
    expect(iso2(nextDelivery(sch({ interval: 3 }), at('2030-01-07T10:00:00Z'), anchor))).toBe('2030-01-10T09');
  });
  it('weekly on chosen days and every two weeks', () => {
    expect(iso2(nextDelivery(sch({ frequency: 'weekly', weekdays: [3, 5] }), at('2030-01-07T10:00:00Z'), anchor))).toBe('2030-01-09T09');
    expect(iso2(nextDelivery(sch({ frequency: 'weekly', weekdays: [1], interval: 2 }), at('2030-01-07T10:00:00Z'), anchor))).toBe('2030-01-21T09');
  });
  it('monthly: a date, a date the month does not have, and positions', () => {
    expect(iso2(nextDelivery(sch({ frequency: 'monthly', monthDay: 15 }), at('2030-01-20T10:00:00Z'), anchor))).toBe('2030-02-15T09');
    expect(iso2(nextDelivery(sch({ frequency: 'monthly', monthDay: 31 }), at('2030-02-01T10:00:00Z'), anchor))).toBe('2030-02-28T09');
    // Último viernes de enero de 2030: 25.
    expect(iso2(nextDelivery(sch({ frequency: 'monthly', ordinal: -1, ordinalDay: 'fri' }), at('2030-01-08T10:00:00Z'), anchor))).toBe('2030-01-25T09');
    // Segundo lunes de febrero: 11.
    expect(iso2(nextDelivery(sch({ frequency: 'monthly', ordinal: 2, ordinalDay: 'mon' }), at('2030-01-20T10:00:00Z'), anchor))).toBe('2030-02-11T09');
    // Primer día de semana de junio de 2030 (el 1 es sábado): lunes 3.
    expect(iso2(nextDelivery(sch({ frequency: 'monthly', ordinal: 1, ordinalDay: 'weekday' }), at('2030-05-20T10:00:00Z'), anchor))).toBe('2030-06-03T09');
    expect(iso2(nextDelivery(sch({ frequency: 'monthly', monthDay: 1, interval: 3 }), at('2030-01-02T10:00:00Z'), anchor))).toBe('2030-04-01T09');
  });
  it('uses the time zone of the project', () => {
    // 9:00 en Buenos Aires son las 12:00 UTC.
    expect(iso2(nextDelivery(sch({}), at('2030-01-07T10:00:00Z'), anchor, 'America/Argentina/Buenos_Aires'))).toBe('2030-01-07T12');
  });
  function iso2(ms: number) {
    return new Date(ms).toISOString().slice(0, 13);
  }
});

describe('summary', () => {
  it('says the numbers without ids', () => {
    expect(summarize({ kind: 'funnel', steps: [{ label: 'a', event: 'a', count: 4, conversion: 1, stepConversion: 1, dropped: 2, medianMs: null }, { label: 'b', event: 'b', count: 2, conversion: 0.5, stepConversion: 0.5, dropped: 0, medianMs: 10 }], droppedPersons: [['secret-person']], truncated: false })).toEqual({
      head: ['Step', 'Count', 'Conversion'],
      rows: [['a', '4', '100%'], ['b', '2', '50%']],
    });
  });
});

describe('subscriptions on stored data', () => {
  const created: string[] = [];
  afterAll(async () => {
    for (const id of created) {
      await getDb().prepare('DELETE FROM analytics_subscriptions WHERE project_id = ?').run(id);
      await getDb().prepare('DELETE FROM analytics_events WHERE project_id = ?').run(id);
      await getDb().prepare('DELETE FROM analytics_projects WHERE id = ?').run(id);
    }
  });
  async function setup(): Promise<{ project: ProjectRow; userId: string }> {
    const user = await upsertUser({ email: `an-sub-${nanoid(8)}@test.dev` });
    const project = await createProject(user.id, user.id, 'S');
    created.push(project.id);
    const parsed = parseIngestBody(JSON.stringify({ api_key: project.public_key, batch: [{ event: 'x', distinct_id: 'a', properties: {} }] }));
    if (!parsed.ok) throw new Error(parsed.error);
    await storeEvents((await getProject(project.workspace_id, project.id))!, parsed.events, null);
    return { project, userId: user.id };
  }
  const trend = (extra = {}) => insightQuerySchema.parse({ kind: 'trends', series: [{ event: 'x' }], dateRange: { from: '-1d' }, ...extra });
  const schedule = sch({});

  it('creating notifies the recipients once; the cron delivers once and moves to the next date', async () => {
    const { project, userId } = await setup();
    const insight = await createInsight(project.id, userId, { name: 'Sales', query: trend() });
    sent.length = 0;
    const s = await createSubscription(project, userId, { name: 'Weekly sales', insightId: insight.id, recipients: ['Ana@acme.com', 'ana@acme.com', 'bob@other.org'], message: 'Hola', schedule });
    expect(s?.recipients).toEqual(['ana@acme.com', 'bob@other.org']);
    expect(sent.map((m) => m.to)).toEqual(['ana@acme.com', 'bob@other.org']);
    expect(sent[0].text).toContain('Hola');
    expect(sent[0].text).toContain('/stats/unsubscribe?t=');

    sent.length = 0;
    const due = s!.nextAt! + 1000;
    const a = await runSubscriptionsCron({ now: due });
    expect(a.sent).toBeGreaterThanOrEqual(1);
    const mine = sent.filter((m) => m.subject === 'Weekly sales');
    expect(mine.map((m) => m.to)).toEqual(['ana@acme.com', 'bob@other.org']);
    expect(mine[0].text).toContain('Sales');
    expect(mine[0].text).toContain('x | 1');
    expect(mine[0].html).toContain('<table');
    const after = await getSubscription(project.id, s!.id);
    expect(after?.nextAt).toBeGreaterThan(due);
    expect(after?.lastSentAt).toBe(due);

    // Otra corrida al mismo tiempo no vuelve a mandar.
    sent.length = 0;
    await runSubscriptionsCron({ now: due });
    expect(sent.filter((m) => m.subject === 'Weekly sales')).toEqual([]);
  });

  it('a claimed row is not sent by a second run, and a disabled one never', async () => {
    const { project, userId } = await setup();
    const insight = await createInsight(project.id, userId, { name: 'I', query: trend() });
    const s = (await createSubscription(project, userId, { name: 'Claimed', insightId: insight.id, recipients: ['c@acme.com'], schedule }))!;
    const due = s.nextAt! + 1000;
    await getDb().prepare('UPDATE analytics_subscriptions SET claimed_at = ? WHERE id = ?').run(due - 1000, s.id);
    sent.length = 0;
    await runSubscriptionsCron({ now: due });
    expect(sent.filter((m) => m.subject === 'Claimed')).toEqual([]);
    await getDb().prepare('UPDATE analytics_subscriptions SET claimed_at = NULL WHERE id = ?').run(s.id);
    await updateSubscription(project, s.id, { enabled: false });
    await runSubscriptionsCron({ now: due });
    expect(sent.filter((m) => m.subject === 'Claimed')).toEqual([]);
    expect((await getSubscription(project.id, s.id))?.nextAt).toBeNull();
  });

  it('a failed send is recorded and retried at the next date', async () => {
    const { project, userId } = await setup();
    const insight = await createInsight(project.id, userId, { name: 'I', query: trend() });
    const s = (await createSubscription(project, userId, { name: 'F', insightId: insight.id, recipients: ['fail@acme.com'], schedule }))!;
    const r = await runSubscriptionsCron({ now: s.nextAt! + 1000 });
    expect(r.failed).toBeGreaterThanOrEqual(1);
    const after = await getSubscription(project.id, s.id);
    expect(after?.lastError).toBe('send_failed');
    expect(after?.lastSentAt).toBeNull();
    expect(after?.nextAt).toBeGreaterThan(s.nextAt!);
  });

  it('a dashboard: up to 20 in its order, with its filters; what cannot go public stays out', async () => {
    const { project, userId } = await setup();
    const ok = await createInsight(project.id, userId, { name: 'Open one', query: trend() });
    const person = await createInsight(project.id, userId, { name: 'By email', query: trend({ breakdown: { key: 'email', type: 'event' } }) });
    const sql = await createInsight(project.id, userId, { name: 'Raw', query: insightQuerySchema.parse({ kind: 'sql', sql: 'SELECT 1' }) });
    const d = await createDashboard(project.id, userId, { name: 'B' });
    await updateDashboard(project.id, d.id, { insightIds: [sql.id, person.id, ok.id] });
    const s = (await createSubscription(project, userId, { name: 'Board', dashboardId: d.id, recipients: ['d@acme.com'], schedule }))!;
    expect(s.insightIds).toEqual([sql.id, person.id, ok.id]);
    const body = await buildReport(project, s, 'en');
    const text = body.text.join('\n');
    expect(text).toContain('Open one');
    expect(text).toContain('only visible inside the app');
    expect(text).not.toContain('SELECT');
    const picked = (await updateSubscription(project, s.id, { insightIds: [ok.id] }))!;
    expect(picked.insightIds).toEqual([ok.id]);
  });

  it('a target from another project is refused', async () => {
    const { project, userId } = await setup();
    const { project: other, userId: otherUser } = await setup();
    const foreign = await createInsight(other.id, otherUser, { name: 'Other', query: trend() });
    expect(await createSubscription(project, userId, { name: 'N', insightId: foreign.id, recipients: ['x@acme.com'], schedule })).toBeNull();
  });

  it('unsubscribe: a good token removes that person, a tampered one nobody, and the last one turns it off', async () => {
    const { project, userId } = await setup();
    const insight = await createInsight(project.id, userId, { name: 'I', query: trend() });
    const s = (await createSubscription(project, userId, { name: 'U', insightId: insight.id, recipients: ['a@acme.com', 'b@acme.com'], schedule }))!;
    const token = unsubscribeToken(s.id, 'a@acme.com');
    expect(parseUnsubscribeToken(token)).toEqual({ id: s.id, email: 'a@acme.com' });
    const tampered = unsubscribeToken(s.id, 'a@acme.com').replace(Buffer.from('a@acme.com').toString('base64url'), Buffer.from('b@acme.com').toString('base64url'));
    expect(await unsubscribe(tampered)).toBe(false);
    expect((await getSubscription(project.id, s.id))?.recipients).toEqual(['a@acme.com', 'b@acme.com']);
    expect(await unsubscribe(token)).toBe(true);
    expect((await getSubscription(project.id, s.id))?.recipients).toEqual(['b@acme.com']);
    await unsubscribe(unsubscribeToken(s.id, 'b@acme.com'));
    const off = await getSubscription(project.id, s.id);
    expect(off?.enabled).toBe(false);
    expect(off?.nextAt).toBeNull();
  });

  it('sending by hand reaches everyone', async () => {
    const { project, userId } = await setup();
    const insight = await createInsight(project.id, userId, { name: 'I', query: trend() });
    const s = (await createSubscription(project, userId, { name: 'Now', insightId: insight.id, recipients: ['n@acme.com'], schedule }))!;
    sent.length = 0;
    expect(await deliverSubscription(project, s)).toBeNull();
    expect(sent.map((m) => m.to)).toEqual(['n@acme.com']);
  });
});
