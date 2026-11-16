import type { Migration } from '../migrations';

/**
 * Inbox y Lines: posponer un chat lo archiva, y al volver se desarchiva.
 *
 * - `snooze_archived` (las dos apps): 1 si el chat no estaba archivado cuando se pospuso. Deshacer o cancelar el
 *   pospuesto lo devuelve a la bandeja solo en ese caso; uno que ya estaba archivado sigue archivado.
 * - `groups_chats.snoozed_until`: Lines no tenía posponer.
 * - Los chats de Inbox que ya estaban pospuestos no aparecían ni en la bandeja ni en Archivados: quedan archivados,
 *   y los de WhatsApp se anotan para archivarlos también en el teléfono (lib/wa-archive-sync.ts los manda con su
 *   ritmo desde el cron).
 *
 * Tolera correr dos veces y en paralelo: la segunda vez no encuentra filas por arreglar.
 */
export default {
  id: '20261115_1900_snooze_archives',
  up: async (c) => {
    for (const sql of [
      'ALTER TABLE inbox_threads ADD COLUMN snooze_archived INTEGER NOT NULL DEFAULT 0',
      'ALTER TABLE groups_chats ADD COLUMN snoozed_until TEXT',
      'ALTER TABLE groups_chats ADD COLUMN snooze_archived INTEGER NOT NULL DEFAULT 0',
    ]) {
      try {
        await c.execute(sql);
      } catch (err) {
        if (!/duplicate column/i.test(String(err))) throw err;
      }
    }
    await c.execute('CREATE INDEX IF NOT EXISTS idx_groups_chats_snoozed ON groups_chats(snoozed_until) WHERE snoozed_until IS NOT NULL');
    const now = new Date().toISOString();
    const legacy = 'snoozed_until IS NOT NULL AND snoozed_until > ? AND archived_at IS NULL AND done_at IS NULL';
    await c.execute({
      sql: `INSERT INTO wa_archive_push (app, chat_id, scope_id, archived, version, requested_at, attempts, next_at, done_at, last_error)
            SELECT 'inbox', id, owner_id, 1, 1, ?, 0, ?, NULL, '' FROM inbox_threads WHERE channel = 'whatsapp' AND ${legacy}
            ON CONFLICT(app, chat_id) DO UPDATE SET prev_archived = wa_archive_push.archived, prev_at = wa_archive_push.requested_at,
              archived = 1, version = wa_archive_push.version + 1, requested_at = excluded.requested_at, attempts = 0,
              next_at = excluded.next_at, claimed_until = NULL, done_at = NULL, last_error = ''`,
      args: [now, now, now],
    });
    await c.execute({ sql: `UPDATE inbox_threads SET archived_at = ?, snooze_archived = 1 WHERE ${legacy}`, args: [now, now] });
  },
} satisfies Migration;
