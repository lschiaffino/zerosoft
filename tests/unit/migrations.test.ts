import { describe, expect, it } from 'vitest';
import { createClient } from '@libsql/client';
import os from 'os';
import path from 'path';
import { MIGRATIONS, runMigrations } from '@/lib/schema/migrations';

function freshClient() {
  return createClient({ url: `file:${path.join(os.tmpdir(), `mig-${crypto.randomUUID()}.db`)}` });
}

describe('migraciones versionadas', () => {
  it('aplica todas en una base vacía y ninguna la segunda vez', async () => {
    const client = freshClient();
    expect(await runMigrations(client)).toEqual(MIGRATIONS.map((m) => m.id));
    expect(await runMigrations(client)).toEqual([]);
  });

  it('tolera dos instancias migrando a la vez', async () => {
    const client = freshClient();
    await Promise.all([runMigrations(client), runMigrations(client)]);
    const rows = (await client.execute('SELECT id FROM schema_migrations')).rows.map((r) => r.id);
    expect(rows.sort()).toEqual(MIGRATIONS.map((m) => m.id).sort());
    const cols = (await client.execute('PRAGMA table_info(track_projects)')).rows.map((r) => r.name);
    expect(cols).toContain('owner_id');
  });
});
