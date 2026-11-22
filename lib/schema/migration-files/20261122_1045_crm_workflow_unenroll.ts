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
 * CRM, bloque W3: sacar un registro de un workflow a mano.
 *
 * - crm_workflow_runs.unenrolled_by: quién sacó la inscripción (status
 *   'unenrolled'); lo ven owner y admins en el registro por acción.
 *
 * Idempotente: columna con addColumn.
 */
export default {
  id: '20261122_1045_crm_workflow_unenroll',
  up: async (c) => {
    await addColumn(c, 'ALTER TABLE crm_workflow_runs ADD COLUMN unenrolled_by TEXT');
  },
} satisfies Migration;
