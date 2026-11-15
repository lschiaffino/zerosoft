import type { Migration } from '../migrations';

/**
 * Track: updates de initiatives (como en Linear): salud y texto escritos por
 * quien la sigue. La salud de la initiative pasa a ser la de su último update
 * (si no tiene, la peor de sus projects activos).
 */
export default {
  id: '20261114_1715_track_initiative_updates',
  up: async (c) => {
    await c.execute(`CREATE TABLE IF NOT EXISTS track_initiative_updates (
      id TEXT PRIMARY KEY,
      initiative_id TEXT NOT NULL REFERENCES track_initiatives(id) ON DELETE CASCADE,
      user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      health TEXT NOT NULL CHECK (health IN ('on_track', 'at_risk', 'off_track')),
      body TEXT NOT NULL DEFAULT '',
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT
    )`);
    await c.execute(
      'CREATE INDEX IF NOT EXISTS idx_track_initiative_updates_initiative ON track_initiative_updates(initiative_id, created_at DESC)',
    );
  },
} satisfies Migration;
