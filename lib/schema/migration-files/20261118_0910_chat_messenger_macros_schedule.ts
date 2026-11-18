import type { Migration } from '../migrations';

/**
 * Chat, contra Intercom: fuente, adjuntos y tiempo de respuesta del messenger,
 * uso de respuestas guardadas, campañas programadas y opciones propias de
 * posponer. Solo agrega columnas con valor por defecto, un índice y una tabla.
 *
 * Tolera correr dos veces y en paralelo (columna repetida, IF NOT EXISTS).
 */
export default {
  id: '20261118_0910_chat_messenger_macros_schedule',
  up: async (c) => {
    for (const sql of [
      "ALTER TABLE chat_widgets ADD COLUMN font TEXT NOT NULL DEFAULT 'system'",
      "ALTER TABLE chat_widgets ADD COLUMN visitor_attachments TEXT NOT NULL DEFAULT 'all'",
      "ALTER TABLE chat_widgets ADD COLUMN reply_time TEXT NOT NULL DEFAULT ''",
      'ALTER TABLE chat_canned_responses ADD COLUMN use_count INTEGER NOT NULL DEFAULT 0',
      'ALTER TABLE chat_canned_responses ADD COLUMN last_used_at TEXT',
      'ALTER TABLE chat_campaigns ADD COLUMN scheduled_at TEXT',
      'ALTER TABLE chat_campaigns ADD COLUMN schedule_error TEXT',
    ]) {
      try {
        await c.execute(sql);
      } catch (err) {
        if (!/duplicate column/i.test(String(err))) throw err;
      }
    }
    await c.executeMultiple(`
      CREATE INDEX IF NOT EXISTS idx_chat_campaigns_due ON chat_campaigns(scheduled_at) WHERE scheduled_at IS NOT NULL;
      CREATE TABLE IF NOT EXISTS chat_snooze_options (
        id TEXT PRIMARY KEY,
        workspace_id TEXT NOT NULL,
        label TEXT NOT NULL,
        minutes INTEGER NOT NULL,
        team_id TEXT,
        created_at TEXT NOT NULL DEFAULT (datetime('now'))
      );
      CREATE INDEX IF NOT EXISTS idx_chat_snooze_options_ws ON chat_snooze_options(workspace_id);
    `);
  },
} satisfies Migration;
