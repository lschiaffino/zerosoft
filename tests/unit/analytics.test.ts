import { describe, expect, it, beforeAll } from 'vitest';
import { getDb, upsertUser } from '@/lib/db';
import {
  INGEST_LIMITS,
  eventColumns,
  eventTime,
  maskIp,
  normalizeDomains,
  originAllowed,
  parseIngestBody,
  personIdFor,
  planPersons,
} from '@/lib/analytics/ingest-core';
import { evaluateFlag, flagHash, matchProperty, pickVariant, variantsValid } from '@/lib/analytics/flags-core';
import { checkSql, wrapSql } from '@/lib/analytics/sql-safe';
import {
  breakdownSeries,
  bucketList,
  bucketOf,
  bucketSql,
  computeFunnel,
  computePaths,
  computeRetention,
  periodOf,
  previousRange,
  resolveRange,
} from '@/lib/analytics/compute';
import { filterSql } from '@/lib/analytics/sql-build';
import { createProject, deleteProject, projectByKey, rotateSecret, type ProjectRow } from '@/lib/analytics/projects';
import { storeEvents } from '@/lib/analytics/ingest';
import { runFunnel, runRetention, runSql, runTrends, runWeb, runPaths, liveEvents, QueryError } from '@/lib/analytics/query';
import { deletePerson, listPersons, personIdByDistinctId } from '@/lib/analytics/persons';
import { createCohort, createFlag } from '@/lib/analytics/records';
import { decideFlags } from '@/lib/analytics/flags';
import { runAnalyticsCron } from '@/lib/analytics/cron';
import { insightQuerySchema } from '@/lib/analytics/types';

const DAY = 86_400_000;

// ---------- Ingesta ----------

describe('analytics: validación de la ingesta', () => {
  const now = Date.parse('2026-10-29T12:00:00Z');

  it('acepta un evento suelto y un lote, con la key en api_key o token', () => {
    const one = parseIngestBody(JSON.stringify({ api_key: 'zsp_x', event: '$pageview', distinct_id: 'u1', properties: { a: 1 } }), now);
    expect(one).toMatchObject({ ok: true, apiKey: 'zsp_x', dropped: 0 });
    if (one.ok) expect(one.events[0]).toMatchObject({ event: '$pageview', distinctId: 'u1', ts: now });
    const batch = parseIngestBody(JSON.stringify({ token: 'zsp_y', batch: [{ event: 'a', distinct_id: 'u' }, { event: 'b', properties: { distinct_id: 'v' } }] }), now);
    expect(batch.ok && batch.events.map((e) => e.distinctId)).toEqual(['u', 'v']);
    expect(batch.ok && batch.apiKey).toBe('zsp_y');
  });

  it('descarta eventos inválidos y cuenta cuántos', () => {
    const r = parseIngestBody(
      JSON.stringify({
        api_key: 'k',
        batch: [
          { event: '', distinct_id: 'u' },
          { event: 'ok', distinct_id: '' },
          { event: 'x'.repeat(201), distinct_id: 'u' },
          { event: 'big', distinct_id: 'u', properties: { blob: 'x'.repeat(INGEST_LIMITS.maxPropsBytes + 10) } },
          'nope',
          { event: 'good', distinct_id: 42 },
        ],
      }),
      now,
    );
    expect(r.ok && r.events.map((e) => e.event)).toEqual(['good']);
    expect(r.ok && r.events[0].distinctId).toBe('42');
    expect(r.ok && r.dropped).toBe(5);
  });

  it('rechaza JSON roto, lotes vacíos o demasiado grandes', () => {
    expect(parseIngestBody('{', now)).toEqual({ ok: false, error: 'invalid_json' });
    expect(parseIngestBody(JSON.stringify({ batch: [] }), now)).toEqual({ ok: false, error: 'empty_batch' });
    expect(parseIngestBody(JSON.stringify({ batch: Array(INGEST_LIMITS.maxBatch + 1).fill({ event: 'a', distinct_id: 'b' }) }), now)).toEqual({
      ok: false,
      error: 'batch_too_large',
    });
    expect(parseIngestBody(JSON.stringify('hola'), now)).toEqual({ ok: false, error: 'invalid_payload' });
  });

  it('saca $set y $set_once del evento y de sus propiedades; borra la key de las propiedades', () => {
    const r = parseIngestBody(JSON.stringify({ event: 'e', distinct_id: 'u', properties: { token: 'secret', $set: { plan: 'pro' } }, $set_once: { first: 1 } }), now);
    expect(r.ok && r.events[0].set).toEqual({ plan: 'pro' });
    expect(r.ok && r.events[0].setOnce).toEqual({ first: 1 });
    expect(r.ok && r.events[0].properties).toEqual({});
  });

  it('corrige el reloj del cliente con sent_at y no acepta el futuro', () => {
    // El cliente adelanta 1 h: el evento pasó hace 10 s en su reloj.
    const clientNow = now + 3_600_000;
    expect(eventTime(clientNow - 10_000, clientNow, now)).toBe(now - 10_000);
    expect(eventTime(now + 5 * 3_600_000, null, now)).toBe(now);
    expect(eventTime(null, null, now)).toBe(now);
  });

  it('arma las columnas web: UTM y referrer de la URL, navegador del pedido', () => {
    const cols = eventColumns(
      { $current_url: 'https://www.acme.com/pricing?utm_source=newsletter&utm_campaign=oct', $referrer: 'https://www.google.com/search?q=x' },
      { country: 'AR', device: 'mobile', browser: 'Safari', os: 'iOS', ip: '1.2.3.4' },
    );
    expect(cols).toMatchObject({
      pathname: '/pricing',
      host: 'www.acme.com',
      referring_domain: 'google.com',
      utm_source: 'newsletter',
      utm_campaign: 'oct',
      browser: 'Safari',
      device: 'mobile',
      country: 'AR',
    });
    // Evento de servidor (sin navegador): lo que traiga el evento.
    expect(eventColumns({ $browser: 'Server' }, null).browser).toBe('Server');
    // Sin referrer: directo.
    expect(eventColumns({ $current_url: 'https://acme.com/' }, null).referring_domain).toBe('$direct');
  });

  it('anonimiza IPv4 e IPv6', () => {
    expect(maskIp('203.0.113.77')).toBe('203.0.113.0');
    expect(maskIp('2001:db8:85a3:8d3:1319:8a2e:370:7348')).toBe('2001:db8:85a3::');
    expect(maskIp('2001:0db8:0000::7348')).toBe('2001:db8:0::');
    expect(maskIp('unknown')).toBeNull();
  });

  it('dominios permitidos: exactos y comodín, sin origen no pasa', () => {
    const list = normalizeDomains(['https://Acme.com/x', '*.shop.io', 'not a domain!', '']);
    expect(list).toEqual(['acme.com', '*.shop.io']);
    expect(originAllowed('https://acme.com', list)).toBe(true);
    expect(originAllowed('https://evil-acme.com', list)).toBe(false);
    expect(originAllowed('https://eu.shop.io', list)).toBe(true);
    expect(originAllowed('https://shop.io', list)).toBe(true);
    expect(originAllowed('https://shop.io.evil.com', list)).toBe(false);
    expect(originAllowed(null, list)).toBe(false);
    expect(originAllowed(null, [])).toBe(true);
  });

  it('personas: identify une la anónima con el id nuevo y $set queda arriba de $set_once', () => {
    const plan = planPersons(
      'p1',
      [
        { event: '$pageview', distinctId: 'anon', properties: {}, ts: 1, set: null, setOnce: { first: 'a' } },
        { event: '$identify', distinctId: 'user-1', properties: { $anon_distinct_id: 'anon' }, ts: 2, set: { email: 'a@b.c' }, setOnce: { first: 'b' } },
      ],
      new Map(),
    );
    const pid = personIdFor('p1', 'anon');
    expect(plan.mappings).toEqual([
      { distinctId: 'anon', personId: pid },
      { distinctId: 'user-1', personId: pid },
    ]);
    expect(plan.merges).toEqual([]);
    expect(plan.writes).toHaveLength(1);
    expect(plan.writes[0]).toMatchObject({ personId: pid, identified: true, set: { email: 'a@b.c' }, setOnce: { first: 'a' }, created: true });
  });

  it('personas: si el id identificado ya tenía persona, la anónima se funde en ella', () => {
    const existing = new Map([
      ['anon', { personId: 'p_anon', identified: false }],
      ['user-1', { personId: 'p_user', identified: true }],
    ]);
    const plan = planPersons('p1', [{ event: '$identify', distinctId: 'user-1', properties: { $anon_distinct_id: 'anon' }, ts: 5, set: null, setOnce: null }], existing);
    expect(plan.merges).toEqual([{ from: 'p_anon', into: 'p_user' }]);
    // Una persona anónima ya identificada no se funde (como PostHog).
    const guarded = planPersons(
      'p1',
      [{ event: '$identify', distinctId: 'user-1', properties: { $anon_distinct_id: 'anon' }, ts: 5, set: null, setOnce: null }],
      new Map([
        ['anon', { personId: 'p_anon', identified: true }],
        ['user-1', { personId: 'p_user', identified: true }],
      ]),
    );
    expect(guarded.merges).toEqual([]);
  });

  it('alias suma otro distinct_id a la misma persona', () => {
    const plan = planPersons('p1', [{ event: '$create_alias', distinctId: 'user-1', properties: { alias: 'crm-77' }, ts: 1, set: null, setOnce: null }], new Map());
    const pid = personIdFor('p1', 'user-1');
    expect(plan.mappings).toContainEqual({ distinctId: 'crm-77', personId: pid });
  });
});

// ---------- Flags ----------

describe('analytics: feature flags', () => {
  it('el hash es estable y el rollout reparte cerca del porcentaje', () => {
    expect(flagHash('beta', 'u1')).toBe(flagHash('beta', 'u1'));
    expect(flagHash('beta', 'u1')).not.toBe(flagHash('beta', 'u2'));
    const flag = { key: 'beta', active: true, rollout: 30, variants: [], conditions: [] };
    let on = 0;
    for (let i = 0; i < 4000; i++) if (evaluateFlag(flag, `user-${i}`, {}) === true) on++;
    expect(on / 4000).toBeGreaterThan(0.26);
    expect(on / 4000).toBeLessThan(0.34);
  });

  it('apagado o sin cumplir condiciones da false; condiciones sobre propiedades', () => {
    const base = { key: 'k', active: true, rollout: 100, variants: [], conditions: [{ key: 'plan', op: 'eq' as const, value: 'Pro' }] };
    expect(evaluateFlag(base, 'u', { plan: 'pro' })).toBe(true);
    expect(evaluateFlag(base, 'u', { plan: 'free' })).toBe(false);
    expect(evaluateFlag({ ...base, active: false }, 'u', { plan: 'pro' })).toBe(false);
    expect(matchProperty({ key: 'age', op: 'gt', value: 18 }, { age: '21' })).toBe(true);
    expect(matchProperty({ key: 'age', op: 'gt', value: 18 }, {})).toBe(false);
    expect(matchProperty({ key: 'email', op: 'contains', value: '@ACME' }, { email: 'ana@acme.com' })).toBe(true);
    expect(matchProperty({ key: 'beta', op: 'eq', value: 'true' }, { beta: true })).toBe(true);
    expect(matchProperty({ key: 'x', op: 'is_not_set' }, { x: null })).toBe(true);
  });

  it('multivariante: cada persona cae siempre en la misma variante y las variantes suman 100', () => {
    const flag = { key: 'checkout', active: true, rollout: 100, variants: [{ key: 'control', rollout: 50 }, { key: 'test', rollout: 50 }], conditions: [] };
    const v = evaluateFlag(flag, 'user-9', {});
    expect(['control', 'test']).toContain(v);
    expect(evaluateFlag(flag, 'user-9', {})).toBe(v);
    const counts = { control: 0, test: 0 };
    for (let i = 0; i < 2000; i++) counts[evaluateFlag(flag, `u${i}`, {}) as 'control' | 'test']++;
    expect(counts.control).toBeGreaterThan(850);
    expect(counts.test).toBeGreaterThan(850);
    expect(pickVariant([{ key: 'a', rollout: 0 }, { key: 'b', rollout: 100 }], 0.01)).toBe('b');
    expect(variantsValid([{ key: 'a', rollout: 60 }, { key: 'b', rollout: 30 }])).toBe(false);
    expect(variantsValid([{ key: 'a', rollout: 50 }, { key: 'a', rollout: 50 }])).toBe(false);
  });
});

// ---------- SQL seguro ----------

describe('analytics: capa SQL de solo lectura', () => {
  const real = ['users', 'api_keys', 'analytics_events', 'analytics_projects', 'links', 'sessions'];

  it('acepta consultas de lectura sobre las tablas virtuales', () => {
    for (const sql of [
      'SELECT event, count(*) FROM events GROUP BY event',
      "select pathname, count(DISTINCT person_id) as v from events where event = '$pageview' group by 1 order by v desc limit 10;",
      'WITH x AS (SELECT person_id FROM events) SELECT count(*) FROM x',
      "SELECT json_extract(properties, '$.plan') AS plan FROM persons",
      'SELECT s.entry_path, avg(s.duration_sec) FROM sessions s JOIN person_distinct_ids d ON d.distinct_id = s.distinct_id GROUP BY 1',
      "SELECT 'it''s; DROP TABLE users' AS txt FROM events",
    ]) {
      expect(checkSql(sql, real), sql).toMatchObject({ ok: true });
    }
  });

  it('rechaza escrituras, otras tablas, funciones peligrosas y trucos', () => {
    const cases: Array<[string, string]> = [
      ['DELETE FROM events', 'must_start_with_select'],
      ['SELECT 1; DELETE FROM users', 'multiple_statements'],
      ['WITH x AS (SELECT 1) DELETE FROM users', 'keyword_not_allowed'],
      ['SELECT * FROM users', 'table_not_allowed'],
      ['SELECT * FROM main.analytics_events', 'table_not_allowed'],
      ['SELECT * FROM sqlite_master', 'table_not_allowed'],
      ["SELECT * FROM pragma_table_info('users')", 'table_not_allowed'],
      ['SELECT * FROM "users"', 'quoted_identifiers_not_allowed'],
      ['SELECT * FROM [users]', 'quoted_identifiers_not_allowed'],
      ['SELECT * FROM events -- comment', 'comments_not_allowed'],
      ['SELECT * FROM events /* x */', 'comments_not_allowed'],
      ["SELECT load_extension('x')", 'function_not_allowed'],
      ["SELECT * FROM json_each('[1]')", 'function_not_allowed'],
      ['SELECT * FROM events WHERE event = ?', 'parameters_not_allowed'],
      ['SELECT * FROM events WHERE event = :e', 'parameters_not_allowed'],
      ['WITH RECURSIVE r(n) AS (SELECT 1 UNION ALL SELECT n+1 FROM r) SELECT * FROM r', 'keyword_not_allowed'],
      ['ATTACH DATABASE x AS y', 'must_start_with_select'],
      ['SELECT * FROM events; PRAGMA writable_schema=1', 'multiple_statements'],
      ["SELECT 'abc", 'unterminated_string'],
      ["SELECT x'00' FROM events", 'invalid_character'],
      ['', 'empty'],
    ];
    for (const [sql, error] of cases) expect(checkSql(sql, real), sql).toMatchObject({ ok: false, error });
  });

  it('una tabla real con el nombre de una virtual queda tapada por la CTE (sessions)', () => {
    expect(checkSql('SELECT count(*) FROM sessions', real)).toMatchObject({ ok: true });
  });

  it('envuelve con las CTEs del proyecto y un LIMIT', () => {
    const w = wrapSql('SELECT 1', 'ap_1', 1_000_000_000_000);
    expect(w.args).toEqual(['ap_1', String(1_000_000_000_000 - 90 * DAY), 'ap_1', 'ap_1', 'ap_1']);
    expect(w.sql).toMatch(/WHERE e\.project_id = \?/);
    expect(w.sql).toMatch(/LIMIT 1001$/);
  });
});

// ---------- Cálculos ----------

describe('analytics: agregaciones', () => {
  it('rangos relativos en días enteros del proyecto y período anterior', () => {
    const now = Date.parse('2026-10-29T15:30:00Z');
    const r = resolveRange({ from: '-7d' }, now, 0);
    expect(new Date(r.from).toISOString()).toBe('2026-10-23T00:00:00.000Z');
    expect(r.to).toBe(now);
    const ar = resolveRange({ from: '-1d' }, now, -180);
    expect(new Date(ar.from).toISOString()).toBe('2026-10-29T03:00:00.000Z');
    const p = previousRange({ from: 100, to: 199 });
    expect(p).toEqual({ from: 0, to: 99 });
    expect(resolveRange({ from: '-24h' }, now).from).toBe(now - DAY);
  });

  it('las cubetas de JS coinciden con las del SQL', async () => {
    const db = getDb();
    for (const interval of ['hour', 'day', 'week', 'month'] as const) {
      for (const ts of [Date.parse('2026-10-25T23:59:00Z'), Date.parse('2026-10-26T00:10:00Z'), Date.parse('2026-01-01T05:00:00Z'), Date.parse('2026-03-01T02:00:00Z')]) {
        for (const off of [0, -180, 330]) {
          const row = (await db.prepare(`SELECT ${bucketSql(interval, '?')} AS b`).get(ts, off * 60_000)) as { b: string };
          expect(row.b, `${interval} ${ts} ${off}`).toBe(bucketOf(ts, interval, off));
        }
      }
    }
    expect(bucketOf(Date.parse('2026-10-29T12:00:00Z'), 'week')).toBe('2026-10-26');
    expect(bucketList(Date.parse('2026-10-27T00:00:00Z'), Date.parse('2026-10-29T10:00:00Z'), 'day')).toEqual(['2026-10-27', '2026-10-28', '2026-10-29']);
  });

  it('apertura: las 2 más grandes y "Other" con el resto (solo si se puede sumar)', () => {
    const rows = [
      { bucket: 'a', value: 'Chrome', count: 5 },
      { bucket: 'b', value: 'Chrome', count: 5 },
      { bucket: 'a', value: 'Safari', count: 3 },
      { bucket: 'a', value: 'Edge', count: 1 },
      { bucket: 'b', value: null, count: 1 },
    ];
    const s = breakdownSeries(rows, ['a', 'b'], 2, true);
    expect(s.map((x) => x.value)).toEqual(['Chrome', 'Safari', '$other']);
    expect(s[2].data).toEqual([1, 1]);
    expect(breakdownSeries(rows, ['a', 'b'], 2, false).map((x) => x.value)).toEqual(['Chrome', 'Safari']);
  });

  it('embudo secuencial con ventana de conversión y quién abandonó', () => {
    const H = 3_600_000;
    const rows = [
      // a: completa los 3 pasos.
      { person: 'a', steps: [0], ts: 0 },
      { person: 'a', steps: [1], ts: H },
      { person: 'a', steps: [2], ts: 2 * H },
      // b: el paso 2 antes que el 1 no cuenta, se queda en 2 pasos.
      { person: 'b', steps: [2], ts: 0 },
      { person: 'b', steps: [0], ts: H },
      { person: 'b', steps: [1], ts: 3 * H },
      // c: el paso 2 cae fuera de la ventana (1 día).
      { person: 'c', steps: [0], ts: 0 },
      { person: 'c', steps: [1], ts: 2 * DAY },
      // d: solo el primer paso.
      { person: 'd', steps: [0], ts: 0 },
    ];
    const r = computeFunnel(rows, 3, DAY, { from: 0, to: 10 * DAY });
    expect(r.counts).toEqual([4, 2, 1]);
    expect(r.dropped[0].sort()).toEqual(['c', 'd']);
    expect(r.dropped[1]).toEqual(['b']);
    expect(r.medians[1]).toBe(1.5 * H);
  });

  it('retención por cohorte: cada persona en su primer período', () => {
    const starts = [
      { person: 'a', period: 10 },
      { person: 'a', period: 11 },
      { person: 'b', period: 10 },
      { person: 'c', period: 11 },
    ];
    const returns = [...starts, { person: 'a', period: 12 }];
    const r = computeRetention(starts, returns, 10, 3);
    expect(r[0]).toEqual({ period: 10, size: 2, values: [2, 1, 1] });
    expect(r[1]).toEqual({ period: 11, size: 1, values: [1, 0] });
    expect(r[2]).toEqual({ period: 12, size: 0, values: [0] });
    expect(periodOf(Date.parse('2026-10-26T00:00:00Z'), 'week')).toBe(periodOf(Date.parse('2026-11-01T23:00:00Z'), 'week'));
  });

  it('caminos: transiciones por paso y caminos más comunes', () => {
    const rows = [
      { session: 's1', path: '/', ts: 1 },
      { session: 's1', path: '/', ts: 2 },
      { session: 's1', path: '/pricing', ts: 3 },
      { session: 's1', path: '/signup', ts: 4 },
      { session: 's2', path: '/', ts: 1 },
      { session: 's2', path: '/pricing', ts: 2 },
      { session: 's3', path: '/blog', ts: 1 },
    ];
    const r = computePaths(rows, 3, null);
    expect(r.sessions).toBe(3);
    expect(r.links).toContainEqual({ step: 0, from: '/', to: '/pricing', count: 2 });
    expect(r.links).toContainEqual({ step: 1, from: '/pricing', to: '/signup', count: 1 });
    expect(r.topPaths[0]).toEqual({ path: ['/', '/pricing', '/signup'], count: 1 });
    expect(computePaths(rows, 3, '/pricing').sessions).toBe(2);
  });

  it('filtros: valores y claves van como parámetros', () => {
    const f = filterSql({ key: 'plan', op: 'contains', value: "x'; DROP TABLE users; --", type: 'event' });
    expect(f.sql).not.toContain('DROP');
    expect(f.args).toContain("%x'; DROP TABLE users; --%");
    expect(f.args).toContain('$."plan"');
    // Una clave con comillas no llega nunca al SQL (el esquema la rechaza y el armado también).
    expect(() => filterSql({ key: 'plan"; DROP', op: 'eq', value: 'x', type: 'event' })).toThrow('invalid_property_key');
  });
});

// ---------- De punta a punta sobre la base ----------

describe('analytics: ingesta y consultas sobre libsql', () => {
  let project: ProjectRow;
  let other: ProjectRow;
  const now = Date.now();
  const ev = (event: string, distinctId: string, ago: number, props: Record<string, unknown> = {}) => ({
    event,
    distinctId,
    properties: props,
    ts: now - ago,
    uuid: null,
    set: null,
    setOnce: null,
  });
  const ctx = { country: 'AR', device: 'desktop', browser: 'Chrome', os: 'macOS', ip: '10.1.2.3' };

  beforeAll(async () => {
    await upsertUser({ id: 'an-owner', email: 'an-owner@test.local', name: 'Owner' });
    project = await createProject('an-owner', 'an-owner', 'Site');
    other = await createProject('an-owner', 'an-owner', 'Other');
    const H = 3_600_000;
    await storeEvents(
      project,
      [
        ev('$pageview', 'anon-1', 3 * H, { $current_url: 'https://acme.com/', $session_id: 's1' }),
        ev('$pageview', 'anon-1', 3 * H - 1000, { $current_url: 'https://acme.com/pricing', $session_id: 's1' }),
        ev('signed_up', 'anon-1', 2 * H, { plan: 'pro', $session_id: 's1' }),
        { ...ev('$identify', 'ana@acme.com', 2 * H - 10, { $anon_distinct_id: 'anon-1' }), set: { email: 'ana@acme.com', plan: 'pro' } },
        ev('$pageview', 'anon-2', H, { $current_url: 'https://acme.com/', $session_id: 's2' }),
        ev('$pageview', 'anon-3', H, { $current_url: 'https://acme.com/blog', $session_id: 's3', $referrer: 'https://news.ycombinator.com/' }),
      ],
      ctx,
    );
    // Otro proyecto: nunca se mezcla.
    await storeEvents(other, [ev('$pageview', 'x', H, { $current_url: 'https://other.com/' }), ev('signed_up', 'x', H)], ctx);
  });

  it('guarda con IP anonimizada y une a la persona identificada', async () => {
    const row = (await getDb().prepare('SELECT ip FROM analytics_events WHERE project_id = ? LIMIT 1').get(project.id)) as { ip: string };
    expect(row.ip).toBe('10.1.2.0');
    const a = await personIdByDistinctId(project.id, 'anon-1');
    const b = await personIdByDistinctId(project.id, 'ana@acme.com');
    expect(a).toBeTruthy();
    expect(a).toBe(b);
    const { persons } = await listPersons(project.id, { q: 'ana@acme' });
    expect(persons).toHaveLength(1);
    expect(persons[0].properties).toMatchObject({ email: 'ana@acme.com', plan: 'pro', $initial_pathname: '/' });
    expect(persons[0].isIdentified).toBe(true);
  });

  it('el uuid repetido no duplica el evento', async () => {
    const dup = { ...ev('dup', 'anon-9', 1000), uuid: 'abcdef12-0000-4000-a000-000000000001' };
    expect(await storeEvents(project, [dup], ctx)).toBe(1);
    expect(await storeEvents(project, [dup], ctx)).toBe(0);
  });

  it('tendencia: total y únicos, por día, sin datos del otro proyecto', async () => {
    const r = await runTrends(project, insightQuerySchema.parse({ kind: 'trends', series: [{ event: '$pageview' }, { event: '$pageview', math: 'unique' }], dateRange: { from: '-7d' }, compare: true }) as never);
    expect(r.series[0].total).toBe(4);
    expect(r.series[1].total).toBe(3);
    expect(r.series[0].compareTotal).toBe(0);
    const bd = await runTrends(project, insightQuerySchema.parse({ kind: 'trends', series: [{ event: '$pageview' }], breakdown: { key: '$pathname' } }) as never);
    expect(bd.series.find((s) => s.breakdownValue === '/')?.total).toBe(2);
  });

  it('embudo de 2 pasos y retención', async () => {
    const f = await runFunnel(project, insightQuerySchema.parse({ kind: 'funnel', steps: [{ event: '$pageview' }, { event: 'signed_up' }] }) as never);
    expect(f.steps.map((s) => s.count)).toEqual([3, 1]);
    expect(f.droppedPersons[0]).toHaveLength(2);
    const ret = await runRetention(project, insightQuerySchema.parse({ kind: 'retention', period: 'day', periods: 3 }) as never);
    expect(ret.cohorts[ret.cohorts.length - 1].size + ret.cohorts[ret.cohorts.length - 2].size).toBeGreaterThan(0);
  });

  it('web, caminos y eventos en vivo', async () => {
    const web = await runWeb(project, { kind: 'web', dateRange: { from: '-7d' }, compare: false });
    expect(web.stats.pageviews.value).toBe(4);
    expect(web.stats.sessions.value).toBe(3);
    expect(web.referrers.map((x) => x.key)).toContain('news.ycombinator.com');
    const paths = await runPaths(project, { kind: 'paths', dateRange: { from: '-7d' }, steps: 3 });
    expect(paths.links).toContainEqual({ step: 0, from: '/', to: '/pricing', count: 1 });
    const live = await liveEvents(project, { limit: 3 });
    expect(live).toHaveLength(3);
    expect(live[0].id).toBeGreaterThan(live[2].id);
  });

  it('SQL: solo ve su proyecto y rechaza otras tablas', async () => {
    const r = await runSql(project, 'SELECT count(*) AS n FROM events');
    expect(r.rows[0][0]).toBe(7);
    await expect(runSql(project, 'SELECT * FROM users')).rejects.toBeInstanceOf(QueryError);
    await expect(runSql(project, 'SELECT * FROM analytics_events')).rejects.toMatchObject({ code: 'table_not_allowed' });
  });

  it('cohortes y flags con condiciones sobre la persona', async () => {
    const cohort = await createCohort(project.id, 'an-owner', { name: 'Signed up', definition: { properties: [], behavior: { event: 'signed_up', days: 30, minCount: 1 } } });
    const t = await runTrends(project, insightQuerySchema.parse({ kind: 'trends', series: [{ event: '$pageview' }], cohortId: cohort.id }) as never);
    expect(t.series[0].total).toBe(2);
    const flag = await createFlag(project.id, 'an-owner', { key: 'pro-beta', name: '', active: true, rollout: 100, variants: [], conditions: [{ key: 'plan', op: 'eq', value: 'pro', type: 'person' }] });
    expect(flag).not.toBe('duplicate_key');
    expect((await decideFlags(project.id, 'anon-1'))['pro-beta']).toBe(true);
    expect((await decideFlags(project.id, 'anon-2'))['pro-beta']).toBe(false);
    expect((await decideFlags(other.id, 'anon-1'))['pro-beta']).toBeUndefined();
  });

  it('keys: pública y secreta, y el proyecto borrado deja de aceptar', async () => {
    expect((await projectByKey(other.public_key, 'public'))?.id).toBe(other.id);
    const secret = await rotateSecret('an-owner', other.id);
    expect(secret).toMatch(/^zss_/);
    expect((await projectByKey(secret!, 'secret'))?.id).toBe(other.id);
    expect(await deleteProject('an-owner', other.id)).toBe(true);
    expect(await projectByKey(other.public_key, 'public')).toBeNull();
  });

  it('borrar una persona borra sus eventos de todos sus distinct_ids', async () => {
    const pid = (await personIdByDistinctId(project.id, 'ana@acme.com'))!;
    const res = await deletePerson(project.id, pid);
    expect(res).toMatchObject({ deleted: true });
    expect(res.events).toBe(4);
    const left = (await getDb().prepare("SELECT count(*) AS n FROM analytics_events WHERE project_id = ? AND distinct_id IN ('anon-1', 'ana@acme.com')").get(project.id)) as { n: number };
    expect(Number(left.n)).toBe(0);
  });

  it('cron: rollup diario, purga del proyecto borrado y retención', async () => {
    const old = await createProject('an-owner', 'an-owner', 'Old');
    await storeEvents(old, [ev('$pageview', 'z', 3 * DAY), ev('$pageview', 'z', 40 * DAY)], null);
    await getDb().prepare('UPDATE analytics_projects SET retention_days = 30 WHERE id = ?').run(old.id);
    const res = await runAnalyticsCron({ budgetMs: 20_000 });
    expect(res.deletedProjects).toBeGreaterThanOrEqual(1);
    expect(res.rolledDays).toBeGreaterThan(0);
    const left = (await getDb().prepare('SELECT count(*) AS n FROM analytics_events WHERE project_id = ?').get(old.id)) as { n: number };
    expect(Number(left.n)).toBe(1);
    const otherLeft = (await getDb().prepare('SELECT count(*) AS n FROM analytics_events WHERE project_id = ?').get(other.id)) as { n: number };
    expect(Number(otherLeft.n)).toBe(0);
    // El rollup avanza 31 días por corrida: la segunda llega hasta ayer y no rehace lo hecho.
    const again = await runAnalyticsCron({ budgetMs: 20_000 });
    expect(again.deletedProjects).toBe(0);
    const daily = (await getDb().prepare("SELECT count FROM analytics_daily WHERE project_id = ? AND event = '$pageview'").all(old.id)) as Array<{ count: number }>;
    expect(daily.reduce((a, d) => a + Number(d.count), 0)).toBe(1);
    const third = await runAnalyticsCron({ budgetMs: 20_000 });
    expect(third.rolledDays).toBe(0);
    // Con los días cerrados en el rollup, la tendencia sin filtros los lee de ahí.
    const fresh = (await getDb().prepare('SELECT * FROM analytics_projects WHERE id = ?').get(old.id)) as ProjectRow;
    const t = await runTrends(fresh, insightQuerySchema.parse({ kind: 'trends', series: [{ event: '$pageview' }], dateRange: { from: '-7d' } }) as never);
    expect(t.usedRollup).toBe(true);
    expect(t.series[0].total).toBe(1);
  });
});
