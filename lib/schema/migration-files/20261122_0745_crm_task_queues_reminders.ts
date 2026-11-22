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
 * CRM, bloque A3: colas de tareas con nombre y recordatorios, como en HubSpot.
 *
 * - crm_task_queues: colas del workspace (`user_id`). `person_id` = quien la
 *   creó; `shared` 0 = solo esa persona la ve, 1 = todo el workspace.
 * - crm_activities.queue_id: la cola de la tarea (una por tarea, como HubSpot).
 * - crm_activities.reminder_at: cuándo avisarle a quien tiene la tarea (UTC);
 *   reminder_sent_at reclama el aviso para que salga una sola vez.
 * - crm_task_digests: quién pidió el email diario con sus tareas del día
 *   (por workspace y persona); last_sent_on (fecha local) lo reclama por día.
 *
 * Idempotente: columnas con addColumn, tabla e índices IF NOT EXISTS.
 */
export default {
  id: '20261122_0745_crm_task_queues_reminders',
  up: async (c) => {
    await c.executeMultiple(`
      CREATE TABLE IF NOT EXISTS crm_task_queues (
        id TEXT PRIMARY KEY,
        user_id TEXT NOT NULL,
        person_id TEXT NOT NULL,
        name TEXT NOT NULL,
        shared INTEGER NOT NULL DEFAULT 0,
        created_at TEXT NOT NULL DEFAULT (datetime('now')),
        updated_at TEXT NOT NULL DEFAULT (datetime('now'))
      );
      CREATE INDEX IF NOT EXISTS idx_crm_task_queues_ws ON crm_task_queues(user_id);
      CREATE TABLE IF NOT EXISTS crm_task_digests (
        user_id TEXT NOT NULL,
        person_id TEXT NOT NULL,
        enabled INTEGER NOT NULL DEFAULT 1,
        last_sent_on TEXT,
        updated_at TEXT NOT NULL DEFAULT (datetime('now')),
        PRIMARY KEY (user_id, person_id)
      );
    `);
    await addColumn(c, 'ALTER TABLE crm_activities ADD COLUMN queue_id TEXT');
    await addColumn(c, 'ALTER TABLE crm_activities ADD COLUMN reminder_at TEXT');
    await addColumn(c, 'ALTER TABLE crm_activities ADD COLUMN reminder_sent_at TEXT');
    await c.executeMultiple(`
      CREATE INDEX IF NOT EXISTS idx_crm_activities_queue ON crm_activities(user_id, queue_id);
      CREATE INDEX IF NOT EXISTS idx_crm_activities_reminder ON crm_activities(reminder_at) WHERE reminder_at IS NOT NULL AND reminder_sent_at IS NULL;
    `);
  },
} satisfies Migration;
