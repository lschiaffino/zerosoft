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
 * Releases (como Linear): una versión de un team con nombre, versión, fecha
 * objetivo y estado (planned, in_progress, released). Los issues entran a mano
 * (el issue, la selección o ⌘K) o solos cuando se mergea un PR vinculado.
 *
 * - track_releases.notes NULL = notas generadas de los títulos; con texto,
 *   las escritas a mano.
 * - track_issues.release_id: un issue va en un release a la vez, del mismo team.
 */
export default {
  id: '20261123_0717_track_releases',
  up: async (c) => {
    await c.execute(`CREATE TABLE IF NOT EXISTS track_releases (
      id TEXT PRIMARY KEY,
      project_id TEXT NOT NULL,
      name TEXT NOT NULL,
      version TEXT NOT NULL DEFAULT '',
      target_date TEXT,
      status TEXT NOT NULL DEFAULT 'planned' CHECK (status IN ('planned', 'in_progress', 'released')),
      released_at TEXT,
      notes TEXT,
      auto_github INTEGER NOT NULL DEFAULT 1,
      created_by TEXT,
      created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
      updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
    )`);
    await c.execute('CREATE INDEX IF NOT EXISTS idx_track_releases_project ON track_releases(project_id, status)');
    await addColumn(c, 'ALTER TABLE track_issues ADD COLUMN release_id TEXT');
    await c.execute('CREATE INDEX IF NOT EXISTS idx_track_issues_release ON track_issues(release_id)');
  },
} satisfies Migration;
