import type { Migration } from '../migrations';

/**
 * "Traer mensajes que faltan" (lib/wa-history-gaps.ts, refreshChatHistory): cuándo se pidió por última vez, hasta qué
 * mensaje se cuenta (`refresh_cut`, la hora tal como está guardada), cuántos había hasta ahí (`refresh_base`), si el
 * teléfono respondió y cuántos pedidos salieron. Con eso la pantalla dice qué trajo.
 */
export default {
  id: '20261115_2320_wa_history_refresh',
  up: async (c) => {
    for (const sql of [
      'ALTER TABLE wa_history_fetch ADD COLUMN refresh_at TEXT',
      "ALTER TABLE wa_history_fetch ADD COLUMN refresh_cut TEXT NOT NULL DEFAULT ''",
      'ALTER TABLE wa_history_fetch ADD COLUMN refresh_base INTEGER NOT NULL DEFAULT 0',
      'ALTER TABLE wa_history_fetch ADD COLUMN refresh_answered INTEGER NOT NULL DEFAULT 0',
      'ALTER TABLE wa_history_fetch ADD COLUMN refresh_requests INTEGER NOT NULL DEFAULT 0',
    ]) {
      try {
        await c.execute(sql);
      } catch (err) {
        if (!/duplicate column/i.test(String(err))) throw err;
      }
    }
  },
} satisfies Migration;
