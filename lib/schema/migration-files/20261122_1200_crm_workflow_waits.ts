import type { Client } from '@libsql/client';
import type { Migration } from '../migrations';

async function addColumn(client: Client, sql: string): Promise<void> {
  try {
    await client.execute(sql);
  } catch (err) {
    if (!/duplicate column/i.test(String(err))) throw err;
  }
}

/**
 * CRM, bloque W2: esperas hasta una fecha o un evento, y visibilidad del
 * historial con los criterios del momento de la inscripción.
 *
 * - crm_workflow_runs.reaches_other: 1 si, al inscribirse, los criterios, las
 *   ramas o las esperas del workflow miraban otro registro. NULL (antes de
 *   W2) cuenta como 1 para quien no ve todo.
 * - crm_workflow_runs.wait_key: evento y registro que espera una inscripción
 *   (lib/crm-workflow-rules.ts waitKey), para despertarla cuando pasa.
 *
 * Idempotente: columnas con addColumn e índice IF NOT EXISTS.
 */
export default {
  id: '20261122_1200_crm_workflow_waits',
  up: async (c) => {
    await addColumn(c, 'ALTER TABLE crm_workflow_runs ADD COLUMN reaches_other INTEGER');
    await addColumn(c, 'ALTER TABLE crm_workflow_runs ADD COLUMN wait_key TEXT');
    await c.execute(
      "CREATE INDEX IF NOT EXISTS idx_crm_workflow_runs_wait_key ON crm_workflow_runs(user_id, wait_key) WHERE wait_key IS NOT NULL AND status = 'waiting'",
    );
  },
} satisfies Migration;
