/**
 * Para los tests de lecturas: anota las consultas que una función manda a la
 * base y mira su plan (EXPLAIN QUERY PLAN) para saber si alguna recorre una
 * tabla entera.
 */
import type { InValue } from '@libsql/client';
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

export async function planOf(sql: string, args: InValue[] = []): Promise<string[]> {
  const r = await getClient().execute({ sql: `EXPLAIN QUERY PLAN ${sql}`, args });
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
