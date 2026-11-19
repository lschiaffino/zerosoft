import type { Migration } from '../migrations';

/**
 * Lines: grupos de líneas (Ventas, Operaciones…). Una línea está en un grupo
 * o en ninguno (groups_numbers.line_group_id). El acceso a un grupo se da a
 * personas o equipos (groups_line_group_access, igual que groups_number_access
 * por línea) y alcanza a todas las líneas del grupo, también a las que se
 * suman después. Sin grupos, todo sigue como estaba.
 * Idempotente: IF NOT EXISTS y la columna se agrega ignorando "duplicate column".
 */
export default {
  id: '20261119_0630_lines_line_groups',
  up: async (c) => {
    await c.executeMultiple(`
      CREATE TABLE IF NOT EXISTS groups_line_groups (
        id TEXT PRIMARY KEY,
        user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        name TEXT NOT NULL,
        position INTEGER NOT NULL DEFAULT 0,
        created_by TEXT NOT NULL DEFAULT '',
        created_at TEXT NOT NULL DEFAULT (datetime('now')),
        updated_at TEXT NOT NULL DEFAULT (datetime('now'))
      );
      CREATE INDEX IF NOT EXISTS idx_groups_line_groups_ws ON groups_line_groups(user_id, position);
      CREATE TABLE IF NOT EXISTS groups_line_group_access (
        group_id TEXT NOT NULL REFERENCES groups_line_groups(id) ON DELETE CASCADE,
        kind TEXT NOT NULL CHECK (kind IN ('person', 'team')),
        ref_id TEXT NOT NULL,
        PRIMARY KEY (group_id, kind, ref_id)
      );
      CREATE INDEX IF NOT EXISTS idx_groups_line_group_access_ref ON groups_line_group_access(kind, ref_id);
    `);
    try {
      await c.execute('ALTER TABLE groups_numbers ADD COLUMN line_group_id TEXT');
    } catch (err) {
      if (!/duplicate column/i.test(String(err))) throw err;
    }
    await c.execute('CREATE INDEX IF NOT EXISTS idx_groups_numbers_line_group ON groups_numbers(line_group_id)');
  },
} satisfies Migration;
