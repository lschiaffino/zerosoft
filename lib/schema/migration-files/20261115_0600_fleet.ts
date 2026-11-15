import type { Migration } from '../migrations';

/**
 * Fleet: el tablero de los agentes de código de cada persona.
 *
 * - fleet_connections: cuentas de GitHub y de Vercel (varias de cada una), con el token sellado (lib/secret-box).
 * - fleet_items: lo último que trajo la sincronización de cada cuenta (PRs, corridas de CI, releases, proyectos y
 *   deploys), un registro por cosa externa.
 * - fleet_tokens: tokens de ingesta del hook de Claude Code (solo el hash).
 * - fleet_sessions / fleet_messages: cada sesión de un agente local y su conversación (prompts, respuestas finales,
 *   avisos y las respuestas que la persona deja en cola para el Stop hook).
 * - fleet_feed: el feed con cursor para el tiempo real (lib/realtime.ts).
 * - fleet_prefs: espejo en Inbox y Lines y avisos por WhatsApp.
 *
 * Todo es de una persona dentro de un workspace (workspace_id + person_id).
 */
export default {
  id: '20261115_0600_fleet',
  up: async (c) => {
    await c.executeMultiple(`
      CREATE TABLE IF NOT EXISTS fleet_connections (
        id TEXT PRIMARY KEY,
        workspace_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        person_id TEXT NOT NULL,
        kind TEXT NOT NULL,
        label TEXT NOT NULL DEFAULT '',
        account TEXT NOT NULL DEFAULT '',
        token TEXT NOT NULL,
        token_hint TEXT NOT NULL DEFAULT '',
        config TEXT NOT NULL DEFAULT '{}',
        status TEXT NOT NULL DEFAULT 'ok',
        error TEXT NOT NULL DEFAULT '',
        last_sync_at TEXT,
        sync_claimed_at TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_fleet_connections_owner ON fleet_connections(workspace_id, person_id);
      CREATE INDEX IF NOT EXISTS idx_fleet_connections_sync ON fleet_connections(last_sync_at);

      CREATE TABLE IF NOT EXISTS fleet_items (
        id TEXT PRIMARY KEY,
        workspace_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        person_id TEXT NOT NULL,
        connection_id TEXT NOT NULL REFERENCES fleet_connections(id) ON DELETE CASCADE,
        kind TEXT NOT NULL,
        external_id TEXT NOT NULL,
        repo TEXT NOT NULL DEFAULT '',
        title TEXT NOT NULL DEFAULT '',
        url TEXT NOT NULL DEFAULT '',
        state TEXT NOT NULL DEFAULT '',
        author TEXT NOT NULL DEFAULT '',
        branch TEXT NOT NULL DEFAULT '',
        sha TEXT NOT NULL DEFAULT '',
        data TEXT NOT NULL DEFAULT '{}',
        occurred_at TEXT,
        seen_at TEXT NOT NULL,
        UNIQUE(connection_id, kind, external_id)
      );
      CREATE INDEX IF NOT EXISTS idx_fleet_items_owner ON fleet_items(workspace_id, person_id, kind, occurred_at);
      CREATE INDEX IF NOT EXISTS idx_fleet_items_branch ON fleet_items(workspace_id, person_id, branch);

      CREATE TABLE IF NOT EXISTS fleet_tokens (
        id TEXT PRIMARY KEY,
        workspace_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        person_id TEXT NOT NULL,
        label TEXT NOT NULL DEFAULT '',
        token_hash TEXT NOT NULL UNIQUE,
        token_hint TEXT NOT NULL DEFAULT '',
        last_used_at TEXT,
        created_at TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_fleet_tokens_owner ON fleet_tokens(workspace_id, person_id);

      CREATE TABLE IF NOT EXISTS fleet_sessions (
        id TEXT PRIMARY KEY,
        workspace_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        person_id TEXT NOT NULL,
        token_id TEXT,
        session_key TEXT NOT NULL,
        title TEXT NOT NULL DEFAULT '',
        custom_title TEXT NOT NULL DEFAULT '',
        project TEXT NOT NULL DEFAULT '',
        branch TEXT NOT NULL DEFAULT '',
        orca_pane TEXT NOT NULL DEFAULT '',
        orca_worktree TEXT NOT NULL DEFAULT '',
        orca_tab TEXT NOT NULL DEFAULT '',
        status TEXT NOT NULL DEFAULT 'idle',
        last_text TEXT NOT NULL DEFAULT '',
        unread INTEGER NOT NULL DEFAULT 0,
        archived INTEGER NOT NULL DEFAULT 0,
        started_at TEXT NOT NULL,
        last_event_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        UNIQUE(workspace_id, person_id, session_key)
      );
      CREATE INDEX IF NOT EXISTS idx_fleet_sessions_owner ON fleet_sessions(workspace_id, person_id, last_event_at);

      CREATE TABLE IF NOT EXISTS fleet_messages (
        id TEXT PRIMARY KEY,
        session_id TEXT NOT NULL REFERENCES fleet_sessions(id) ON DELETE CASCADE,
        workspace_id TEXT NOT NULL,
        person_id TEXT NOT NULL,
        role TEXT NOT NULL,
        event TEXT NOT NULL DEFAULT '',
        text TEXT NOT NULL DEFAULT '',
        status TEXT NOT NULL DEFAULT '',
        source TEXT NOT NULL DEFAULT '',
        external_ref TEXT NOT NULL DEFAULT '',
        created_at TEXT NOT NULL,
        delivered_at TEXT
      );
      CREATE INDEX IF NOT EXISTS idx_fleet_messages_session ON fleet_messages(session_id, created_at);
      CREATE INDEX IF NOT EXISTS idx_fleet_messages_pending ON fleet_messages(session_id, status);
      CREATE INDEX IF NOT EXISTS idx_fleet_messages_ref ON fleet_messages(workspace_id, person_id, external_ref);

      CREATE TABLE IF NOT EXISTS fleet_feed (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        workspace_id TEXT NOT NULL,
        person_id TEXT NOT NULL,
        kind TEXT NOT NULL,
        ref TEXT NOT NULL DEFAULT '',
        created_at TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_fleet_feed_owner ON fleet_feed(workspace_id, person_id, id);

      CREATE TABLE IF NOT EXISTS fleet_prefs (
        workspace_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        person_id TEXT NOT NULL,
        data TEXT NOT NULL DEFAULT '{}',
        updated_at TEXT NOT NULL,
        PRIMARY KEY (workspace_id, person_id)
      );
    `);
  },
} satisfies Migration;
