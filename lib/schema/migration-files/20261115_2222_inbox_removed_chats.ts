import type { Migration } from '../migrations';
import { MERGE_PAIRS_DDL } from '../../wa-dedupe';

/**
 * Inbox: "Sacar de Inbox" deja de borrar el chat. removed_at marca cuándo se
 * sacó: el chat y sus mensajes quedan guardados (igual de privados), fuera de
 * todas las vistas, y se pueden recuperar desde "Sacados de Inbox" hasta que el
 * cron los borra a los 30 días (lib/inbox/removed.ts). Los índices parciales
 * sirven a esa vista, a su contador y a la purga (pocas filas).
 *
 * Juntar el chat por lid con el del teléfono (lib/wa-dedupe.ts) borra el
 * perdedor: si estaba sacado, el trigger deja afuera también al que queda, así
 * un chat sacado no vuelve por juntarse. Va como trigger y no en el UPDATE del
 * merge porque migraciones anteriores corren ese merge antes de que exista la
 * columna.
 */
export default {
  id: '20261115_2222_inbox_removed_chats',
  up: async (c) => {
    try {
      await c.execute('ALTER TABLE inbox_threads ADD COLUMN removed_at TEXT');
    } catch (err) {
      if (!/duplicate column/i.test(String(err))) throw err;
    }
    await c.execute('CREATE INDEX IF NOT EXISTS idx_inbox_threads_removed ON inbox_threads(owner_id, removed_at) WHERE removed_at IS NOT NULL');
    await c.execute('CREATE INDEX IF NOT EXISTS idx_inbox_threads_removed_at ON inbox_threads(removed_at) WHERE removed_at IS NOT NULL');
    await c.execute(MERGE_PAIRS_DDL);
    await c.execute(`CREATE TRIGGER IF NOT EXISTS trg_inbox_removed_merge AFTER DELETE ON inbox_threads WHEN OLD.removed_at IS NOT NULL BEGIN
      UPDATE inbox_threads SET removed_at = OLD.removed_at
        WHERE removed_at IS NULL AND id IN (SELECT survivor FROM wa_merge_pairs WHERE app = 'inbox' AND loser = OLD.id AND survivor IS NOT NULL);
    END`);
  },
} satisfies Migration;
