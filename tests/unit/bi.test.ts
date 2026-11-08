import { beforeAll, describe, expect, it } from 'vitest';
import { getDb, upsertUser } from '@/lib/db';
import { setMemberVisibility } from '@/lib/crm-visibility';
import type { BiViewer } from '@/lib/bi/access';
import { applyParams, buildSql, BuildError, literal } from '@/lib/bi/builder';
import { runQuery, RunError, compileQuery } from '@/lib/bi/run';
import { ZS_GUARD, zsSchema } from '@/lib/bi/zs-tables';
import { checkSqlWith } from '@/lib/analytics/sql-safe';
import { pickViz } from '@/lib/bi/viz';
import { resolveDbHost, UnsafeHostError, validHostSyntax } from '@/lib/bi/net-guard';
import { cleanUserSql, validateConfig } from '@/lib/bi/external';
import { nextRun } from '@/lib/bi/subscriptions';
import { fakeAnswer } from '@/lib/bi/ai';
import {
  addCard,
  createCollection,
  createDashboard,
  createQuestion,
  createShare,
  deleteCollection,
  getQuestion,
  listItems,
  personalCollection,
  shareByToken,
  updateDashboard,
} from '@/lib/bi/store';
import { withDashFilters } from '@/lib/bi/service';
import type { BuilderQuery, SchemaTable } from '@/lib/bi/types';

const OWNER = 'bi-owner';
const MEMBER = 'bi-member';
const NOCRM = 'bi-nocrm';
const owner: BiViewer = { workspaceId: OWNER, personId: OWNER, role: 'owner', apps: '*' };
const member: BiViewer = { workspaceId: OWNER, personId: MEMBER, role: 'member', apps: ['analytics', 'crm'] };
const noCrm: BiViewer = { workspaceId: OWNER, personId: NOCRM, role: 'member', apps: ['analytics'] };

beforeAll(async () => {
  for (const id of [OWNER, MEMBER, NOCRM]) await upsertUser({ id, email: `${id}@test.local`, name: id });
  const db = getDb();
  await db.prepare("INSERT OR IGNORE INTO teams (id, name, owner_id) VALUES ('bi-team', 'BI', ?)").run(OWNER);
  await db.prepare("INSERT OR IGNORE INTO team_members (team_id, user_id, role, apps) VALUES ('bi-team', ?, 'member', '[\"analytics\",\"crm\"]')").run(MEMBER);
  await db.prepare("INSERT OR IGNORE INTO team_members (team_id, user_id, role, apps) VALUES ('bi-team', ?, 'member', '[\"analytics\"]')").run(NOCRM);
  await db.prepare("INSERT INTO crm_companies (id, user_id, name, country) VALUES ('bi-co1', ?, 'Acme', 'AR')").run(OWNER);
  const contacts: Array<[string, string, string | null, string]> = [
    ['bi-c1', 'Ana', OWNER, '2026-01-05 10:00:00'],
    ['bi-c2', 'Beto', MEMBER, '2026-01-20 10:00:00'],
    ['bi-c3', 'Caro', MEMBER, '2026-02-03 10:00:00'],
  ];
  for (const [id, name, ownerId, at] of contacts) {
    await db
      .prepare("INSERT INTO crm_contacts (id, user_id, owner_id, first_name, last_name, email, company_id, created_at) VALUES (?, ?, ?, ?, '', ?, 'bi-co1', ?)")
      .run(id, OWNER, ownerId, name, `${name.toLowerCase()}@x.test`, at);
  }
});

describe('constructor → SQL', () => {
  const schema: SchemaTable[] = [
    { name: 'contacts', columns: [{ name: 'id', type: 'text' }, { name: 'country', type: 'text' }, { name: 'created_at', type: 'date' }, { name: 'company_id', type: 'text' }, { name: 'score', type: 'number' }] },
    { name: 'companies', columns: [{ name: 'id', type: 'text' }, { name: 'name', type: 'text' }] },
  ];
  const q = (over: Partial<BuilderQuery>): BuilderQuery => ({ kind: 'builder', table: 'contacts', joins: [], filters: [], aggregations: [], breakouts: [], sort: [], ...over });

  it('cuenta por mes con filtro y lo valida la lista blanca', () => {
    const { sql } = buildSql(
      q({ filters: [{ column: 'country', op: '=', value: "AR' OR 1=1" }], aggregations: [{ fn: 'count' }], breakouts: [{ column: 'created_at', bucket: 'month' }] }),
      schema,
      'sqlite',
    );
    expect(sql).toContain("'AR'' OR 1=1'");
    expect(sql).toContain("strftime('%Y-%m-01', t0.created_at)");
    expect(checkSqlWith(sql, ['crm_contacts', 'users'], ZS_GUARD)).toMatchObject({ ok: true });
  });

  it('rechaza columnas, tablas y uniones que no existen o no están permitidas', () => {
    expect(() => buildSql(q({ filters: [{ column: 'password', op: '=', value: 'x' }] }), schema, 'sqlite')).toThrow(BuildError);
    expect(() => buildSql(q({ table: 'users' }), schema, 'sqlite')).toThrow(BuildError);
    expect(() =>
      buildSql(q({ joins: [{ table: 'companies', left: 'country', right: 'name', type: 'left' }] }), schema, 'sqlite', { allowedJoins: ZS_GUARD.joinKeys }),
    ).toThrow(BuildError);
    const ok = buildSql(q({ joins: [{ table: 'companies', left: 'company_id', right: 'id', type: 'left' }], breakouts: [{ column: 'companies.name' }], aggregations: [{ fn: 'count' }] }), schema, 'sqlite', {
      allowedJoins: ZS_GUARD.joinKeys,
    });
    expect(checkSqlWith(ok.sql, [], ZS_GUARD)).toMatchObject({ ok: true });
  });

  it('cita identificadores en Postgres y MySQL y escapa barras en MySQL', () => {
    const pg = buildSql({ ...q({}), table: 'public.orders' }, [{ name: 'public.orders', columns: [{ name: 'Total "x"', type: 'number' }] }], 'postgres');
    expect(pg.sql).toContain('"public"."orders"');
    expect(pg.sql).toContain('"Total ""x"""');
    expect(literal("a\\' b", 'mysql')).toBe("'a\\\\'' b'");
  });

  it('variables: {{x}} como literal y [[…]] opcional', () => {
    const params = [{ name: 'country', type: 'text' as const }, { name: 'min', type: 'number' as const }];
    const sql = 'SELECT * FROM contacts WHERE 1=1 [[AND country = {{country}}]] [[AND score > {{min}}]]';
    expect(applyParams(sql, params, { country: "A'R" }, 'sqlite')).toBe("SELECT * FROM contacts WHERE 1=1 AND country = 'A''R' ");
    expect(() => applyParams(sql, params, { min: '1; DROP' }, 'sqlite')).toThrow(BuildError);
    expect(() => applyParams('SELECT {{x}}', [], {}, 'sqlite')).toThrow(BuildError);
  });
});

describe('datos propios con permisos', () => {
  it('el owner ve todos los contactos; sin la app CRM, la tabla no aparece y vuelve vacía', async () => {
    const all = await runQuery(owner, 'zerosoft', { kind: 'sql', sql: 'SELECT first_name FROM contacts ORDER BY first_name', params: [] }, { fresh: true });
    expect(all.rows.map((r) => r[0])).toEqual(['Ana', 'Beto', 'Caro']);
    expect(all.sql).not.toContain('crm_contacts');
    expect((await zsSchema(noCrm)).map((t) => t.name)).not.toContain('contacts');
    const none = await runQuery(noCrm, 'zerosoft', { kind: 'sql', sql: 'SELECT COUNT(*) AS n FROM contacts', params: [] }, { fresh: true });
    expect(none.rows[0][0]).toBe(0);
  });

  it('con visibilidad "solo lo mío" en el CRM, un miembro ve solo sus contactos', async () => {
    await setMemberVisibility(OWNER, 'mine');
    const mine = await runQuery(member, 'zerosoft', { kind: 'sql', sql: 'SELECT first_name FROM contacts ORDER BY 1', params: [] }, { fresh: true });
    expect(mine.rows.map((r) => r[0])).toEqual(['Beto', 'Caro']);
    await setMemberVisibility(OWNER, 'all');
  });

  it('no deja nombrar tablas reales, escribir ni llamar funciones raras', async () => {
    for (const sql of ['SELECT * FROM crm_contacts', 'SELECT * FROM users', 'DELETE FROM contacts', "SELECT load_extension('x')", 'SELECT 1; SELECT 2', 'SELECT * FROM contacts, companies']) {
      await expect(runQuery(owner, 'zerosoft', { kind: 'sql', sql, params: [] }, { fresh: true })).rejects.toBeInstanceOf(RunError);
    }
  });

  it('el constructor agrupa por mes y une contactos con empresas', async () => {
    const res = await runQuery(
      owner,
      'zerosoft',
      { kind: 'builder', table: 'contacts', joins: [{ table: 'companies', left: 'company_id', right: 'id', type: 'left' }], filters: [], aggregations: [{ fn: 'count' }], breakouts: [{ column: 'created_at', bucket: 'month' }], sort: [] },
      { fresh: true },
    );
    expect(res.rows).toEqual([
      ['2026-01-01', 2],
      ['2026-02-01', 1],
    ]);
    expect(res.columns[0].type).toBe('date');
    expect(pickViz(res.columns, res.rows.length).type).toBe('line');
  });

  it('cachea por persona y SQL', async () => {
    const q = { kind: 'sql' as const, sql: 'SELECT COUNT(*) AS n FROM companies', params: [] };
    const a = await runQuery(owner, 'zerosoft', q, { fresh: true });
    const b = await runQuery(owner, 'zerosoft', q);
    expect(a.cached).toBe(false);
    expect(b.cached).toBe(true);
    const c = await runQuery(member, 'zerosoft', q);
    expect(c.cached).toBe(false);
  });

  it('una base externa ajena al workspace no existe', async () => {
    await expect(compileQuery(owner, 'bid_nope', { kind: 'sql', sql: 'SELECT 1', params: [] })).rejects.toMatchObject({ code: 'database_not_found' });
  });
});

describe('colecciones, preguntas y tableros', () => {
  it('lo de la colección personal de otro no se ve; borrar una colección no borra lo de adentro', async () => {
    const mine = await personalCollection(member, 'Mine');
    const q = await createQuestion(member, { name: 'Private one', collectionId: mine.id, query: { kind: 'sql', sql: 'SELECT 1 AS one', params: [] } });
    expect(await getQuestion(noCrm, q.id)).toBeNull();
    expect(await getQuestion(owner, q.id)).not.toBeNull();
    const shared = await createCollection(owner, { name: 'Sales' });
    const q2 = await createQuestion(owner, { name: 'Shared one', collectionId: shared.id, query: { kind: 'sql', sql: 'SELECT 2 AS two', params: [] } });
    expect((await listItems(noCrm)).map((i) => i.name)).toContain('Shared one');
    expect((await listItems(noCrm)).map((i) => i.name)).not.toContain('Private one');
    await deleteCollection(owner, shared.id);
    expect((await getQuestion(owner, q2.id))?.collectionId).toBeNull();
  });

  it('tablero con filtro conectado y link público hasheado', async () => {
    const q = await createQuestion(owner, {
      name: 'By country',
      query: { kind: 'sql', sql: 'SELECT COUNT(*) AS n FROM contacts WHERE 1=1 [[AND first_name = {{who}}]]', params: [{ name: 'who', type: 'text' }] },
    });
    const d = await createDashboard(owner, { name: 'Board', filters: [{ id: 'who', name: 'Who', type: 'text' }] });
    const withCard = await addCard(owner, d.id, q.id);
    const card = withCard.cards[0];
    const updated = await updateDashboard(owner, d.id, { cards: [{ ...card, mapping: { who: { param: 'who' } } }] });
    const applied = withDashFilters(q, updated.cards[0].mapping, updated.filters, { who: 'Ana' });
    expect(applied.values).toEqual({ who: 'Ana' });
    const res = await runQuery(owner, 'zerosoft', applied.query, { values: applied.values, fresh: true });
    expect(res.rows[0][0]).toBe(1);
    await expect(createShare(member, 'dashboard', d.id)).rejects.toMatchObject({ code: 'admin_only' });
    const share = await createShare(owner, 'dashboard', d.id);
    expect(share.token).toMatch(/^[A-Za-z0-9_-]{43}$/);
    const row = (await getDb().prepare('SELECT token_hash FROM bi_shares WHERE id = ?').get(share.id)) as { token_hash: string };
    expect(row.token_hash).not.toBe(share.token);
    expect((await shareByToken(share.token!))?.targetId).toBe(d.id);
    expect(await shareByToken('x'.repeat(43))).toBeNull();
  });
});

describe('bases externas: host y configuración', () => {
  it('rechaza direcciones internas, metadata y hosts raros', async () => {
    const r = (ips: string[]) => async () => ips;
    await expect(resolveDbHost('db.example.com', r(['10.0.0.5']))).rejects.toBeInstanceOf(UnsafeHostError);
    await expect(resolveDbHost('db.example.com', r(['93.184.216.34', '127.0.0.1']))).rejects.toBeInstanceOf(UnsafeHostError);
    await expect(resolveDbHost('169.254.169.254')).rejects.toBeInstanceOf(UnsafeHostError);
    await expect(resolveDbHost('::ffff:7f00:1')).rejects.toBeInstanceOf(UnsafeHostError);
    await expect(resolveDbHost('localhost')).rejects.toBeInstanceOf(UnsafeHostError);
    expect(await resolveDbHost('db.example.com', r(['93.184.216.34']))).toBe('93.184.216.34');
    expect(validHostSyntax('/var/run/postgresql')).toBe(false);
    expect(validHostSyntax('db.example.com?sslmode=disable')).toBe(false);
  });

  it('metadata sigue bloqueada aunque se permitan direcciones privadas', async () => {
    process.env.ANALYTICS_ALLOW_PRIVATE_DB = '1';
    try {
      expect(await resolveDbHost('10.1.2.3')).toBe('10.1.2.3');
      await expect(resolveDbHost('169.254.169.254')).rejects.toBeInstanceOf(UnsafeHostError);
    } finally {
      delete process.env.ANALYTICS_ALLOW_PRIVATE_DB;
    }
  });

  it('valida la config y limpia el ; final', () => {
    expect(validateConfig({ engine: 'postgres', host: 'db.example.com', port: 5432, dbname: 'app', username: 'ro', password: 'x', ssl: 'require' })).toBe(true);
    expect(validateConfig({ engine: 'oracle' as never, host: 'db', port: 1, dbname: 'a', username: 'b', password: '', ssl: 'require' })).toBe(false);
    expect(validateConfig({ engine: 'mysql', host: 'db', port: 70000, dbname: 'a', username: 'b', password: '', ssl: 'require' })).toBe(false);
    expect(cleanUserSql('SELECT 1;;  ')).toBe('SELECT 1');
  });
});

describe('suscripciones y AI', () => {
  it('próximo envío a la hora local pedida', () => {
    const after = new Date('2026-11-09T12:30:00Z'); // lunes
    expect(nextRun({ cadence: 'daily', hour: 9, weekday: 1, timezone: 'America/Argentina/Buenos_Aires' }, after).toISOString()).toBe('2026-11-10T12:00:00.000Z');
    expect(nextRun({ cadence: 'weekly', hour: 9, weekday: 1, timezone: 'UTC' }, after).toISOString()).toBe('2026-11-16T09:00:00.000Z');
  });

  it('el modelo falso arma SQL que pasa la lista blanca', () => {
    const schema: SchemaTable[] = [{ name: 'deals', columns: [{ name: 'created_at', type: 'date' }] }];
    const a = fakeAnswer('deals per month', schema);
    expect(checkSqlWith(a.sql, [], ZS_GUARD)).toMatchObject({ ok: true });
  });
});
