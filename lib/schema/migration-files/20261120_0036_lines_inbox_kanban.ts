import type { Migration } from '../migrations';

/**
 * Lines: la vista kanban de la bandeja (lib/groups-kanban.ts).
 *
 * - groups_kanban_stages: las columnas. owner_id '' es una etapa del equipo
 *   (la define un admin, la ve todo el workspace); owner_id = una persona es
 *   una etapa de su tablero personal (nadie más la ve, tampoco un admin).
 * - groups_kanban_cards: en qué etapa está cada chat. Con owner_id '' es la
 *   etapa del equipo (una por chat, la ve el equipo); con owner_id = una
 *   persona es dónde la puso esa persona en su tablero (una por persona y chat).
 *
 * Si la vista está prendida, qué tablero se mira y qué columnas están
 * plegadas son preferencias de cada persona en groups_user_prefs (ya existe).
 * Solo tablas e índices nuevos (IF NOT EXISTS): corre dos veces y en paralelo.
 */
export default {
  id: '20261120_0036_lines_inbox_kanban',
  up: async (c) => {
    await c.execute(`
      CREATE TABLE IF NOT EXISTS groups_kanban_stages (
        id TEXT PRIMARY KEY,
        user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        owner_id TEXT NOT NULL DEFAULT '',
        name TEXT NOT NULL,
        color TEXT NOT NULL DEFAULT 'gray',
        position INTEGER NOT NULL DEFAULT 0,
        created_by TEXT,
        created_at TEXT NOT NULL DEFAULT (datetime('now')),
        updated_at TEXT NOT NULL DEFAULT (datetime('now'))
      )
    `);
    await c.execute('CREATE INDEX IF NOT EXISTS idx_groups_kanban_stages_owner ON groups_kanban_stages(user_id, owner_id, position)');
    await c.execute(`
      CREATE TABLE IF NOT EXISTS groups_kanban_cards (
        user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        owner_id TEXT NOT NULL DEFAULT '',
        chat_id TEXT NOT NULL REFERENCES groups_chats(id) ON DELETE CASCADE,
        stage_id TEXT NOT NULL REFERENCES groups_kanban_stages(id) ON DELETE CASCADE,
        moved_by TEXT,
        updated_at TEXT NOT NULL DEFAULT (datetime('now')),
        PRIMARY KEY (owner_id, chat_id)
      )
    `);
    await c.execute('CREATE INDEX IF NOT EXISTS idx_groups_kanban_cards_stage ON groups_kanban_cards(stage_id)');
    await c.execute('CREATE INDEX IF NOT EXISTS idx_groups_kanban_cards_chat ON groups_kanban_cards(user_id, chat_id)');
  },
} satisfies Migration;
