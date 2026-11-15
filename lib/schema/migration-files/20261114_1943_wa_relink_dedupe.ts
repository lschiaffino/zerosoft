import type { Client } from '@libsql/client';
import type { BatchStatement } from '../../db';
import type { Migration } from '../migrations';
import { contactPairsInsert, inboxSharedPairsInsert, MERGE_PAIRS_DDL, runMerge, type MergeCounts } from '../../wa-dedupe';

/**
 * Inbox y Lines: la misma persona con dos chats, uno por su id anónimo de
 * WhatsApp ("<lid>@lid") y otro por su teléfono. Pasaba al desvincular y
 * volver a vincular el número: el historial llega otra vez y parte de él viene
 * por lid. Desde ahora cada tanda junta esos chats (lib/wa-dedupe.ts); esto
 * junta los que ya quedaron duplicados.
 *
 * - wa_merge_pairs: la tabla de trabajo de cada corrida (vacía entre corridas).
 * - idx_inbox_messages_owner_ext: buscar un mensaje por su id de WhatsApp en
 *   todos los chats de la persona (un mensaje recibido en dos chats 1:1 dice
 *   que son la misma persona).
 * - Limpieza: los chats por lid cuyo teléfono está en la libreta (las dos
 *   apps) o que comparten un mensaje recibido con el chat del teléfono
 *   (Inbox) pasan al chat del teléfono; un mensaje repetido (mismo id en los
 *   dos) se borra del chat por lid. Un mensaje sin repetido nunca se borra.
 *
 * Idempotente y segura en paralelo: cada corrida es una transacción; la
 * segunda ya no encuentra pares. Deja en el log cuánto había antes y después.
 */
async function counts(c: Client): Promise<Record<string, number>> {
  const one = async (sql: string) => Number((await c.execute(sql)).rows[0]?.n ?? 0);
  return {
    inboxLidChats: await one("SELECT COUNT(*) AS n FROM inbox_threads WHERE kind = 'dm' AND external_id LIKE '%@lid'"),
    inboxLidChatsWithPhone: await one(
      `SELECT COUNT(*) AS n FROM inbox_threads l JOIN wa_contacts c ON c.app = 'inbox' AND c.account_id = l.account_id
         AND c.lid = substr(l.external_id, 1, length(l.external_id) - 4) AND c.phone <> ''
       WHERE l.kind = 'dm' AND l.external_id LIKE '%@lid'`,
    ),
    inboxDupMessages: await one(
      `SELECT COUNT(*) AS n FROM inbox_threads l JOIN inbox_messages lm ON lm.thread_id = l.id
       WHERE l.kind = 'dm' AND l.external_id LIKE '%@lid' AND EXISTS (
         SELECT 1 FROM inbox_messages sm JOIN inbox_threads s ON s.id = sm.thread_id
         WHERE sm.owner_id = lm.owner_id AND sm.external_id = lm.external_id AND s.account_id = l.account_id AND s.kind = 'dm' AND s.external_id LIKE '%@s.whatsapp.net')`,
    ),
    linesLidChats: await one("SELECT COUNT(*) AS n FROM groups_chats WHERE kind = 'dm' AND provider_chat_id LIKE '%@lid'"),
    linesLidChatsWithPhone: await one(
      `SELECT COUNT(*) AS n FROM groups_chats l JOIN wa_contacts c ON c.app = 'lines' AND c.account_id = l.number_id
         AND c.lid = substr(l.provider_chat_id, 1, length(l.provider_chat_id) - 4) AND c.phone <> ''
       WHERE l.kind = 'dm' AND l.provider_chat_id LIKE '%@lid'`,
    ),
  };
}

export default {
  id: '20261114_1943_wa_relink_dedupe',
  up: async (c) => {
    await c.execute(MERGE_PAIRS_DDL);
    await c.execute('CREATE INDEX IF NOT EXISTS idx_inbox_messages_owner_ext ON inbox_messages(owner_id, external_id)');
    const batch = async (stmts: BatchStatement[]) =>
      (await c.batch(stmts, 'write')).map((r) => ({ changes: Number(r.rowsAffected) }));
    const before = await counts(c);
    const inbox: MergeCounts = await runMerge('inbox', (run) => [contactPairsInsert('inbox', run), inboxSharedPairsInsert(run)], batch);
    const lines: MergeCounts = await runMerge('lines', (run) => [contactPairsInsert('lines', run)], batch);
    const after = await counts(c);
    // eslint-disable-next-line no-console
    console.log('[wa-dedupe] relink cleanup', JSON.stringify({ before, inbox, lines, after }));
  },
} satisfies Migration;
