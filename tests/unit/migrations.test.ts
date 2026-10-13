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
    // Como en producción (lib/db.ts): FKs activas. El rebuild no debe borrar
    // en cascada las conversaciones del widget.
    await client.execute('PRAGMA foreign_keys = ON');
    await client.execute("INSERT INTO chat_visitors (id, widget_id, external_id) VALUES ('v1', 'w1', 'ext1')");
    await client.execute("INSERT INTO chat_conversations (id, widget_id, visitor_id) VALUES ('c1', 'w1', 'v1')");

    await runMigrations(client);
    const convs = (await client.execute("SELECT id FROM chat_conversations WHERE widget_id = 'w1'")).rows;
    expect(convs.map((r) => r.id)).toEqual(['c1']);
    const fkErrors = (await client.execute('PRAGMA foreign_key_check')).rows;
    expect(fkErrors).toEqual([]);
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

  it("019_agents_chat_widget_agent agrega 'agent' + agent_id a chat_widgets sin perder conversaciones", async () => {
    const client = freshClient();
    const idx = MIGRATIONS.findIndex((m) => m.id === '019_agents_chat_widget_agent');
    await runMigrations(client, MIGRATIONS.slice(0, idx));
    await client.execute("INSERT INTO users (id, email, handle) VALUES ('u1', 'u1@test.local', 'u1')");
    await client.execute(
      "INSERT INTO chat_widgets (id, user_id, name, bot_enabled, bot_source) VALUES ('w1', 'u1', 'W', 1, 'ai')",
    );
    await expect(
      client.execute("INSERT INTO chat_widgets (id, user_id, name, bot_source) VALUES ('w2', 'u1', 'W2', 'agent')"),
    ).rejects.toThrow(/CHECK/);
    await client.execute('PRAGMA foreign_keys = ON');
    await client.execute("INSERT INTO chat_visitors (id, widget_id, external_id) VALUES ('v1', 'w1', 'ext1')");
    await client.execute("INSERT INTO chat_conversations (id, widget_id, visitor_id) VALUES ('c1', 'w1', 'v1')");
    await client.execute("INSERT INTO chat_messages (id, conversation_id, sender_type, body) VALUES ('m1', 'c1', 'visitor', 'hola')");

    await runMigrations(client);
    expect((await client.execute("SELECT id FROM chat_conversations WHERE widget_id = 'w1'")).rows.map((r) => r.id)).toEqual(['c1']);
    expect((await client.execute("SELECT id FROM chat_messages WHERE conversation_id = 'c1'")).rows).toHaveLength(1);
    expect((await client.execute('PRAGMA foreign_key_check')).rows).toEqual([]);
    const row = (await client.execute("SELECT name, bot_enabled, bot_source, agent_id FROM chat_widgets WHERE id = 'w1'")).rows[0];
    expect(row).toMatchObject({ name: 'W', bot_enabled: 1, bot_source: 'ai', agent_id: null });
    await client.execute(
      "INSERT INTO chat_widgets (id, user_id, name, bot_source, agent_id) VALUES ('w2', 'u1', 'W2', 'agent', 'a1')",
    );
    for (const v of ['canned', 'docs', 'ai']) {
      await client.execute({ sql: "INSERT INTO chat_widgets (id, user_id, name, bot_source) VALUES (?, 'u1', 'X', ?)", args: [`w-${v}`, v] });
    }
    await expect(
      client.execute("INSERT INTO chat_widgets (id, user_id, name, bot_source) VALUES ('w3', 'u1', 'W3', 'nope')"),
    ).rejects.toThrow(/CHECK/);
    const indexes = (
      await client.execute("SELECT name FROM sqlite_master WHERE type = 'index' AND tbl_name = 'chat_widgets'")
    ).rows.map((r) => r.name);
    expect(indexes).toEqual(expect.arrayContaining(['idx_chat_widgets_user', 'idx_chat_widgets_team']));
    // Idempotente: correrla de nuevo no rompe nada.
    await MIGRATIONS[idx].up(client);
  });

  it("017_flow_feedback_product agrega 'flow' al CHECK de feedback conservando filas e índices", async () => {
    const client = freshClient();
    const idx = MIGRATIONS.findIndex((m) => m.id === '017_flow_feedback_product');
    await runMigrations(client, MIGRATIONS.slice(0, idx));
    await client.execute(
      "INSERT INTO feedback (id, kind, product, message) VALUES ('f1', 'idea', 'crm', 'hola')",
    );
    await expect(
      client.execute("INSERT INTO feedback (id, kind, product, message) VALUES ('f2', 'idea', 'flow', 'x')"),
    ).rejects.toThrow(/CHECK/);
    await client.execute('PRAGMA foreign_keys = ON');
    await runMigrations(client, MIGRATIONS.slice(0, idx + 1));
    const rows = (await client.execute('SELECT id, product FROM feedback')).rows;
    expect(rows.map((r) => [r.id, r.product])).toEqual([['f1', 'crm']]);
    await client.execute("INSERT INTO feedback (id, kind, product, message) VALUES ('f2', 'idea', 'flow', 'x')");
    await expect(
      client.execute("INSERT INTO feedback (id, kind, product, message) VALUES ('f3', 'idea', 'nope', 'x')"),
    ).rejects.toThrow(/CHECK/);
    const indexes = (
      await client.execute("SELECT name FROM sqlite_master WHERE type = 'index' AND tbl_name = 'feedback'")
    ).rows.map((r) => r.name);
    expect(indexes).toContain('idx_feedback_created');
    expect((await client.execute('PRAGMA foreign_key_check')).rows).toEqual([]);
  });
});
