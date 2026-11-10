import type { Client } from '@libsql/client';

/**
 * Calls (como Gong): llamadas grabadas por el bot o subidas, sus partes
 * (video en partes de 4 MB y segmentos de audio para transcribir), comentarios
 * con momento, clips, ajustes del workspace y preferencias de cada persona.
 * Todo cuelga del workspace (workspace_id = id del owner). Los archivos viven
 * cifrados o en un store privado (lib/calls/files.ts); acá solo hay referencias.
 */
export async function callsUp(client: Client): Promise<void> {
  await client.executeMultiple(`
    CREATE TABLE IF NOT EXISTS calls (
      id TEXT PRIMARY KEY,
      workspace_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      owner_id TEXT NOT NULL,
      title TEXT NOT NULL DEFAULT '',
      source TEXT NOT NULL DEFAULT 'bot',
      platform TEXT NOT NULL DEFAULT 'meet',
      meeting_url TEXT,
      event_key TEXT,
      scheduled_at TEXT,
      scheduled_end TEXT,
      status TEXT NOT NULL DEFAULT 'scheduled',
      join_mode TEXT NOT NULL DEFAULT 'auto',
      will_join INTEGER NOT NULL DEFAULT 0,
      dispatch_attempts INTEGER NOT NULL DEFAULT 0,
      dispatched_at TEXT,
      bot_token_hash TEXT,
      started_at TEXT,
      ended_at TEXT,
      duration_ms INTEGER NOT NULL DEFAULT 0,
      end_reason TEXT,
      error TEXT,
      video_mime TEXT,
      video_bytes INTEGER NOT NULL DEFAULT 0,
      video_parts INTEGER NOT NULL DEFAULT 0,
      audio_mime TEXT,
      audio_segments INTEGER NOT NULL DEFAULT 0,
      attendees TEXT NOT NULL DEFAULT '[]',
      participants TEXT NOT NULL DEFAULT '[]',
      speakers TEXT NOT NULL DEFAULT '[]',
      speaker_timeline TEXT NOT NULL DEFAULT '[]',
      captions TEXT NOT NULL DEFAULT '[]',
      transcript TEXT,
      transcript_text TEXT NOT NULL DEFAULT '',
      language TEXT,
      analysis TEXT,
      metrics TEXT,
      processing_claimed_at TEXT,
      processing_attempts INTEGER NOT NULL DEFAULT 0,
      deal_id TEXT,
      contact_ids TEXT NOT NULL DEFAULT '[]',
      crm_activity_id TEXT,
      posted_at TEXT,
      share_token TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      deleted_at TEXT
    );
    CREATE INDEX IF NOT EXISTS idx_calls_ws ON calls(workspace_id, deleted_at, started_at);
    CREATE INDEX IF NOT EXISTS idx_calls_status ON calls(status, scheduled_at);
    CREATE INDEX IF NOT EXISTS idx_calls_deal ON calls(workspace_id, deal_id);
    CREATE UNIQUE INDEX IF NOT EXISTS idx_calls_event ON calls(workspace_id, owner_id, event_key) WHERE event_key IS NOT NULL;
    CREATE UNIQUE INDEX IF NOT EXISTS idx_calls_share ON calls(share_token) WHERE share_token IS NOT NULL;

    CREATE TABLE IF NOT EXISTS calls_parts (
      call_id TEXT NOT NULL REFERENCES calls(id) ON DELETE CASCADE,
      kind TEXT NOT NULL,
      n INTEGER NOT NULL,
      ref TEXT NOT NULL,
      size INTEGER NOT NULL DEFAULT 0,
      mime TEXT NOT NULL DEFAULT '',
      start_ms INTEGER NOT NULL DEFAULT 0,
      transcript TEXT,
      PRIMARY KEY (call_id, kind, n)
    );

    CREATE TABLE IF NOT EXISTS calls_comments (
      id TEXT PRIMARY KEY,
      call_id TEXT NOT NULL REFERENCES calls(id) ON DELETE CASCADE,
      workspace_id TEXT NOT NULL,
      author_id TEXT NOT NULL,
      author_name TEXT NOT NULL DEFAULT '',
      at_ms INTEGER,
      body TEXT NOT NULL,
      created_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_calls_comments ON calls_comments(call_id, created_at);

    CREATE TABLE IF NOT EXISTS calls_clips (
      id TEXT PRIMARY KEY,
      call_id TEXT NOT NULL REFERENCES calls(id) ON DELETE CASCADE,
      workspace_id TEXT NOT NULL,
      created_by TEXT NOT NULL,
      title TEXT NOT NULL,
      start_ms INTEGER NOT NULL,
      end_ms INTEGER NOT NULL,
      created_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_calls_clips ON calls_clips(call_id, start_ms);
    CREATE INDEX IF NOT EXISTS idx_calls_clips_ws ON calls_clips(workspace_id, created_at);

    CREATE TABLE IF NOT EXISTS calls_settings (
      workspace_id TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
      data TEXT NOT NULL DEFAULT '{}',
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS calls_prefs (
      workspace_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      person_id TEXT NOT NULL,
      auto_join TEXT NOT NULL DEFAULT 'manual',
      synced_at TEXT,
      sync_claimed_at TEXT,
      updated_at TEXT NOT NULL,
      PRIMARY KEY (workspace_id, person_id)
    );
  `);
}
