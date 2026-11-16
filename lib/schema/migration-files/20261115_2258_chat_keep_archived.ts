import type { Migration } from '../migrations';

/**
 * Inbox y Lines: "Mantener archivado" por chat (`keep_archived`, 0 o 1).
 *
 * La regla vive en la base: un trigger por tabla deshace cualquier cambio que saque de Archivados a un chat con la
 * marca (un mensaje que llega, uno que sale, el teléfono, el fin de un pospuesto). Así ningún camino tiene que
 * acordarse. Desarchivar a mano apaga la marca en el mismo UPDATE (NEW.keep_archived = 0), y eso sí pasa.
 *
 * OJO: un trigger vive con su tabla. Una migración que reconstruya inbox_threads o groups_chats tiene que recrearlos.
 * Tolera correr dos veces y en paralelo.
 */
export const KEEP_ARCHIVED_TRIGGERS: Array<[string, string]> = [
  [
    'inbox_keep_archived',
    `AFTER UPDATE OF archived_at ON inbox_threads WHEN OLD.archived_at IS NOT NULL AND NEW.archived_at IS NULL AND NEW.keep_archived = 1
     BEGIN UPDATE inbox_threads SET archived_at = OLD.archived_at WHERE id = NEW.id; END`,
  ],
  [
    'lines_keep_archived',
    `AFTER UPDATE OF archived_at ON groups_chats WHEN OLD.archived_at IS NOT NULL AND NEW.archived_at IS NULL AND NEW.keep_archived = 1
     BEGIN UPDATE groups_chats SET archived_at = OLD.archived_at WHERE id = NEW.id; END`,
  ],
  // Prender o apagar la marca cambia la fila de la lista (el ícono): avisa en vivo como los otros cambios.
  [
    'inbox_keep_archived_live',
    `AFTER UPDATE OF keep_archived ON inbox_threads WHEN OLD.keep_archived IS NOT NEW.keep_archived
     BEGIN INSERT INTO wa_live_events (app, scope_id, chat_id) VALUES ('inbox', NEW.owner_id, NEW.id); END`,
  ],
  [
    'lines_keep_archived_live',
    `AFTER UPDATE OF keep_archived ON groups_chats WHEN OLD.keep_archived IS NOT NEW.keep_archived
     BEGIN INSERT INTO wa_live_events (app, scope_id, chat_id, number_id) VALUES ('lines', NEW.user_id, NEW.id, NEW.number_id); END`,
  ],
];

export default {
  id: '20261115_2258_chat_keep_archived',
  up: async (c) => {
    for (const sql of [
      'ALTER TABLE inbox_threads ADD COLUMN keep_archived INTEGER NOT NULL DEFAULT 0',
      'ALTER TABLE groups_chats ADD COLUMN keep_archived INTEGER NOT NULL DEFAULT 0',
    ]) {
      try {
        await c.execute(sql);
      } catch (err) {
        if (!/duplicate column/i.test(String(err))) throw err;
      }
    }
    for (const [name, body] of KEEP_ARCHIVED_TRIGGERS) await c.execute(`CREATE TRIGGER IF NOT EXISTS ${name} ${body}`);
  },
} satisfies Migration;
