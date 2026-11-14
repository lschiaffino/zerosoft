import type { BatchStatement } from '../../db';
import type { Migration } from '../migrations';
import { contactPairsInsert, DEDUPE_COUNTS, inboxSharedPairsInsert, runMerge } from '../../wa-dedupe';

/**
 * Segunda pasada de 20261114_1943_wa_relink_dedupe. Aquella leyó las cuentas
 * de antes y después fuera de la transacción y pueden haber venido de una
 * réplica atrasada (antes y después daban igual). Esta vuelve a juntar lo que
 * haya quedado (chats por lid que llegaron entre el deploy y el webhook nuevo)
 * y lee las cuentas en un batch 'write', contra la base principal.
 * Idempotente: sin pares, no cambia nada.
 */
export default {
  id: '20261114_2116_wa_relink_dedupe_check',
  up: async (c) => {
    const counts = async () => {
      const res = await c.batch(
        DEDUPE_COUNTS.map(([, sql]) => sql),
        'write',
      );
      return Object.fromEntries(DEDUPE_COUNTS.map(([k], i) => [k, Number(res[i].rows[0]?.n ?? 0)]));
    };
    const batch = async (stmts: BatchStatement[]) => (await c.batch(stmts, 'write')).map((r) => ({ changes: Number(r.rowsAffected) }));
    const before = await counts();
    const inbox = await runMerge('inbox', (run) => [contactPairsInsert('inbox', run), inboxSharedPairsInsert(run)], batch);
    const lines = await runMerge('lines', (run) => [contactPairsInsert('lines', run)], batch);
    const after = await counts();
    // eslint-disable-next-line no-console
    console.log('[wa-dedupe] relink check', JSON.stringify({ before, inbox, lines, after }));
  },
} satisfies Migration;
