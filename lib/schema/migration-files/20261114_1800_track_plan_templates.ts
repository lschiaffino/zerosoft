import type { Migration } from '../migrations';

/**
 * Track: templates de projects (como en Linear). Se guardan desde un project
 * (descripción, prioridad, teams, labels, milestones con su distancia al
 * inicio e issues) y un project nuevo puede nacer de uno. Por workspace, como
 * los projects (team_id del team viejo u owner_id en los workspaces nuevos).
 */
export default {
  id: '20261114_1800_track_plan_templates',
  up: async (c) => {
    await c.execute(`CREATE TABLE IF NOT EXISTS track_plan_templates (
      id TEXT PRIMARY KEY,
      team_id TEXT REFERENCES teams(id) ON DELETE CASCADE,
      owner_id TEXT REFERENCES users(id) ON DELETE CASCADE,
      name TEXT NOT NULL,
      description TEXT NOT NULL DEFAULT '',
      data TEXT NOT NULL DEFAULT '{}',
      created_by TEXT REFERENCES users(id) ON DELETE SET NULL,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    )`);
    await c.execute('CREATE INDEX IF NOT EXISTS idx_track_plan_templates_team ON track_plan_templates(team_id, owner_id)');
  },
} satisfies Migration;
