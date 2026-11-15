import type { Migration } from '../migrations';

/**
 * Inbox y Lines: la línea no puede sincronizar el archivado con WhatsApp (le falta la clave de app-state o su
 * estado se rompió). Lo anota lib/wa-archive-sync.ts cuando Evolution responde `app_state_unavailable`, se borra
 * con el próximo archivado que sale bien o al volver a vincular, y la configuración de cada app lo muestra.
 */
export default {
  id: '20261115_0130_wa_archive_sync_error',
  up: async (c) => {
    for (const sql of [
      "ALTER TABLE inbox_accounts ADD COLUMN archive_sync_error TEXT NOT NULL DEFAULT ''",
      "ALTER TABLE groups_numbers ADD COLUMN archive_sync_error TEXT NOT NULL DEFAULT ''",
    ]) {
      try {
        await c.execute(sql);
      } catch (err) {
        if (!/duplicate column/i.test(String(err))) throw err;
      }
    }
  },
} satisfies Migration;
