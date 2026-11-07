import { afterAll, describe, expect, it, vi } from 'vitest';
import { nanoid } from 'nanoid';
import { getDb, upsertUser } from '@/lib/db';
import { parseIngestBody } from '@/lib/analytics/ingest-core';
import { storeEvents } from '@/lib/analytics/ingest';
import { createProject, getProject, type ProjectRow } from '@/lib/analytics/projects';
import { createDashboard, createInsight, updateDashboard } from '@/lib/analytics/records';
import { nextDelivery, summarize, type SubscriptionSchedule } from '@/lib/analytics/subscriptions-core';
import { insightQuerySchema } from '@/lib/analytics/types';

const sent: Array<{ to: string; subject: string; text: string; html: string; headers?: Record<string, string> }> = [];
vi.mock('@/lib/email', async (orig) => {
  const real = (await orig()) as Record<string, unknown>;
  return {
    ...real,
    sendEmail: async (o: { to: string; subject: string; text: string; html: string; headers?: Record<string, string> }) => {
      if (o.to.startsWith('fail')) return { ok: false, error: 'x' };
      sent.push(o);
      return { ok: true };
    },
  };
});
const { buildReport, confirmRecipient, confirmToken, createSubscription: createRaw, deliverSubscription, getSubscription, parseUnsubscribeToken, runSubscriptionsCron, unsubscribe, unsubscribeToken, updateSubscription: updateRaw } = await import('@/lib/analytics/subscriptions');

type Dto = Awaited<ReturnType<typeof getSubscription>>;
/** Crea y confirma: casi todas las pruebas hablan de lo que pasa después. */
async function createSubscription(...args: Parameters<typeof createRaw>): Promise<NonNullable<Dto> | null> {
  const s = await createRaw(...args);
  if (!s || s === 'email_limit') return null;
  for (const r of s.recipients) await confirmRecipient(confirmToken(s.id, r));
  return getSubscription(args[0].id, s.id);
}
async function updateSubscription(...args: Parameters<typeof updateRaw>): Promise<NonNullable<Dto> | null> {
  const s = await updateRaw(...args);
  return s === 'email_limit' ? null : s;
}

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

  it('outside recipients confirm first: the first email has nothing the sender wrote', async () => {
    const { project, userId } = await setup();
    const insight = await createInsight(project.id, userId, { name: 'I', query: trend() });
    sent.length = 0;
    const s = await createRaw(project, userId, { name: 'Win a prize at evil.example', insightId: insight.id, recipients: ['out@other.org'], message: 'Click https://evil.example', schedule });
    if (!s || s === 'email_limit') throw new Error('no se creó');
    expect(s.recipientState['out@other.org']).toBe('pending');
    expect(sent).toHaveLength(1);
    const first = JSON.stringify(sent[0]);
    expect(first).not.toContain('evil.example');
    expect(first).not.toContain('prize');
    expect(sent[0].text).toContain('confirm=');
    // Sin confirmar, ni el cron ni mandar ahora le llegan.
    sent.length = 0;
    await runSubscriptionsCron({ now: s.nextAt! + 1000 });
    expect(await deliverSubscription(project, s)).toBeNull();
    expect(sent.filter((m) => m.to === 'out@other.org')).toEqual([]);
    // Un token vencido o tocado no sirve.
    expect(await confirmRecipient(confirmToken(s.id, 'out@other.org', Date.now() - 30 * 86_400_000))).toBe(false);
    expect(await confirmRecipient(`${confirmToken(s.id, 'out@other.org')}x`)).toBe(false);
    expect(await confirmRecipient(confirmToken(s.id, 'nobody@other.org'))).toBe(false);
    expect(await confirmRecipient(confirmToken(s.id, 'out@other.org'))).toBe(true);
    const after = (await getSubscription(project.id, s.id))!;
    expect(after.recipientState['out@other.org']).toBe('confirmed');
    await deliverSubscription(project, after);
    expect(sent.map((m) => m.to)).toContain('out@other.org');
    const mail = sent.find((m) => m.to === 'out@other.org') as unknown as { headers: Record<string, string> };
    expect(mail.headers['List-Unsubscribe']).toContain('/api/analytics/sub-unsubscribe?t=');
    expect(mail.headers['List-Unsubscribe-Post']).toBe('List-Unsubscribe=One-Click');
  });

  it('people of the workspace enter directly; who unsubscribed is not notified again', async () => {
    const { project, userId } = await setup();
    const insight = await createInsight(project.id, userId, { name: 'I', query: trend() });
    const owner = (await getDb().prepare('SELECT email FROM users WHERE id = ?').get(userId)) as { email: string };
    sent.length = 0;
    const s = await createRaw(project, userId, { name: 'Team', insightId: insight.id, recipients: [owner.email, 'gone@other.org'], message: 'Hola', schedule });
    if (!s || s === 'email_limit') throw new Error('no se creó');
    expect(s.recipientState[owner.email.toLowerCase()]).toBe('confirmed');
    expect(JSON.stringify(sent)).not.toContain('Hola');
    await unsubscribe(unsubscribeToken(s.id, 'gone@other.org'));
    sent.length = 0;
    // Volver a agregarla, acá o en otra suscripción, no le manda nada.
    const again = await updateRaw(project, s.id, { recipients: [owner.email, 'gone@other.org'] });
    if (!again || again === 'email_limit') throw new Error('no se guardó');
    expect(again.recipientState['gone@other.org']).toBe('unsubscribed');
    const other = await createRaw(project, userId, { name: 'Other', insightId: insight.id, recipients: ['gone@other.org'], schedule });
    if (!other || other === 'email_limit') throw new Error('no se creó');
    expect(other.recipientState['gone@other.org']).toBe('unsubscribed');
    expect(sent).toEqual([]);
    await deliverSubscription(project, other);
    expect(sent).toEqual([]);
  });

  it('a new workspace has a low email limit per hour, for notices and for sending', async () => {
    const prev = process.env.RATE_LIMIT_DISABLED;
    delete process.env.RATE_LIMIT_DISABLED;
    try {
      const { project, userId } = await setup();
      const insight = await createInsight(project.id, userId, { name: 'I', query: trend() });
      const many = Array.from({ length: 20 }, (_, i) => `r${i}@other.org`);
      const a = await createRaw(project, userId, { name: 'A', insightId: insight.id, recipients: many, schedule });
      expect(a && a !== 'email_limit').toBeTruthy();
      sent.length = 0;
      // El tope de 30 por hora: la segunda ya no entra, y no se crea ni se avisa a nadie.
      const b = await createRaw(project, userId, { name: 'B', insightId: insight.id, recipients: many, schedule });
      expect(b).toBe('email_limit');
      expect(sent).toEqual([]);
      const all = (await getDb().prepare('SELECT count(*) AS n FROM analytics_subscriptions WHERE project_id = ?').get(project.id)) as { n: number };
      expect(Number(all.n)).toBe(1);
    } finally {
      if (prev !== undefined) process.env.RATE_LIMIT_DISABLED = prev;
    }
  });

  it('names lose line breaks, and the report keeps the locale of the subscription', async () => {
    const { project, userId } = await setup();
    const insight = await createInsight(project.id, userId, { name: 'I', query: trend() });
    const s = await createSubscription(project, userId, { name: 'A\r\nBcc: x@evil.example', insightId: insight.id, recipients: ['l@other.org'], schedule }, Date.now(), 'es');
    expect(s?.name).toBe('A Bcc: x@evil.example');
    sent.length = 0;
    await deliverSubscription(project, s!);
    expect(sent[0].text).toContain('Serie | Total');
    expect(sent[0].text).toContain('Darme de baja');
  });

  it('creating notifies the recipients once; the cron delivers once and moves to the next date', async () => {
    const { project, userId } = await setup();
    const insight = await createInsight(project.id, userId, { name: 'Sales', query: trend() });
    sent.length = 0;
    const s = await createSubscription(project, userId, { name: 'Weekly sales', insightId: insight.id, recipients: ['Ana@acme.com', 'ana@acme.com', 'bob@other.org'], message: 'Hola', schedule });
    expect(s?.recipients).toEqual(['ana@acme.com', 'bob@other.org']);
    expect(sent.map((m) => m.to)).toEqual(['ana@acme.com', 'bob@other.org']);
    expect(sent[0].text).not.toContain('Hola');
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
    expect(await createRaw(project, userId, { name: 'N', insightId: foreign.id, recipients: ['x@acme.com'], schedule })).toBeNull();
  });

  it('unsubscribe: a good token removes that person, a tampered one nobody, and the last one turns it off', async () => {
    const { project, userId } = await setup();
    const insight = await createInsight(project.id, userId, { name: 'I', query: trend() });
    const s = (await createSubscription(project, userId, { name: 'U', insightId: insight.id, recipients: ['a@acme.com', 'b@acme.com'], schedule }))!;
    expect(unsubscribeToken(s.id, 'a@acme.com')).toBeTruthy();
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
