import type { Migration } from '../migrations';

/**
 * Asistente: permiso de la persona para que lea sus chats de Inbox o de Lines
 * (lib/assistant/chat-access.ts). `conversation_id` vacío = siempre; con una
 * charla = solo esa vez (esa charla). Sin fila, el asistente no lee el texto
 * de ningún mensaje. Se revoca en Ajustes › Cuenta.
 */
export default {
  id: '20261115_0400_assistant_chat_grants',
  up: async (c) => {
    await c.execute(`CREATE TABLE IF NOT EXISTS assistant_chat_grants (
      id TEXT PRIMARY KEY,
      workspace_id TEXT NOT NULL,
      person_id TEXT NOT NULL,
      app TEXT NOT NULL,
      conversation_id TEXT NOT NULL DEFAULT '',
      created_at TEXT NOT NULL
    )`);
    await c.execute(
      'CREATE UNIQUE INDEX IF NOT EXISTS idx_assistant_chat_grants_key ON assistant_chat_grants (workspace_id, person_id, app, conversation_id)',
    );
  },
} satisfies Migration;
