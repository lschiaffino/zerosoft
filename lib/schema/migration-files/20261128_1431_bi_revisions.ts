import type { Migration } from '../migrations';

/**
 * Analytics: historial de versiones (como el de Metabase). Una fila por
 * versión guardada de una pregunta, con la foto completa para poder volver a
 * ella y la lista de lo que cambió. item_kind deja lugar a los tableros.
 */
export default {
  id: '20261128_1431_bi_revisions',
  up: async (c) => {
    await c.execute(`CREATE TABLE IF NOT EXISTS bi_revisions (
      id TEXT PRIMARY KEY,
      workspace_id TEXT NOT NULL,
      item_kind TEXT NOT NULL,
      item_id TEXT NOT NULL,
      kind TEXT NOT NULL,
      changes_json TEXT NOT NULL DEFAULT '[]',
      snapshot_json TEXT NOT NULL,
      author_id TEXT NOT NULL,
      created_at TEXT NOT NULL
    )`);
    await c.execute('CREATE INDEX IF NOT EXISTS idx_bi_revisions_item ON bi_revisions(workspace_id, item_kind, item_id, created_at)');
  },
} satisfies Migration;
