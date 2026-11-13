import { randomUUID } from 'crypto';
import { beforeEach, describe, expect, it } from 'vitest';
import { getDb } from '@/lib/db';
import {
  analyticsRange,
  dayIndexSql,
  daySeries,
  formatMoney,
  idxDay,
  localDay,
  periodChoice,
  periodParams,
  rangeSegments,
  sqlStamp,
} from '@/lib/analytics-kit/period';
import { shortCache } from '@/lib/analytics-kit/cache';
import { clearInboxAnalyticsCache, inboxAnalytics, inboxFactsSql, isInboxAnalyticsEmpty } from '@/lib/inbox/analytics';
import { aggregateCalls, callsAnalytics, callsFactsSql, clearCallsAnalyticsCache } from '@/lib/calls/analytics';
import { clearCrmAnalyticsCache, crmAnalytics, crmFactsSql } from '@/lib/crm-analytics';
import type { CallsActor } from '@/lib/calls/types';
import { makeUser } from './helpers';

/** Un "ahora" fijo: jueves 12 de noviembre de 2026, 15:00 UTC. */
const NOW = new Date('2026-11-12T15:00:00.000Z');
const iso = (s: string) => new Date(s).toISOString();
const id = (p: string) => `${p}_${randomUUID().replace(/-/g, '').slice(0, 20)}`;

beforeEach(() => {
  clearInboxAnalyticsCache();
  clearCallsAnalyticsCache();
  clearCrmAnalyticsCache();
});

async function plan(sql: string, args: Array<string | number>): Promise<string> {
  const rows = (await getDb().prepare(`EXPLAIN QUERY PLAN ${sql}`).all(...args)) as Array<{ detail: string }>;
  return rows.map((r) => r.detail).join('\n');
}

// ======================================================================
// El kit: períodos, zona horaria y series
// ======================================================================

describe('kit: período y series', () => {
  it('lee el período de la URL: 7/30/90, rango propio y rango invertido', () => {
    expect(periodChoice({})).toMatchObject({ days: 30, custom: false, inverted: false });
    expect(periodChoice({ days: '7' })).toMatchObject({ days: 7, custom: false });
    expect(periodChoice({ days: '13' }).days).toBe(30);
    expect(periodChoice({ from: '2026-10-01', to: '2026-10-31' })).toMatchObject({ custom: true, from: '2026-10-01', to: '2026-10-31' });
    const inv = periodChoice({ from: '2026-10-31', to: '2026-10-01' });
    expect(inv).toMatchObject({ inverted: true, custom: false, from: undefined, to: undefined, rawFrom: '2026-10-31', rawTo: '2026-10-01' });
    expect(periodChoice({ from: '2026-02-30' }).custom).toBe(false);
  });

  it('los parámetros que conservan el período', () => {
    const r = analyticsRange({ days: 7 }, NOW);
    expect(periodParams(r)).toEqual({ from: undefined, to: undefined, days: '7' });
    expect(periodParams(analyticsRange({ days: 30 }, NOW)).days).toBeUndefined();
    expect(periodParams(analyticsRange({ from: '2026-10-01', to: '2026-10-05' }, NOW))).toEqual({ from: '2026-10-01', to: '2026-10-05', days: undefined });
  });

  it('el día local en SQL coincide con el de JS, también en un cambio de hora', async () => {
    const range = analyticsRange({ from: '2026-10-20', to: '2026-11-10', tz: 'America/New_York' }, NOW);
    const seg = rangeSegments(range);
    // 1 de noviembre de 2026: Nueva York pasa de -4 a -5.
    for (const at of ['2026-11-01T03:30:00Z', '2026-11-01T04:30:00Z', '2026-11-01T05:30:00Z', '2026-11-02T04:59:00Z', '2026-11-02T05:01:00Z', '2026-10-25T12:00:00Z']) {
      const sec = Math.floor(Date.parse(at) / 1000);
      const row = (await getDb().prepare(`SELECT ${dayIndexSql(seg, String(sec))} AS d`).get()) as { d: number };
      expect(idxDay(row.d), at).toBe(localDay(Date.parse(at), 'America/New_York'));
    }
  });

  it('series alineadas por día, del período y del anterior', () => {
    const range = analyticsRange({ days: 3 }, NOW);
    const { cur, prev } = daySeries(range, new Map([['2026-11-12', { n: 2 }], ['2026-11-08', { n: 5 }]]), () => ({ n: 0 }));
    expect(cur.map((p) => [p.day, p.n])).toEqual([['2026-11-10', 0], ['2026-11-11', 0], ['2026-11-12', 2]]);
    expect(prev.map((p) => [p.day, p.n])).toEqual([['2026-11-07', 0], ['2026-11-08', 5], ['2026-11-09', 0]]);
  });

  it('formato de fechas de SQLite y montos', () => {
    expect(sqlStamp('2026-11-12T03:04:05.678Z')).toBe('2026-11-12 03:04:05');
    expect(formatMoney(1234, 'en', 'USD')).toBe('$1,234');
    expect(formatMoney(10, 'en', 'not-a-code')).toBe('10 not-a-code');
  });

  it('la caché corta reusa el resultado y no guarda errores', async () => {
    const c = shortCache<number>(1000, 2);
    let calls = 0;
    const load = async () => ++calls;
    expect(await c.get('a', load, 0)).toBe(1);
    expect(await c.get('a', load, 500)).toBe(1);
    expect(await c.get('a', load, 1500)).toBe(2);
    await expect(c.get('b', () => Promise.reject(new Error('x')), 0)).rejects.toThrow('x');
    await Promise.resolve();
    expect(await c.get('b', load, 1)).toBe(3);
  });
});

// ======================================================================
// Inbox
// ======================================================================

async function inboxAccount(owner: string, kind: 'whatsapp' | 'gmail') {
  const acc = id('iba');
  await getDb()
    .prepare(`INSERT INTO inbox_accounts (id, owner_id, kind, status, created_at, updated_at) VALUES (?, ?, ?, 'connected', ?, ?)`)
    .run(acc, owner, kind, iso('2026-01-01'), iso('2026-01-01'));
  return acc;
}

async function inboxThread(owner: string, account: string, o: { channel: 'whatsapp' | 'gmail'; kind: 'dm' | 'group' | 'email'; title: string; lastFromMe?: boolean; lastOutbound?: string; doneAt?: string; archivedAt?: string }) {
  const tid = id('ibt');
  await getDb()
    .prepare(
      `INSERT INTO inbox_threads (id, owner_id, account_id, channel, kind, external_id, title, last_message_at, last_from_me, last_outbound_at, done_at, archived_at, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(tid, owner, account, o.channel, o.kind, tid, o.title, iso('2026-11-12T10:00:00Z'), o.lastFromMe ? 1 : 0, o.lastOutbound ?? null, o.doneAt ?? null, o.archivedAt ?? null, iso('2026-01-01'), iso('2026-01-01'));
  return tid;
}

async function inboxMessage(owner: string, thread: string, fromMe: boolean, at: string, hidden = false) {
  await getDb()
    .prepare(`INSERT INTO inbox_messages (id, owner_id, thread_id, external_id, from_me, body, sent_at, created_at, hidden_at) VALUES (?, ?, ?, ?, ?, 'x', ?, ?, ?)`)
    .run(id('ibm'), owner, thread, id('ext'), fromMe ? 1 : 0, iso(at), iso(at), hidden ? iso(at) : null);
}

describe('Inbox: analítica personal', () => {
  it('cuenta lo de la persona por canal y día, la primera respuesta y lo que espera, sin mezclar a nadie', async () => {
    const me = await makeUser('ia-me');
    const other = await makeUser('ia-other');
    const wa = await inboxAccount(me.id, 'whatsapp');
    const gm = await inboxAccount(me.id, 'gmail');
    const dm = await inboxThread(me.id, wa, { channel: 'whatsapp', kind: 'dm', title: 'Ana', lastFromMe: true, lastOutbound: '2026-11-12T09:10:00Z' });
    const prevDm = await inboxThread(me.id, wa, { channel: 'whatsapp', kind: 'dm', title: 'Previo' });
    const grp = await inboxThread(me.id, wa, { channel: 'whatsapp', kind: 'group', title: 'Familia' });
    const mail = await inboxThread(me.id, gm, { channel: 'gmail', kind: 'email', title: 'Proveedor', lastFromMe: true, lastOutbound: '2026-11-10T09:00:00Z', doneAt: '2026-11-11T10:00:00Z' });
    await inboxThread(me.id, wa, { channel: 'whatsapp', kind: 'dm', title: 'Viejo', archivedAt: '2026-11-05T10:00:00Z' });
    // WhatsApp: dos recibidos y una respuesta a los 10 minutos.
    await inboxMessage(me.id, dm, false, '2026-11-12T09:00:00Z');
    await inboxMessage(me.id, dm, false, '2026-11-12T09:05:00Z');
    await inboxMessage(me.id, dm, true, '2026-11-12T09:10:00Z');
    // Un mensaje borrado para mí no cuenta.
    await inboxMessage(me.id, dm, false, '2026-11-12T09:20:00Z', true);
    // Email: recibido y respuesta a las 2 horas, el día anterior.
    await inboxMessage(me.id, mail, false, '2026-11-11T08:00:00Z');
    await inboxMessage(me.id, mail, true, '2026-11-11T10:00:00Z');
    // Grupo: tres recibidos (no cuentan para la primera respuesta).
    for (const at of ['2026-11-12T11:00:00Z', '2026-11-12T11:01:00Z', '2026-11-12T11:02:00Z']) await inboxMessage(me.id, grp, false, at);
    // El período anterior: un recibido (en otro chat: una tanda que empieza antes del período se mide en el período en que empezó).
    await inboxMessage(me.id, prevDm, false, '2026-10-01T12:00:00Z');
    // Otra persona: nada de esto puede aparecer.
    const owa = await inboxAccount(other.id, 'whatsapp');
    const odm = await inboxThread(other.id, owa, { channel: 'whatsapp', kind: 'dm', title: 'Ajeno' });
    for (let i = 0; i < 5; i++) await inboxMessage(other.id, odm, false, '2026-11-12T09:00:00Z');

    const d = await inboxAnalytics(me.id, { days: 30, tz: 'UTC' }, { now: NOW });
    expect(d.kpis.received).toEqual({ value: 6, prev: 1 });
    expect(d.kpis.sent).toEqual({ value: 2, prev: 0 });
    expect(d.kpis.threads).toEqual({ value: 3, prev: 1 });
    // Mediana de 10 min y 120 min.
    expect(d.kpis.firstResponseMin.value).toBe(65);
    expect(d.buckets).toEqual([0, 1, 0, 1, 0, 0]);
    expect(d.kpis.done).toEqual({ value: 1, prev: 0 });
    expect(d.kpis.archived).toEqual({ value: 1, prev: 0 });
    // Esperando: el email donde mandaste último hace más de un día está marcado como hecho, así que no cuenta.
    expect(d.kpis.waiting.value).toBe(0);
    // Por responder: "Previo" (el último mensaje es del otro).
    expect(d.kpis.toReply.value).toBe(1);
    const today = d.perDay.find((p) => p.day === '2026-11-12')!;
    expect(today).toMatchObject({ received: 5, sent: 1, whatsapp: 3, groups: 3, email: 0 });
    expect(d.perDay.find((p) => p.day === '2026-11-11')).toMatchObject({ email: 2, done: 1 });
    expect(d.byChannel).toEqual([
      { key: 'whatsapp', received: 2, sent: 1, threads: 1, prevTotal: 1 },
      { key: 'email', received: 1, sent: 1, threads: 1, prevTotal: 0 },
      { key: 'groups', received: 3, sent: 0, threads: 1, prevTotal: 0 },
    ]);
    // Ana y Familia con 3 mensajes (empatan), Proveedor con 2.
    expect(d.topThreads.slice(0, 2).map((t) => t.title).sort()).toEqual(['Ana', 'Familia']);
    expect(d.topThreads[2]).toMatchObject({ title: 'Proveedor', channel: 'email', received: 1, sent: 1 });
    expect(d.topThreads.map((t) => t.title)).not.toContain('Ajeno');
    // Jueves (3) a las 11: los tres del grupo.
    expect(d.heatmap[3][11]).toBe(3);
    expect(isInboxAnalyticsEmpty(d)).toBe(false);

    // La otra persona ve solo lo suyo.
    const o = await inboxAnalytics(other.id, { days: 30, tz: 'UTC' }, { now: NOW });
    expect(o.kpis.received.value).toBe(5);
    expect(o.topThreads.map((t) => t.title)).toEqual(['Ajeno']);
  });

  it('el día sale en la zona de quien mira', async () => {
    const me = await makeUser('ia-tz');
    const wa = await inboxAccount(me.id, 'whatsapp');
    const dm = await inboxThread(me.id, wa, { channel: 'whatsapp', kind: 'dm', title: 'Noche' });
    // 02:00 UTC del 12 es el 11 a la noche en Buenos Aires.
    await inboxMessage(me.id, dm, false, '2026-11-12T02:00:00Z');
    const d = await inboxAnalytics(me.id, { days: 7, tz: 'America/Argentina/Buenos_Aires' }, { now: NOW });
    expect(d.perDay.find((p) => p.day === '2026-11-11')?.received).toBe(1);
    expect(d.perDay.find((p) => p.day === '2026-11-12')?.received).toBe(0);
  });

  it('vacío sin mensajes', async () => {
    const me = await makeUser('ia-empty');
    const d = await inboxAnalytics(me.id, { days: 7 }, { now: NOW });
    expect(isInboxAnalyticsEmpty(d)).toBe(true);
    expect(d.perDay).toHaveLength(7);
  });

  it('lee los mensajes por índice de persona y fecha', async () => {
    const me = await makeUser('ia-plan');
    const range = analyticsRange({ days: 90, tz: 'America/New_York' }, NOW);
    const { sql, args } = inboxFactsSql(me.id, range);
    const text = await plan(sql, args);
    expect(text).toMatch(/SEARCH m USING INDEX idx_inbox_messages_owner_sent \(owner_id=\? AND sent_at>\? AND sent_at<\?\)/);
    expect(text).not.toMatch(/SCAN m\b/);
    expect(text).not.toMatch(/SCAN t\b/);
  });
});

// ======================================================================
// Calls
// ======================================================================

async function call(ws: string, owner: string, o: { at: string; min: number; status?: string; talk?: number; qExt?: number; qInt?: number; score?: number; topics?: string[]; competitors?: string[] }) {
  const metrics = o.talk == null ? null : JSON.stringify({ talkMs: 1, talkRatio: o.talk, bySpeaker: [], longestMonologue: null, longestCustomerStory: null, interactivity: 1, patienceMs: null, questionsInternal: o.qInt ?? 0, questionsExternal: o.qExt ?? 0 });
  const analysis =
    o.topics || o.competitors || o.score != null
      ? JSON.stringify({
          summary: '',
          topics: (o.topics ?? []).map((name) => ({ name, startMs: 0 })),
          competitors: (o.competitors ?? []).flatMap((name) => [
            { name, atMs: 0, quote: '' },
            { name, atMs: 5000, quote: '' },
          ]),
          scorecard: { methodology: 'spiced', items: o.score != null ? [{ key: 's', label: 'S', score: 3, evidence: '', atMs: null }] : [], total: o.score ?? 0 },
        })
      : null;
  await getDb()
    .prepare(`INSERT INTO calls (id, workspace_id, owner_id, title, status, started_at, duration_ms, metrics, analysis, created_at, updated_at) VALUES (?, ?, ?, 'c', ?, ?, ?, ?, ?, ?, ?)`)
    .run(id('cl'), ws, owner, o.status ?? 'ready', iso(o.at), Math.round(o.min * 60_000), metrics, analysis, iso(o.at), iso(o.at));
}

const actorOf = (ws: string, person: string, admin: boolean): CallsActor => ({ ws, person, admin, email: `${person}@test.local`, name: person });

describe('Calls: analítica', () => {
  it('llamadas, minutos, cuánto habla el equipo, preguntas, temas, competidores y por rep', async () => {
    const ws = await makeUser('ca-ws');
    const ana = await makeUser('ca-ana');
    await call(ws.id, ws.id, { at: '2026-11-12T10:00:00Z', min: 30, talk: 0.5, qExt: 3, qInt: 4, score: 80, topics: ['Pricing', 'Onboarding'], competitors: ['Acme'] });
    await call(ws.id, ana.id, { at: '2026-11-11T10:00:00Z', min: 15, talk: 0.7, qExt: 1, score: 60, topics: ['pricing'] });
    await call(ws.id, ana.id, { at: '2026-11-10T10:00:00Z', min: 45, talk: 0.3 });
    // No cuentan: agendada, fallida, borrada, de otro workspace.
    await call(ws.id, ana.id, { at: '2026-11-12T11:00:00Z', min: 10, status: 'scheduled' });
    await call(ws.id, ana.id, { at: '2026-11-12T11:00:00Z', min: 10, status: 'failed' });
    const other = await makeUser('ca-other');
    await call(other.id, other.id, { at: '2026-11-12T10:00:00Z', min: 99, topics: ['Secreto'] });
    // El período anterior.
    await call(ws.id, ws.id, { at: '2026-10-05T10:00:00Z', min: 20, talk: 0.4 });

    const d = await callsAnalytics(actorOf(ws.id, ws.id, true), { days: 30, tz: 'UTC' }, { now: NOW });
    expect(d.kpis.calls).toEqual({ value: 3, prev: 1 });
    expect(d.kpis.minutes).toEqual({ value: 90, prev: 20 });
    expect(d.kpis.avgMinutes.value).toBe(30);
    expect(d.kpis.talkRatio.value).toBeCloseTo(0.5, 5);
    expect(d.kpis.questions.value).toBe(4);
    expect(d.kpis.teamQuestions.value).toBe(4);
    expect(d.kpis.score.value).toBe(70);
    expect(d.kpis.reps.value).toBe(2);
    expect(d.talkBands).toEqual([1, 1, 1]);
    // "Pricing" y "pricing" son el mismo tema; un competidor dos veces en una llamada cuenta una.
    expect(d.topics).toEqual([
      { name: 'Pricing', calls: 2 },
      { name: 'Onboarding', calls: 1 },
    ]);
    expect(d.competitors).toEqual([{ name: 'Acme', calls: 1 }]);
    expect(d.reps.map((r) => [r.id, r.calls, r.minutes, r.questions, r.score])).toEqual([
      [ana.id, 2, 60, 1, 60],
      [ws.id, 1, 30, 3, 80],
    ]);
    expect(d.perDay.find((p) => p.day === '2026-11-12')).toMatchObject({ calls: 1, minutes: 30 });
  });

  it('con las llamadas en privado, un member cuenta solo las suyas; un admin, todas', async () => {
    const ws = await makeUser('ca-priv');
    const ana = await makeUser('ca-priv-ana');
    const beto = await makeUser('ca-priv-beto');
    await call(ws.id, ana.id, { at: '2026-11-12T10:00:00Z', min: 10, topics: ['Ana'] });
    await call(ws.id, beto.id, { at: '2026-11-12T10:00:00Z', min: 20, topics: ['Beto'] });
    await getDb().prepare(`INSERT INTO calls_settings (workspace_id, data, updated_at) VALUES (?, ?, ?)`).run(ws.id, JSON.stringify({ visibility: 'private' }), iso('2026-11-01'));

    const mine = await callsAnalytics(actorOf(ws.id, ana.id, false), { days: 7, tz: 'UTC' }, { now: NOW });
    expect(mine.kpis.calls.value).toBe(1);
    expect(mine.kpis.minutes.value).toBe(10);
    expect(mine.topics.map((t) => t.name)).toEqual(['Ana']);
    expect(mine.reps.map((r) => r.id)).toEqual([ana.id]);

    const admin = await callsAnalytics(actorOf(ws.id, beto.id, true), { days: 7, tz: 'UTC' }, { now: NOW });
    expect(admin.kpis.calls.value).toBe(2);

    // En modo equipo, el member ve todas.
    await getDb().prepare(`UPDATE calls_settings SET data = ? WHERE workspace_id = ?`).run(JSON.stringify({ visibility: 'team' }), ws.id);
    const team = await callsAnalytics(actorOf(ws.id, ana.id, false), { days: 7, tz: 'UTC' }, { now: NOW });
    expect(team.kpis.calls.value).toBe(2);
  });

  it('agrega sin llamadas (todo en cero, sin promedios inventados)', () => {
    const range = analyticsRange({ days: 7 }, NOW);
    const d = aggregateCalls(range, []);
    expect(d.kpis.calls).toEqual({ value: 0, prev: 0 });
    expect(d.kpis.talkRatio.value).toBeNull();
    expect(d.kpis.score.value).toBeNull();
    expect(d.reps).toEqual([]);
  });

  it('lee las llamadas por índice de workspace y fecha', async () => {
    const ws = await makeUser('ca-plan');
    const range = analyticsRange({ days: 90 }, NOW);
    const sc = { sql: `c.workspace_id = ? AND c.deleted_at IS NULL AND c.status IN ('ready') AND (? = 1 OR c.owner_id = ? OR ? = 'team')`, args: [ws.id, 0, ws.id, 'team'] };
    const { sql, args } = callsFactsSql(range, sc);
    const text = await plan(sql, args);
    expect(text).toMatch(/SEARCH c USING INDEX idx_calls_ws/);
    expect(text).not.toMatch(/SCAN c\b/);
  });
});

// ======================================================================
// CRM
// ======================================================================

const stamp = (s: string) => sqlStamp(iso(s));

async function crmSetup(ws: string) {
  const db = getDb();
  const pipe = id('pip');
  await db.prepare(`INSERT INTO crm_pipelines (id, user_id, name, position) VALUES (?, ?, 'Ventas', 0)`).run(pipe, ws);
  const stage = async (name: string, position: number, probability: number, won = 0, lost = 0) => {
    const sid = id('stg');
    await db.prepare(`INSERT INTO crm_stages (id, pipeline_id, name, probability, position, is_won, is_lost) VALUES (?, ?, ?, ?, ?, ?, ?)`).run(sid, pipe, name, probability, position, won, lost);
    return sid;
  };
  return { pipe, lead: await stage('Lead', 0, 10), proposal: await stage('Propuesta', 1, 50), won: await stage('Ganado', 2, 100, 1), lost: await stage('Perdido', 3, 0, 0, 1) };
}

async function deal(ws: string, s: { pipe: string }, stageId: string, o: { owner: string; amount: number; created: string; closed?: string; reason?: string }) {
  await getDb()
    .prepare(`INSERT INTO crm_deals (id, user_id, owner_id, pipeline_id, stage_id, name, amount, currency, lost_reason, closed_at, created_at, updated_at) VALUES (?, ?, ?, ?, ?, 'd', ?, 'USD', ?, ?, ?, ?)`)
    .run(id('deal'), ws, o.owner, s.pipe, stageId, o.amount, o.reason ?? '', o.closed ? stamp(o.closed) : null, stamp(o.created), stamp(o.created));
}

async function activity(ws: string, owner: string, type: string, at: string) {
  await getDb().prepare(`INSERT INTO crm_activities (id, user_id, owner_id, type, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)`).run(id('act'), ws, owner, type, stamp(at), stamp(at));
}

describe('CRM: analítica', () => {
  it('creados, ganados, perdidos, tasa de cierre, ciclo, pipeline por etapa y actividad; un member restringido ve solo sus owners', async () => {
    const ws = await makeUser('crm-an');
    const ana = await makeUser('crm-an-ana');
    const s = await crmSetup(ws.id);
    await deal(ws.id, s, s.lead, { owner: ws.id, amount: 1000, created: '2026-11-10T10:00:00Z' });
    await deal(ws.id, s, s.proposal, { owner: ana.id, amount: 4000, created: '2026-11-11T10:00:00Z' });
    await deal(ws.id, s, s.won, { owner: ana.id, amount: 5000, created: '2026-11-02T10:00:00Z', closed: '2026-11-12T10:00:00Z' });
    await deal(ws.id, s, s.won, { owner: ws.id, amount: 2000, created: '2026-10-01T10:00:00Z', closed: '2026-11-05T10:00:00Z' });
    await deal(ws.id, s, s.lost, { owner: ws.id, amount: 700, created: '2026-11-03T10:00:00Z', closed: '2026-11-06T10:00:00Z', reason: 'Precio' });
    // Período anterior: un ganado.
    await deal(ws.id, s, s.won, { owner: ws.id, amount: 300, created: '2026-09-20T10:00:00Z', closed: '2026-10-08T10:00:00Z' });
    await activity(ws.id, ws.id, 'call', '2026-11-12T09:00:00Z');
    await activity(ws.id, ana.id, 'email', '2026-11-12T09:00:00Z');
    await activity(ws.id, ana.id, 'email', '2026-11-11T09:00:00Z');
    // Otro workspace: no cuenta.
    const other = await makeUser('crm-an-other');
    const so = await crmSetup(other.id);
    await deal(other.id, so, so.won, { owner: other.id, amount: 99_999, created: '2026-11-10T10:00:00Z', closed: '2026-11-11T10:00:00Z' });

    const d = await crmAnalytics(ws.id, null, { days: 30, tz: 'UTC' }, { now: NOW });
    // El período es del 14/10 al 12/11; el anterior, del 14/9 al 13/10 (ahí se crearon dos).
    expect(d.kpis.created).toEqual({ value: 4, prev: 2 });
    expect(d.kpis.won).toEqual({ value: 2, prev: 1 });
    expect(d.kpis.lost).toEqual({ value: 1, prev: 0 });
    expect(d.kpis.wonAmount).toEqual({ value: 7000, prev: 300 });
    expect(d.kpis.winRate.value).toBeCloseTo(2 / 3, 5);
    expect(d.kpis.winRate.prev).toBe(1);
    // Ciclos de 10 y 35 días: mediana 23 (redondeada).
    expect(d.kpis.cycleDays.value).toBe(23);
    expect(d.kpis.openAmount.value).toBe(5000);
    expect(d.kpis.openDeals.value).toBe(2);
    expect(d.kpis.weighted.value).toBe(100 + 2000);
    expect(d.stages.map((x) => [x.name, x.deals, x.amount])).toEqual([
      ['Lead', 1, 1000],
      ['Propuesta', 1, 4000],
    ]);
    expect(d.kpis.activities).toEqual({ value: 3, prev: 0 });
    expect(d.activityTypes.find((x) => x.key === 'email')?.value).toBe(2);
    expect(d.lostReasons).toEqual([{ reason: 'Precio', deals: 1 }]);
    expect(d.owners.map((o) => [o.id, o.won, o.wonAmount, o.activities])).toEqual([
      [ana.id, 1, 5000, 2],
      [ws.id, 1, 2000, 1],
    ]);
    expect(d.perDay.find((p) => p.day === '2026-11-12')).toMatchObject({ won: 1, wonAmount: 5000, activities: 2 });

    // Un member con visibilidad "mine": solo lo de Ana, y el pipeline abierto también.
    const mine = await crmAnalytics(ws.id, [ana.id], { days: 30, tz: 'UTC' }, { now: NOW });
    expect(mine.kpis.created.value).toBe(2);
    expect(mine.kpis.wonAmount.value).toBe(5000);
    expect(mine.kpis.lost.value).toBe(0);
    expect(mine.kpis.openAmount.value).toBe(4000);
    expect(mine.kpis.activities.value).toBe(2);
    expect(mine.owners.map((o) => o.id)).toEqual([ana.id]);
    // Sin owners visibles: nada.
    const none = await crmAnalytics(ws.id, [], { days: 30, tz: 'UTC' }, { now: NOW });
    expect(none.kpis.created.value).toBe(0);
    expect(none.kpis.openDeals.value).toBe(0);

    // Filtrar por un pipeline sin deals.
    const empty = await crmAnalytics(ws.id, null, { days: 30, tz: 'UTC', pipelineId: so.pipe }, { now: NOW });
    expect(empty.kpis.created.value).toBe(0);
    expect(empty.stages).toEqual([]);
  });

  it('los montos van en la moneda base con el tipo de cambio del workspace', async () => {
    const ws = await makeUser('crm-fx');
    const s = await crmSetup(ws.id);
    await getDb().prepare(`INSERT INTO crm_settings (user_id, base_currency, updated_at) VALUES (?, 'USD', datetime('now'))`).run(ws.id);
    await getDb().prepare(`INSERT INTO crm_exchange_rates (user_id, currency, rate) VALUES (?, 'EUR', 2)`).run(ws.id);
    await getDb()
      .prepare(`INSERT INTO crm_deals (id, user_id, owner_id, pipeline_id, stage_id, amount, currency, closed_at, created_at, updated_at) VALUES (?, ?, ?, ?, ?, 100, 'EUR', ?, ?, ?)`)
      .run(id('deal'), ws.id, ws.id, s.pipe, s.won, stamp('2026-11-12T09:00:00Z'), stamp('2026-11-11T09:00:00Z'), stamp('2026-11-11T09:00:00Z'));
    const d = await crmAnalytics(ws.id, null, { days: 7, tz: 'UTC' }, { now: NOW });
    expect(d.currency).toBe('USD');
    expect(d.kpis.wonAmount.value).toBe(200);
  });

  it('lee deals y actividades por índice de workspace y fecha', async () => {
    const ws = await makeUser('crm-plan');
    const range = analyticsRange({ days: 90, tz: 'America/New_York' }, NOW);
    for (const scope of [null, ['a', 'b']]) {
      const q = crmFactsSql(ws.id, range, scope);
      expect(await plan(q.created.sql, q.created.args)).toMatch(/SEARCH d USING INDEX idx_crm_deals_user \(user_id=\? AND created_at>\? AND created_at<\?\)/);
      expect(await plan(q.closed.sql, q.closed.args)).toMatch(/SEARCH d USING INDEX idx_crm_deals_closed \(user_id=\? AND closed_at>\? AND closed_at<\?\)/);
      expect(await plan(q.activities.sql, q.activities.args)).toMatch(/SEARCH a USING INDEX idx_crm_activities_user \(user_id=\? AND created_at>\? AND created_at<\?\)/);
      expect(await plan(q.open.sql, q.open.args)).not.toMatch(/SCAN d\b/);
    }
  });
});
