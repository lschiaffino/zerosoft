import type { Migration } from '../migrations';

/**
 * Track: las vistas guardadas de las listas que no son de un team (Issues del
 * workspace, la pestaña Issues de un project) se pueden compartir con el
 * workspace, como las "workspace views" de Linear. Solo quien la creó la edita.
 */
export default {
  id: '20261114_1647_track_list_views_shared',
  up: async (c) => {
    for (const sql of [
      'ALTER TABLE track_list_views ADD COLUMN shared INTEGER NOT NULL DEFAULT 0',
      // El workspace con el que se comparte (scope_id es el team viejo, vacío en los workspaces nuevos).
      'ALTER TABLE track_list_views ADD COLUMN workspace_id TEXT',
    ]) {
      try {
        await c.execute(sql);
      } catch (err) {
        if (!/duplicate column/i.test(String(err))) throw err;
      }
    }
    await c.execute('CREATE INDEX IF NOT EXISTS idx_track_list_views_shared ON track_list_views(workspace_id, list_key, shared)');
  },
} satisfies Migration;
