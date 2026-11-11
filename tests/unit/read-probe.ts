/**
 * Para los tests de lecturas: anota las consultas que una función manda a la
 * base y mira su plan (EXPLAIN QUERY PLAN) para saber si alguna recorre una
 * tabla entera.
 */
import { createClient, type Client, type InValue } from '@libsql/client';
import { ensureMigrated, getClient } from '@/lib/db';

export interface Seen {
  sql: string;
  args: InValue[];
}

/** Corre `fn` anotando cada consulta que llega a la base (sueltas, en transacción o en tanda). */
export async function recording(fn: () => Promise<unknown>): Promise<Seen[]> {
  await ensureMigrated();
  const client = getClient() as unknown as Record<string, (...a: unknown[]) => unknown>;
  const seen: Seen[] = [];
  const note = (stmt: unknown, args?: unknown) => {
    if (typeof stmt === 'string') seen.push({ sql: stmt, args: (args as InValue[]) ?? [] });
    else seen.push({ sql: (stmt as Seen).sql, args: (stmt as Seen).args ?? [] });
  };
  const execute = client.execute;
  const transaction = client.transaction;
  const batch = client.batch;
  client.execute = (stmt: unknown, args?: unknown) => {
    note(stmt, args);
    return execute.call(client, stmt, args);
  };
  client.transaction = async (mode: unknown) => {
    const tx = (await transaction.call(client, mode)) as Record<string, (...a: unknown[]) => unknown>;
    const inner = tx.execute;
    tx.execute = (stmt: unknown) => {
      note(stmt);
      return inner.call(tx, stmt);
    };
    return tx;
  };
  client.batch = (stmts: unknown, mode: unknown) => {
    for (const s of stmts as unknown[]) note(s);
    return batch.call(client, stmts, mode);
  };
  try {
    await fn();
  } finally {
    client.execute = execute;
    client.transaction = transaction;
    client.batch = batch;
  }
  return seen;
}

let planner: Client | null = null;

/**
 * El plan de una consulta. Se pide por una conexión aparte: en SQLite local, el EXPLAIN de una escritura deja
 * su sentencia abierta en la conexión, y con una sentencia de escritura abierta nada de lo que esa conexión
 * escribe después se confirma (queda a merced del próximo ROLLBACK). Los tests no tienen que ensuciar la
 * conexión de la app.
 */
export async function planOf(sql: string, args: InValue[] = []): Promise<string[]> {
  await ensureMigrated();
  planner ??= createClient({ url: process.env.TURSO_DATABASE_URL! });
  const r = await planner.execute({ sql: `EXPLAIN QUERY PLAN ${sql}`, args });
  return r.rows.map((x) => String(x.detail));
}

/** Pasos del plan que recorren una tabla entera (no un índice, una subconsulta ni una función de tabla). */
export function tableScans(plan: string[]): string[] {
  return plan.filter((d) => /^SCAN /.test(d) && !/USING (COVERING )?INDEX|USING INTEGER PRIMARY KEY|VIRTUAL TABLE|CONSTANT ROW|^SCAN \(/.test(d));
}

export async function scansOf(seen: Seen[], allow: RegExp[] = []): Promise<string[]> {
  const out: string[] = [];
  for (const s of seen) {
    if (allow.some((re) => re.test(s.sql))) continue;
    const bad = tableScans(await planOf(s.sql, s.args));
    if (bad.length) out.push(`${bad.join(' | ')} <= ${s.sql.replace(/\s+/g, ' ').slice(0, 160)}`);
  }
  return out;
}

/**
 * Corre `fn` contando las idas a la base: una consulta suelta es una ida, una
 * tanda (batch) es una sola por más sentencias que lleve. En Turso cada ida es
 * una vuelta de red, así que esto es lo que se nota en el tiempo.
 */
export async function roundTrips(fn: () => Promise<unknown>): Promise<{ trips: number; statements: number; sql: string[] }> {
  await ensureMigrated();
  const client = getClient() as unknown as Record<string, (...a: unknown[]) => unknown>;
  const out = { trips: 0, statements: 0, sql: [] as string[] };
  const sqlOf = (s: unknown) => (typeof s === 'string' ? s : String((s as { sql?: string })?.sql ?? ''));
  const execute = client.execute;
  const batch = client.batch;
  client.execute = (stmt: unknown, args?: unknown) => {
    out.trips++;
    out.statements++;
    out.sql.push(sqlOf(stmt));
    return execute.call(client, stmt, args);
  };
  client.batch = (stmts: unknown, mode: unknown) => {
    out.trips++;
    out.statements += (stmts as unknown[]).length;
    out.sql.push(...(stmts as unknown[]).map(sqlOf));
    return batch.call(client, stmts, mode);
  };
  try {
    await fn();
  } finally {
    client.execute = execute;
    client.batch = batch;
  }
  return out;
}
