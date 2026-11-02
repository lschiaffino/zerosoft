import { describe, expect, it } from 'vitest';
import { ensureMigrated, getClient, getDb } from '@/lib/db';

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
    const rows = (await getDb().prepare('SELECT v FROM db_busy_probe ORDER BY v').all()) as Array<{ v: string }>;
    expect(rows.map((r) => r.v)).toEqual(['afuera', 'tx']);
  });
});
