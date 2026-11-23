import type { Migration } from '../migrations';

/**
 * Hilos de comentarios en projects (track_plans) e iniciativas, como los de
 * los issues: respuestas de un nivel, resolver, editar y borrar los propios,
 * y reacciones. Una tabla para los dos (entity_type = 'plan' | 'initiative').
 */
export default {
  id: '20261123_0650_track_entity_comments',
  async up(client) {
    await client.execute(`CREATE TABLE IF NOT EXISTS track_entity_comments (
      id TEXT PRIMARY KEY,
      entity_type TEXT NOT NULL CHECK (entity_type IN ('plan', 'initiative')),
      entity_id TEXT NOT NULL,
      user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      body TEXT NOT NULL DEFAULT '',
      parent_id TEXT,
      resolved_at TEXT,
      resolved_by TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT
    )`);
    await client.execute('CREATE INDEX IF NOT EXISTS idx_track_entity_comments_entity ON track_entity_comments(entity_type, entity_id, created_at)');
    await client.execute(`CREATE TABLE IF NOT EXISTS track_entity_comment_reactions (
      comment_id TEXT NOT NULL REFERENCES track_entity_comments(id) ON DELETE CASCADE,
      user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      emoji TEXT NOT NULL,
      created_at TEXT NOT NULL,
      PRIMARY KEY (comment_id, user_id, emoji)
    )`);
  },
} satisfies Migration;
