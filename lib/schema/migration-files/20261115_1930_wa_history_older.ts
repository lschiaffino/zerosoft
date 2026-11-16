import type { Migration } from '../migrations';

/**
 * "Cargar mensajes anteriores" (lib/wa-history-gaps.ts): cuándo se le pidió al teléfono por última vez el historial
 * anterior de un chat, desde qué mensaje, y cuántas veces seguidas no trajo nada (para espaciar los pedidos).
 */
export default {
  id: '20261115_1930_wa_history_older',
  up: async (c) => {
    for (const sql of [
      'ALTER TABLE wa_history_fetch ADD COLUMN older_at TEXT',
      "ALTER TABLE wa_history_fetch ADD COLUMN older_anchor TEXT NOT NULL DEFAULT ''",
      'ALTER TABLE wa_history_fetch ADD COLUMN older_empty INTEGER NOT NULL DEFAULT 0',
    ]) {
      try {
        await c.execute(sql);
      } catch (err) {
        if (!/duplicate column/i.test(String(err))) throw err;
      }
    }
  },
} satisfies Migration;
