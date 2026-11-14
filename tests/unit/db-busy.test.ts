import { describe, expect, it } from 'vitest';
import { createClient } from '@libsql/client';
import { ensureMigrated, getClient, getDb } from '@/lib/db';

/** Otra conexión, como la del test del e2e: ve solo lo que quedó con commit y choca si la base sigue tomada. */
async function fromOutside<T>(fn: (c: ReturnType<typeof createClient>) => Promise<T>): Promise<T> {
  const c = createClient({ url: process.env.TURSO_DATABASE_URL! });
  try {
    return await fn(c);
  } finally {
    c.close();
  }
}

/** SQLite local: una escritura del mismo proceso durante una transacción espera y entra, sin perderse. */
describe('getDb con una transacción abierta', () => {
  it('la escritura espera al commit y la transacción siguiente también', async () => {
    await ensureMigrated();
    await getDb().exec('CREATE TABLE IF NOT EXISTS db_busy_probe (v TEXT)');
    const tx = await getClient().transaction('write');
    await tx.execute({ sql: 'INSERT INTO db_busy_probe (v) VALUES (?)', args: ['tx'] });
    const write = getDb().prepare('INSERT INTO db_busy_probe (v) VALUES (?)').run('afuera');
    const next = getClient().transaction('write');
    await new Promise((done) => setTimeout(done, 30));
    await tx.commit();
    const second = await next;
    await second.rollback();
    await write;
    const rows = await fromOutside(async (c) => (await c.execute('SELECT v FROM db_busy_probe ORDER BY v')).rows.map((r) => String(r.v)));
    expect(rows).toEqual(['afuera', 'tx']);
  });
});

/** SQLite local: lo que reintenta tiene que quedar con commit y soltar la base. */
describe('reintentos con la base tomada', () => {
  it('el cliente crudo también reintenta si otra conexión tiene la base', async () => {
    await ensureMigrated();
    await getDb().exec('CREATE TABLE IF NOT EXISTS db_raw_probe (v TEXT)');
    const tx = await getClient().transaction('write');
    await tx.execute({ sql: 'INSERT INTO db_raw_probe (v) VALUES (?)', args: ['tx'] });
    const raw = getClient().execute({ sql: 'INSERT INTO db_raw_probe (v) VALUES (?)', args: ['crudo'] });
    const batch = getClient().batch([{ sql: 'INSERT INTO db_raw_probe (v) VALUES (?)', args: ['lote'] }], 'write');
    await new Promise((done) => setTimeout(done, 30));
    await tx.commit();
    await Promise.all([raw, batch]);
    // Desde otra conexión: las tres con commit y la base libre (antes el reintento quedaba sin commit y con el lock).
    const rows = await fromOutside(async (c) => (await c.execute('SELECT v FROM db_raw_probe ORDER BY v')).rows.map((r) => String(r.v)));
    expect(rows).toEqual(['crudo', 'lote', 'tx']);
    await fromOutside((c) => c.execute("INSERT INTO db_raw_probe (v) VALUES ('afuera')"));
  });
});
