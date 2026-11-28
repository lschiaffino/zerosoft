import type { Migration } from '../migrations';

/**
 * Lines: historial de mensajes de Periskope (lib/groups-periskope-history.ts).
 * Una fila por workspace con el avance (el cron la retoma) y la clave de la API
 * cifrada, que se borra al terminar; y una fila por chat con el offset donde va.
 */
export default {
  id: '20261124_2300_groups_periskope_history',
  up: async (c) => {
    await c.execute(`CREATE TABLE IF NOT EXISTS groups_periskope_history (
      ws TEXT PRIMARY KEY,
      status TEXT NOT NULL DEFAULT 'queued',
      phase TEXT NOT NULL DEFAULT 'chats',
      key_sealed TEXT NOT NULL DEFAULT '',
      include_media INTEGER NOT NULL DEFAULT 1,
      end_time TEXT NOT NULL DEFAULT '',
      chat_cursor INTEGER NOT NULL DEFAULT 0,
      chats_total INTEGER NOT NULL DEFAULT 0,
      chats_done INTEGER NOT NULL DEFAULT 0,
      chats_skipped INTEGER NOT NULL DEFAULT 0,
      messages INTEGER NOT NULL DEFAULT 0,
      duplicates INTEGER NOT NULL DEFAULT 0,
      media_saved INTEGER NOT NULL DEFAULT 0,
      media_failed INTEGER NOT NULL DEFAULT 0,
      reactions INTEGER NOT NULL DEFAULT 0,
      notes INTEGER NOT NULL DEFAULT 0,
      error TEXT NOT NULL DEFAULT '',
      attempts INTEGER NOT NULL DEFAULT 0,
      claimed_until TEXT,
      started_at TEXT NOT NULL,
      finished_at TEXT,
      updated_at TEXT NOT NULL
    )`);
    await c.execute("CREATE INDEX IF NOT EXISTS idx_groups_psk_history_due ON groups_periskope_history(status) WHERE status IN ('queued', 'running')");
    await c.execute(`CREATE TABLE IF NOT EXISTS groups_periskope_history_chats (
      ws TEXT NOT NULL,
      psk_chat_id TEXT NOT NULL,
      chat_id TEXT,
      msg_offset INTEGER NOT NULL DEFAULT 0,
      done INTEGER NOT NULL DEFAULT 0,
      messages INTEGER NOT NULL DEFAULT 0,
      PRIMARY KEY (ws, psk_chat_id)
    )`);
  },
} satisfies Migration;
