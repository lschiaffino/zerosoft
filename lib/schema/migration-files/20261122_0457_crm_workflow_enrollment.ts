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
 * CRM, bloque W1: workflows con inscripción, esperas y reanudación.
 *
 * - crm_workflows.settings: JSON { reenroll, filters } (lib/crm-workflow-rules.ts).
 *   Los workflows de antes quedan en '{}', que se lee como reinscripción
 *   activa (corrían en cada evento).
 * - crm_workflows.webhook_secret: secreto sellado (lib/secret-box.ts) con el
 *   que se firman los webhooks del workflow.
 * - crm_workflows.rr_cursor: cursor de la acción "Rotar owner".
 * - crm_workflow_runs: una corrida es una inscripción. resume_at y
 *   next_position la dejan esperando (status 'waiting') después de una
 *   espera; state guarda la rama y los resultados; steps cuenta las acciones
 *   corridas (tope por corrida); trigger_type, el disparador.
 *
 * Idempotente: columnas con addColumn e índices IF NOT EXISTS.
 */
export default {
  id: '20261122_0457_crm_workflow_enrollment',
  up: async (c) => {
    await addColumn(c, "ALTER TABLE crm_workflows ADD COLUMN settings TEXT NOT NULL DEFAULT '{}'");
    await addColumn(c, 'ALTER TABLE crm_workflows ADD COLUMN webhook_secret TEXT');
    await addColumn(c, 'ALTER TABLE crm_workflows ADD COLUMN rr_cursor INTEGER NOT NULL DEFAULT 0');
    await addColumn(c, 'ALTER TABLE crm_workflow_runs ADD COLUMN resume_at TEXT');
    await addColumn(c, 'ALTER TABLE crm_workflow_runs ADD COLUMN next_position INTEGER');
    await addColumn(c, "ALTER TABLE crm_workflow_runs ADD COLUMN state TEXT NOT NULL DEFAULT '{}'");
    await addColumn(c, 'ALTER TABLE crm_workflow_runs ADD COLUMN steps INTEGER NOT NULL DEFAULT 0');
    await addColumn(c, "ALTER TABLE crm_workflow_runs ADD COLUMN trigger_type TEXT NOT NULL DEFAULT ''");
    await c.executeMultiple(`
      CREATE INDEX IF NOT EXISTS idx_crm_workflow_runs_waiting ON crm_workflow_runs(status, resume_at);
      CREATE INDEX IF NOT EXISTS idx_crm_workflow_runs_record ON crm_workflow_runs(user_id, trigger_entity, trigger_entity_id, started_at DESC);
      CREATE INDEX IF NOT EXISTS idx_crm_workflow_runs_enroll ON crm_workflow_runs(workflow_id, trigger_entity_id, started_at DESC);
    `);
  },
} satisfies Migration;
