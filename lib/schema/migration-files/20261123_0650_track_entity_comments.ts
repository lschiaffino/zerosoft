import type { Migration } from '../migrations';

/**
 * Hilos de comentarios en projects (track_plans) e iniciativas, como los de
 * los issues: respuestas de un nivel, resolver, editar y borrar los propios,
 * y reacciones. Un comentario cuelga de un project o de una iniciativa (con
 * su clave foránea: se borra con ellos y la privacidad sigue a su workspace).
 */
export default {
  id: '20261123_0650_track_entity_comments',
  async up(client) {
    await client.execute(`CREATE TABLE IF NOT EXISTS track_entity_comments (
      id TEXT PRIMARY KEY,
      plan_id TEXT REFERENCES track_plans(id) ON DELETE CASCADE,
      initiative_id TEXT REFERENCES track_initiatives(id) ON DELETE CASCADE,
      user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      body TEXT NOT NULL DEFAULT '',
      parent_id TEXT REFERENCES track_entity_comments(id) ON DELETE CASCADE,
      resolved_at TEXT,
      resolved_by TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT,
      CHECK ((plan_id IS NULL) != (initiative_id IS NULL))
    )`);
    await client.execute('CREATE INDEX IF NOT EXISTS idx_track_entity_comments_plan ON track_entity_comments(plan_id, created_at) WHERE plan_id IS NOT NULL');
    await client.execute(
      'CREATE INDEX IF NOT EXISTS idx_track_entity_comments_initiative ON track_entity_comments(initiative_id, created_at) WHERE initiative_id IS NOT NULL',
    );
    await client.execute('CREATE INDEX IF NOT EXISTS idx_track_entity_comments_parent ON track_entity_comments(parent_id) WHERE parent_id IS NOT NULL');
    await client.execute(`CREATE TABLE IF NOT EXISTS track_entity_comment_reactions (
      comment_id TEXT NOT NULL REFERENCES track_entity_comments(id) ON DELETE CASCADE,
      user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      emoji TEXT NOT NULL,
      created_at TEXT NOT NULL,
      PRIMARY KEY (comment_id, user_id, emoji)
    )`);
  },
} satisfies Migration;
