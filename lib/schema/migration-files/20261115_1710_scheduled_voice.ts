import type { Migration } from '../migrations';

/**
 * Inbox y Lines: una nota de voz programada ("Enviar más tarde" desde la
 * grabadora). `media_kind` = 'voice' hace que el archivo salga como nota de
 * voz (ptt) y no como adjunto; `media_duration` son los segundos grabados
 * (para mostrarla antes de que salga). En Inbox, `reply_to` es el mensaje
 * (nuestro id) que cita un programado.
 */
export default {
  id: '20261115_1710_scheduled_voice',
  up: async (c) => {
    for (const sql of [
      "ALTER TABLE inbox_scheduled ADD COLUMN media_kind TEXT NOT NULL DEFAULT ''",
      'ALTER TABLE inbox_scheduled ADD COLUMN media_duration INTEGER NOT NULL DEFAULT 0',
      "ALTER TABLE inbox_scheduled ADD COLUMN reply_to TEXT NOT NULL DEFAULT ''",
      "ALTER TABLE groups_broadcasts ADD COLUMN media_kind TEXT NOT NULL DEFAULT ''",
      'ALTER TABLE groups_broadcasts ADD COLUMN media_duration INTEGER NOT NULL DEFAULT 0',
    ]) {
      try {
        await c.execute(sql);
      } catch (err) {
        if (!/duplicate column/i.test(String(err))) throw err;
      }
    }
  },
} satisfies Migration;
