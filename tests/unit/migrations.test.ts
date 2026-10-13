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

  it('015_ai_chat_bot_source reconstruye chat_widgets conservando filas e índices', async () => {
    const client = freshClient();
    const idx = MIGRATIONS.findIndex((m) => m.id === '015_ai_chat_bot_source');
    await runMigrations(client, MIGRATIONS.slice(0, idx));
    await client.execute("INSERT INTO users (id, email, handle) VALUES ('u1', 'u1@test.local', 'u1')");
    await client.execute(
      "INSERT INTO chat_widgets (id, user_id, name, bot_enabled, bot_source) VALUES ('w1', 'u1', 'W', 1, 'docs')",
    );
    await expect(
      client.execute("INSERT INTO chat_widgets (id, user_id, name, bot_source) VALUES ('w2', 'u1', 'W2', 'ai')"),
    ).rejects.toThrow(/CHECK/);

    await runMigrations(client);
    const row = (await client.execute("SELECT name, bot_enabled, bot_source FROM chat_widgets WHERE id = 'w1'")).rows[0];
    expect(row).toMatchObject({ name: 'W', bot_enabled: 1, bot_source: 'docs' });
    await client.execute("INSERT INTO chat_widgets (id, user_id, name, bot_source) VALUES ('w2', 'u1', 'W2', 'ai')");
    await expect(
      client.execute("INSERT INTO chat_widgets (id, user_id, name, bot_source) VALUES ('w3', 'u1', 'W3', 'nope')"),
    ).rejects.toThrow(/CHECK/);
    const indexes = (
      await client.execute("SELECT name FROM sqlite_master WHERE type = 'index' AND tbl_name = 'chat_widgets'")
    ).rows.map((r) => r.name);
    expect(indexes).toEqual(expect.arrayContaining(['idx_chat_widgets_user', 'idx_chat_widgets_team']));
  });
});
