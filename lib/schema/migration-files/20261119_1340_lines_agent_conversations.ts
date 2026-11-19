import type { Migration } from '../migrations';

/**
 * Lines + Agents: de qué chat de Lines nació cada conversación de Agents
 * (groups_agent_conversations). groups_chats.agent_conversation_id guarda solo
 * la conversación actual del chat; al cambiar de agente o empezar otra, la
 * anterior quedaba sin chat. Con esta tabla sigue las reglas de su chat.
 *
 * Se llena con las actuales y con las que ya quedaron sueltas: las del canal
 * 'api' sin autor, sin origen (Flow, Slack…) y sin referencia externa son las
 * que crea Lines; sin chat conocido (chat_id '') las ven solo dueño y admins.
 * Idempotente: IF NOT EXISTS e INSERT OR IGNORE.
 */
export default {
  id: '20261119_1340_lines_agent_conversations',
  up: async (c) => {
    await c.executeMultiple(`
      CREATE TABLE IF NOT EXISTS groups_agent_conversations (
        conversation_id TEXT PRIMARY KEY,
        user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        chat_id TEXT NOT NULL DEFAULT '',
        created_at TEXT NOT NULL DEFAULT (datetime('now'))
      );
      CREATE INDEX IF NOT EXISTS idx_groups_agent_conversations_chat ON groups_agent_conversations(chat_id);
      CREATE INDEX IF NOT EXISTS idx_groups_agent_conversations_ws ON groups_agent_conversations(user_id);
    `);
    await c.execute(
      `INSERT OR IGNORE INTO groups_agent_conversations (conversation_id, user_id, chat_id)
       SELECT agent_conversation_id, user_id, id FROM groups_chats WHERE agent_conversation_id IS NOT NULL`,
    );
    await c.execute(
      `INSERT OR IGNORE INTO groups_agent_conversations (conversation_id, user_id, chat_id)
       SELECT ac.id, ac.user_id, '' FROM agent_conversations ac
       WHERE ac.channel = 'api' AND ac.created_by IS NULL AND ac.source IS NULL AND ac.external_ref IS NULL AND ac.chat_conversation_id IS NULL`,
    );
  },
} satisfies Migration;
