import type { Migration } from '../migrations';

/**
 * Time: aprobación de horas por semana (como "Submit week for approval" en Harvest).
 *
 * time_timesheets: una fila por persona y semana (`week_start`, el lunes) que se
 * envió. `status`: 'submitted' (pendiente), 'approved' o 'returned' (devuelta
 * con una nota, otra vez editable). Una semana sin fila no se envió.
 * Mientras está pendiente o aprobada, las entradas de esa semana no se tocan.
 *
 * Idempotente: IF NOT EXISTS.
 */
export default {
  id: '20261120_1935_time_timesheets',
  up: async (c) => {
    await c.executeMultiple(`
      CREATE TABLE IF NOT EXISTS time_timesheets (
        workspace_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        person_id TEXT NOT NULL,
        week_start TEXT NOT NULL,
        status TEXT NOT NULL,
        submitted_at TEXT NOT NULL,
        decided_by TEXT,
        decided_at TEXT,
        note TEXT NOT NULL DEFAULT '',
        updated_at TEXT NOT NULL,
        PRIMARY KEY (workspace_id, person_id, week_start)
      );
      CREATE INDEX IF NOT EXISTS idx_time_timesheets_status ON time_timesheets(workspace_id, status, week_start);
    `);
  },
} satisfies Migration;
