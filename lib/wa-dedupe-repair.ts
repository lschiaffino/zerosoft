/**
 * Inbox y Lines: arreglo de una vez de los chats duplicados de la misma
 * persona (uno por su lid, "<lid>@lid", y otro por su teléfono) que quedaron
 * antes de que el eco de lo que mando contara como señal (lib/wa-dedupe.ts).
 * Lo corre scripts/repair-wa-lid-duplicates.ts.
 *
 * Todo pasa en una sola transacción: sin `apply` se hace entero y se deshace
 * al final (lo que informa es exactamente lo que haría), con `apply` se
 * confirma. Idempotente: la segunda corrida no encuentra nada. Seguro con
 * webhooks llegando a la vez (cada junta es por id de corrida, como en la
 * app). El informe solo tiene cuentas: ni teléfonos, ni lids, ni nombres.
 * Server-only.
 */
import type { Client } from '@libsql/client';
import type { BatchStatement } from './db';
import { contactPairsInsert, DEDUPE_COUNTS, inboxQuotePairsInsert, inboxSharedPairsInsert, MERGE_PAIRS_DDL, runMerge, type MergeCounts } from './wa-dedupe';

export interface LidRepairReport {
  applied: boolean;
  before: Record<string, number>;
  inbox: MergeCounts;
  lines: MergeCounts;
  /** Chats por lid de Inbox que tenían dígitos en `handle` (se veían como un teléfono): quedan sin. */
  inboxLidHandles: number;
  after: Record<string, number>;
}

export async function repairLidDuplicates(client: Client, opts: { apply: boolean }): Promise<LidRepairReport> {
  await client.execute(MERGE_PAIRS_DDL);
  const tx = await client.transaction('write');
  try {
    const counts = async () => {
      const out: Record<string, number> = {};
      for (const [k, sql] of DEDUPE_COUNTS) out[k] = Number((await tx.execute(sql)).rows[0]?.n ?? 0);
      return out;
    };
    const batch = async (stmts: BatchStatement[]) => (await tx.batch(stmts)).map((r) => ({ changes: Number(r.rowsAffected) }));
    const before = await counts();
    // Inbox: la libreta, los mensajes repetidos (recibidos y propios) y las respuestas que citan un mensaje del chat
    // del teléfono. Lines: la libreta (allí un mismo id de WhatsApp no puede estar en dos chats del mismo número).
    const inbox = await runMerge('inbox', (run) => [contactPairsInsert('inbox', run), inboxSharedPairsInsert(run, { own: true }), inboxQuotePairsInsert(run)], batch);
    const lines = await runMerge('lines', (run) => [contactPairsInsert('lines', run)], batch);
    const handles = await tx.execute("UPDATE inbox_threads SET handle = '' WHERE kind = 'dm' AND external_id LIKE '%@lid' AND handle <> ''");
    const after = await counts();
    if (opts.apply) await tx.commit();
    else await tx.rollback();
    return { applied: opts.apply, before, inbox, lines, inboxLidHandles: Number(handles.rowsAffected), after };
  } finally {
    tx.close();
  }
}
