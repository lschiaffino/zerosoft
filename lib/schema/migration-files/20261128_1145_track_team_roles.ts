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
 * Track — roles por team (como los team owners de Linear). Una fila por
 * persona que es dueña del team; el resto de quienes lo ven son miembros.
 * `team_permissions` (JSON) dice, por área (settings, labels, templates,
 * members), si la maneja cualquier miembro o solo los dueños.
 */
export default {
  id: '20261128_1145_track_team_roles',
  up: async (c) => {
    await c.execute(`CREATE TABLE IF NOT EXISTS track_team_roles (
      project_id TEXT NOT NULL REFERENCES track_projects(id) ON DELETE CASCADE,
      user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      role TEXT NOT NULL DEFAULT 'owner',
      added_by TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      PRIMARY KEY (project_id, user_id)
    )`);
    await c.execute('CREATE INDEX IF NOT EXISTS idx_track_team_roles_user ON track_team_roles(user_id)');
    await addColumn(c, 'ALTER TABLE track_projects ADD COLUMN team_permissions TEXT');
  },
} satisfies Migration;
