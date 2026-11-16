import type { Migration } from '../migrations';

/**
 * Lines: un mensaje que llega a un chat archivado lo desarchiva, como WhatsApp con "Mantener chats archivados"
 * apagado. El ajuste del workspace (`keepArchived`) pasa a venir apagado.
 *
 * Los workspaces que guardaron sus ajustes tienen el objeto entero, con `keepArchived: true` aunque nunca lo hayan
 * tocado (no se puede distinguir): se apaga en todos. Quien lo quiera puede volver a prenderlo en Ajustes. Los chats
 * con "Mantener archivado" propio siguen archivados (trigger de 20261115_2258_chat_keep_archived).
 *
 * Tolera correr dos veces y en paralelo: la segunda vez no encuentra filas con el ajuste prendido.
 */
export default {
  id: '20261116_0545_lines_incoming_unarchives',
  up: async (c) => {
    await c.execute(
      `UPDATE groups_settings SET data = json_set(data, '$.keepArchived', json('false'))
        WHERE json_valid(data) AND json_extract(data, '$.keepArchived') = 1`,
    );
  },
} satisfies Migration;
