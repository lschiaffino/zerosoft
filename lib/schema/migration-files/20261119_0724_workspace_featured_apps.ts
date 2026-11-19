import type { Migration } from '../migrations';

/**
 * Apps destacadas del workspace (Ajustes › Apps del workspace): una fila por
 * app destacada, clave el owner como workspace_apps. Sin filas, el menú de
 * apps se ve como siempre. Idempotente.
 */
export default {
  id: '20261119_0724_workspace_featured_apps',
  up: async (c) => {
    await c.execute(`
      CREATE TABLE IF NOT EXISTS workspace_featured_apps (
        owner_id TEXT NOT NULL,
        app TEXT NOT NULL,
        created_by TEXT,
        created_at TEXT NOT NULL DEFAULT (datetime('now')),
        PRIMARY KEY (owner_id, app)
      )
    `);
  },
} satisfies Migration;
