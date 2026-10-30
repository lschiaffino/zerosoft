import { beforeAll, describe, expect, it } from 'vitest';
import { getDb, upsertUser } from '@/lib/db';
import { INGEST_LIMITS, cleanUrl, eventTime, expandIpv6, maskIp, parseIngestBody, planPersons, validTs } from '@/lib/analytics/ingest-core';
import { checkSql, wrapSql } from '@/lib/analytics/sql-safe';
import { runReadOnly } from '@/lib/analytics/sql-run';
import { createProject, deleteProject, type ProjectRow } from '@/lib/analytics/projects';
import { dayOf, storeEvents } from '@/lib/analytics/ingest';
import { runSql, QueryError } from '@/lib/analytics/query';
import { runAnalyticsCron } from '@/lib/analytics/cron';
import { createDashboard, createFlag, createInsight } from '@/lib/analytics/records';
import { listPersons } from '@/lib/analytics/persons';

const DAY = 86_400_000;
const REAL = ['users', 'api_keys', 'analytics_events'];

describe('analytics: fechas imposibles no entran', () => {
  const now = Date.parse('2026-10-29T12:00:00Z');

  it('descarta timestamps negativos, enormes o más viejos que 5 años', () => {
    for (const timestamp of [-1, -9e18, 9e18, 1e300, '9999-01-01T00:00:00Z', Number.MAX_SAFE_INTEGER, 1e15]) {
      const r = parseIngestBody(JSON.stringify({ event: 'e', distinct_id: 'u', timestamp }), now);
      // Fuera de rango: el timestamp se ignora (queda ahora) o el evento se descarta; nunca se guarda el valor.
      if (r.ok) for (const e of r.events) expect(validTs(e.ts, now)).toBe(true);
    }
    // sent_at enorme con timestamp válido (desfase absurdo): se descarta.
    const skew = parseIngestBody(JSON.stringify({ sent_at: 4e12, batch: [{ event: 'e', distinct_id: 'u', timestamp: now }] }), now);
    expect(skew.ok && skew.events.length).toBe(0);
    expect(eventTime(now - 6 * 365 * DAY, null, now)).toBeNull();
    expect(validTs(2 ** 60, now)).toBe(false);
    expect(dayOf(8.64e15 + 1, 0)).toBeNull();
  });

  it('$set y $set_once cuentan dentro del tope de propiedades', () => {
    const big = { k: 'x'.repeat(INGEST_LIMITS.maxPropsBytes) };
    const r = parseIngestBody(JSON.stringify({ event: 'e', distinct_id: 'u', $set: big }), now);
    expect(r.ok && r.events.length).toBe(0);
  });

  it('IPv6 se expande antes de anonimizar y la IPv4 mapeada se trata como IPv4', () => {
    expect(maskIp('2001:db8::1')).toBe('2001:db8:0::');
    expect(maskIp('::1')).toBe('0:0:0::');
    expect(maskIp('::ffff:203.0.113.9')).toBe('203.0.113.0');
    expect(expandIpv6('2001:db8::')).toEqual(['2001', 'db8', '0', '0', '0', '0', '0', '0']);
    expect(maskIp('not-an-ip')).toBeNull();
  });

  it('la URL guardada pierde el fragmento y los parámetros con secretos', () => {
    expect(cleanUrl('https://acme.com/reset?token=abc&utm_source=x&page=2#access_token=zzz')).toBe('https://acme.com/reset?utm_source=x&page=2');
  });

  it('un id identificado nunca se une a otra persona', () => {
    const existing = new Map([['user-a', { personId: 'p_a', identified: true }]]);
    const plan = planPersons('p1', [{ event: '$identify', distinctId: 'user-b', properties: { $anon_distinct_id: 'user-a' }, ts: 1, set: null, setOnce: null }], existing);
    expect(plan.merges).toEqual([]);
    expect(plan.mappings.find((m) => m.distinctId === 'user-b')?.personId).not.toBe('p_a');
  });
});

describe('analytics: SQL con límites', () => {
  it('rechaza printf, joins sin condición, más de dos tablas y paréntesis sueltos', () => {
    const cases: Array<[string, string]> = [
      ["SELECT printf('%.*c', 900000000, 'x')", 'function_not_allowed'],
      ["SELECT replace(properties, '\"', 'xxxx') FROM events", 'function_not_allowed'],
      ['SELECT count(*) FROM events a, events b', 'join_without_condition'],
      ['SELECT count(*) FROM events a JOIN events b', 'join_without_condition'],
      ['SELECT count(*) FROM events a CROSS JOIN events b', 'keyword_not_allowed'],
      ['SELECT count(*) FROM events NATURAL JOIN sessions', 'keyword_not_allowed'],
      ['SELECT count(*) FROM events a JOIN events b ON a.uuid = b.uuid JOIN events c ON c.uuid = a.uuid', 'too_many_tables'],
      ['SELECT * FROM events WHERE (1', 'unbalanced_parentheses'],
      ['SELECT * FROM events WHERE 1) UNION ALL SELECT 1 FROM (SELECT 1', 'unbalanced_parentheses'],
    ];
    for (const [sql, error] of cases) expect(checkSql(sql, REAL), sql).toMatchObject({ ok: false, error });
    expect(checkSql('SELECT a.event FROM events a JOIN sessions s ON s.id = a.session_id WHERE a.event IN (1, 2)', REAL)).toMatchObject({ ok: true });
  });

  it('no hay forma de multiplicar filas: CTEs, ON constantes, OR y subconsultas correlacionadas', () => {
    const bad: Array<[string, string]> = [
      ['WITH a AS (SELECT * FROM events), b AS (SELECT * FROM events) SELECT count(*) FROM a JOIN b ON 1=1 JOIN a c ON 1=1', 'too_many_tables'],
      ['WITH a AS (SELECT * FROM events) SELECT count(*) FROM a x JOIN a y ON x.uuid = y.uuid', 'join_not_allowed'],
      ['WITH a AS (SELECT * FROM events) SELECT count(*) FROM a JOIN persons p ON a.person_id = p.id', 'join_not_allowed'],
      ['SELECT count(*) FROM events a JOIN events b ON a.uuid IS NOT b.uuid OR 1', 'join_not_allowed'],
      ['SELECT count(*) FROM events a JOIN events b ON a.event = b.event', 'join_not_allowed'],
      ['SELECT count(*) FROM events e JOIN persons p ON 1=1', 'join_not_allowed'],
      ['SELECT count(*) FROM events e JOIN persons p ON e.person_id = p.id OR 1', 'join_not_allowed'],
      ['SELECT count(*) FROM events e JOIN persons p ON e.event = p.id', 'join_not_allowed'],
      ['SELECT count(*) FROM events e JOIN persons p USING (id)', 'join_without_condition'],
      ['SELECT (SELECT count(*) FROM events b WHERE b.timestamp > a.timestamp) FROM events a', 'too_many_tables'],
      ['SELECT * FROM events WHERE event IN (SELECT event FROM events)', 'too_many_tables'],
      ['SELECT count(*) FROM (SELECT * FROM events) x JOIN persons p ON x.person_id = p.id', 'too_many_tables'],
    ];
    for (const [sql, error] of bad) expect(checkSql(sql, REAL), sql).toMatchObject({ ok: false, error });
    for (const sql of [
      'SELECT p.id, count(*) FROM events e JOIN persons p ON e.person_id = p.id AND p.is_identified = 1 GROUP BY 1',
      'SELECT count(*) FROM events e LEFT JOIN sessions s ON s.id = e.session_id WHERE s.pageviews > 1',
      'WITH x AS (SELECT person_id FROM events) SELECT count(*) FROM x',
      'SELECT count(*) FROM (SELECT DISTINCT person_id FROM events)',
    ]) {
      expect(checkSql(sql, REAL), sql).toMatchObject({ ok: true });
    }
  });

  it('cada tabla virtual tiene tope de filas', () => {
    const w = wrapSql('SELECT 1', 'ap_1', 1_000_000_000_000);
    expect(w.sql.match(/LIMIT 100000/g)?.length).toBe(4);
  });

  it('events solo ve los últimos 90 días', () => {
    const now = Date.parse('2026-10-29T00:00:00Z');
    const w = wrapSql('SELECT 1', 'ap_1', now);
    expect(w.args).toContain(String(now - 90 * DAY));
  });

  it('una consulta lenta se corta sin frenar el servidor y no puede escribir', async () => {
    let ticks = 0;
    const timer = setInterval(() => ticks++, 50);
    const started = Date.now();
    await expect(
      runReadOnly('WITH RECURSIVE r(n) AS (SELECT 1 UNION ALL SELECT n + 1 FROM r) SELECT count(*) FROM r', [], 10, 800),
    ).rejects.toMatchObject({ code: 'timeout' });
    clearInterval(timer);
    expect(Date.now() - started).toBeLessThan(5000);
    // El hilo principal siguió atendiendo mientras tanto.
    expect(ticks).toBeGreaterThan(5);
    await upsertUser({ id: 'ro-owner', email: 'ro-owner@test.local', name: 'RO' });
    await expect(runReadOnly("UPDATE users SET name = 'pwned' WHERE id = 'ro-owner'", [], 10, 5000)).rejects.toMatchObject({ code: 'sql_error' });
    const row = (await getDb().prepare("SELECT name FROM users WHERE id = 'ro-owner'").get()) as { name: string };
    expect(row.name).toBe('RO');
    const ok = await runReadOnly('SELECT 1 AS one', [], 10, 5000);
    expect(ok).toEqual({ columns: ['one'], rows: [[1]] });
  }, 20_000);
});

describe('analytics: cron resistente y purga completa', () => {
  let a: ProjectRow;
  let b: ProjectRow;
  const now = Date.now();

  beforeAll(async () => {
    await upsertUser({ id: 'hard-owner', email: 'hard-owner@test.local', name: 'Owner' });
    a = await createProject('hard-owner', 'hard-owner', 'A');
    b = await createProject('hard-owner', 'hard-owner', 'B');
  });

  it('una fila envenenada (anterior a la validación) no frena el cron de los demás proyectos', async () => {
    await getDb()
      .prepare("INSERT INTO analytics_events (project_id, event, distinct_id, ts, properties) VALUES (?, 'bad', 'x', 1152921504606846976, '{}'), (?, 'bad', 'x', -1152921504606846976, '{}')")
      .run(a.id, a.id);
    await storeEvents(b, [{ event: '$pageview', distinctId: 'u', properties: {}, ts: now - 3 * DAY, uuid: null, set: null, setOnce: null }], null);
    const res = await runAnalyticsCron({ budgetMs: 20_000 });
    expect(res.rolledDays).toBeGreaterThan(0);
    const daily = (await getDb().prepare('SELECT count(*) AS n FROM analytics_daily WHERE project_id = ?').get(b.id)) as { n: number };
    expect(Number(daily.n)).toBeGreaterThan(0);
    const bad = (await getDb().prepare("SELECT count(*) AS n FROM analytics_events WHERE project_id = ? AND event = 'bad'").get(a.id)) as { n: number };
    expect(Number(bad.n)).toBe(0);
  });

  it('un evento de un día ya cerrado marca el rollup para rehacer, y el cron no lo olvida', async () => {
    const before = (await getDb().prepare('SELECT rolled_through FROM analytics_projects WHERE id = ?').get(b.id)) as { rolled_through: string };
    expect(before.rolled_through).toBeTruthy();
    // Un día antes de lo cerrado: dirty_from apunta ahí aunque el caché del proyecto diga otra cosa.
    await storeEvents(b, [{ event: '$pageview', distinctId: 'u2', properties: {}, ts: now - 2 * DAY, uuid: null, set: null, setOnce: null }], null);
    const mid = (await getDb().prepare('SELECT dirty_from FROM analytics_projects WHERE id = ?').get(b.id)) as { dirty_from: string | null };
    expect(mid.dirty_from).toBeTruthy();
    await runAnalyticsCron({ budgetMs: 20_000 });
    const after = (await getDb().prepare('SELECT dirty_from FROM analytics_projects WHERE id = ?').get(b.id)) as { dirty_from: string | null };
    expect(after.dirty_from).toBeNull();
    const n = (await getDb().prepare("SELECT sum(count) AS n FROM analytics_daily WHERE project_id = ? AND event = '$pageview'").get(b.id)) as { n: number };
    expect(Number(n.n)).toBe(2);
  });

  it('las propiedades de una persona tienen tope de claves', async () => {
    const many: Record<string, number> = {};
    for (let i = 0; i < 400; i++) many[`k${i}`] = i;
    const more: Record<string, number> = {};
    for (let i = 400; i < 800; i++) more[`k${i}`] = i;
    await storeEvents(b, [{ event: 'e', distinctId: 'capped', properties: {}, ts: now, uuid: null, set: many, setOnce: null }], null);
    await storeEvents(b, [{ event: 'e', distinctId: 'capped', properties: {}, ts: now, uuid: null, set: more, setOnce: null }], null);
    const { persons } = await listPersons(b.id, { q: 'capped' });
    expect(Object.keys(persons[0].properties).length).toBeLessThanOrEqual(INGEST_LIMITS.maxPersonKeys);
  });

  it('borrar el proyecto purga insights, tableros, cohortes y flags sin depender de las FK', async () => {
    await getDb().exec('PRAGMA foreign_keys = OFF');
    const i = await createInsight(a.id, 'hard-owner', { name: 'I', query: { kind: 'sql', sql: 'SELECT 1' } });
    await createDashboard(a.id, 'hard-owner', { name: 'D' });
    await createFlag(a.id, 'hard-owner', { key: 'f', name: '', active: true, rollout: 100, variants: [], conditions: [] });
    expect(i.id).toBeTruthy();
    await deleteProject('hard-owner', a.id);
    await runAnalyticsCron({ budgetMs: 20_000 });
    for (const t of ['analytics_insights', 'analytics_dashboards', 'analytics_flags', 'analytics_cohorts', 'analytics_projects']) {
      const col = t === 'analytics_projects' ? 'id' : 'project_id';
      const r = (await getDb().prepare(`SELECT count(*) AS n FROM ${t} WHERE ${col} = ?`).get(a.id)) as { n: number };
      expect(Number(r.n), t).toBe(0);
    }
    await getDb().exec('PRAGMA foreign_keys = ON');
  });

  it('runSql devuelve sql_timeout como error de la consulta', async () => {
    await expect(runSql(b, 'SELECT 1 FROM events WHERE (1')).rejects.toBeInstanceOf(QueryError);
  });
});
