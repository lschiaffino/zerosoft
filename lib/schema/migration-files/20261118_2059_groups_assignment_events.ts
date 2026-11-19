import type { Migration } from '../migrations';

/**
 * Lines: historial de asignaciones por chat (lib/groups-assignments.ts). Una
 * fila por cambio de persona asignada: de quién, a quién, quién lo hizo,
 * cuándo y por qué (manual, regla automática o reasignación porque la persona
 * se desconectó). Lo lee GET /api/groups/assignments?chat= y el panel de
 * detalles del chat. Se borra con el chat.
 *
 * Tolera correr dos veces y en paralelo (IF NOT EXISTS).
 */
export default {
  id: '20261118_2059_groups_assignment_events',
  up: async (c) => {
    await c.execute(`CREATE TABLE IF NOT EXISTS groups_assignment_events (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      chat_id TEXT NOT NULL REFERENCES groups_chats(id) ON DELETE CASCADE,
      from_person TEXT,
      to_person TEXT,
      actor_id TEXT,
      reason TEXT NOT NULL CHECK (reason IN ('manual', 'auto', 'offline')),
      rule_name TEXT,
      created_at TEXT NOT NULL
    )`);
    await c.execute('CREATE INDEX IF NOT EXISTS idx_groups_assignment_events_chat ON groups_assignment_events(chat_id, created_at)');
  },
} satisfies Migration;
