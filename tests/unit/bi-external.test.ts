/**
 * Conector de Postgres de Analytics contra un Postgres real en proceso
 * (PGlite con el protocolo de red): solo lectura, tope de filas, una sola
 * sentencia, esquema y errores sin la contraseña.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { PGlite } from '@electric-sql/pglite';
import { PGLiteSocketServer } from '@electric-sql/pglite-socket';
import { ExternalDbError, introspect, runExternal, type DbConfig } from '@/lib/bi/external';
import { buildSql } from '@/lib/bi/builder';

const PORT = 55_000 + (process.pid % 900);
let db: PGlite;
let server: PGLiteSocketServer;
const cfg: DbConfig = { engine: 'postgres', host: '127.0.0.1', port: PORT, dbname: 'postgres', username: 'postgres', password: 's3cret-pw', ssl: 'disable' };

beforeAll(async () => {
  process.env.ANALYTICS_ALLOW_PRIVATE_DB = '1';
  db = await PGlite.create();
  await db.exec(`
    CREATE TABLE orders (id serial PRIMARY KEY, customer text, total numeric(10,2), created_at timestamp);
    INSERT INTO orders (customer, total, created_at)
      SELECT 'c' || (g % 3), g * 1.5, timestamp '2026-01-01' + (g || ' days')::interval FROM generate_series(1, 30) g;
  `);
  server = new PGLiteSocketServer({ db, port: PORT, host: '127.0.0.1' });
  await server.start();
});

afterAll(async () => {
  delete process.env.ANALYTICS_ALLOW_PRIVATE_DB;
  await server?.stop();
  await db?.close();
});

describe('Postgres externo', () => {
  it('lee con tipos y respeta el tope de filas', async () => {
    const res = await runExternal(cfg, 'SELECT id, customer, total, created_at FROM orders ORDER BY id', 10);
    expect(res.rows).toHaveLength(10);
    expect(res.truncated).toBe(true);
    expect(res.columns.map((c) => c.type)).toEqual(['number', 'text', 'number', 'date']);
    expect(res.rows[0][2]).toBe(1.5);
  });

  it('no escribe: la transacción es de solo lectura y no entra una segunda sentencia', async () => {
    await expect(runExternal(cfg, "SELECT 1 AS a) x; INSERT INTO orders (customer) VALUES ('evil'); SELECT * FROM (SELECT 1", 10)).rejects.toBeInstanceOf(ExternalDbError);
    await expect(runExternal(cfg, "WITH x AS (INSERT INTO orders (customer) VALUES ('evil') RETURNING id) SELECT * FROM x", 10)).rejects.toBeInstanceOf(ExternalDbError);
    const n = await runExternal(cfg, "SELECT COUNT(*) AS n FROM orders WHERE customer = 'evil'", 10);
    expect(n.rows[0][0]).toBe(0);
  });

  it('lee el esquema y el constructor arma SQL que corre', async () => {
    const tables = await introspect(cfg);
    const orders = tables.find((t) => t.name === 'orders');
    expect(orders?.columns.map((c) => c.name)).toEqual(['id', 'customer', 'total', 'created_at']);
    const { sql } = buildSql(
      { kind: 'builder', table: 'orders', joins: [], filters: [{ column: 'customer', op: '=', value: 'c1' }], aggregations: [{ fn: 'sum', column: 'total' }], breakouts: [{ column: 'created_at', bucket: 'month' }], sort: [] },
      tables,
      'postgres',
    );
    const res = await runExternal(cfg, sql, 100);
    expect(res.rows.length).toBeGreaterThan(0);
    expect(res.columns.map((c) => c.name)).toEqual(['created_at', 'sum_total']);
  });

  it('los errores no muestran la contraseña y la conexión fallida es connect_failed', async () => {
    await expect(runExternal({ ...cfg, port: PORT + 1 }, 'SELECT 1', 1)).rejects.toMatchObject({ code: 'connect_failed' });
    const err = await runExternal(cfg, "SELECT 's3cret-pw' + 1", 1).catch((e: ExternalDbError) => e);
    expect(err).toBeInstanceOf(ExternalDbError);
    expect(String((err as ExternalDbError).detail)).not.toContain('s3cret-pw');
  });

  it('sin permiso para la red privada, 127.0.0.1 se rechaza antes de conectar', async () => {
    delete process.env.ANALYTICS_ALLOW_PRIVATE_DB;
    try {
      await expect(runExternal(cfg, 'SELECT 1', 1)).rejects.toMatchObject({ code: 'private_host' });
    } finally {
      process.env.ANALYTICS_ALLOW_PRIVATE_DB = '1';
    }
  });
});
