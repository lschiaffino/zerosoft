import type { Client } from '@libsql/client';

/**
 * Send (DocSend): documentos con versiones y páginas renderizadas, links con
 * sus reglas, sesiones de quien abre un link, visitas y segundos por página.
 * Espacios: varios documentos detrás de un link. Todo cuelga del workspace
 * (workspace_id = id del owner). Los archivos viven cifrados o en un store
 * privado (lib/send/files.ts); acá solo hay referencias.
 */
export async function sendUp(client: Client): Promise<void> {
  await client.executeMultiple(`
    CREATE TABLE IF NOT EXISTS send_documents (
      id TEXT PRIMARY KEY,
      workspace_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      owner_id TEXT NOT NULL,
      title TEXT NOT NULL,
      sharing TEXT NOT NULL DEFAULT 'private',
      current_version_id TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      deleted_at TEXT
    );
    CREATE INDEX IF NOT EXISTS idx_send_documents_ws ON send_documents(workspace_id, deleted_at, updated_at);

    CREATE TABLE IF NOT EXISTS send_versions (
      id TEXT PRIMARY KEY,
      document_id TEXT NOT NULL REFERENCES send_documents(id) ON DELETE CASCADE,
      workspace_id TEXT NOT NULL,
      n INTEGER NOT NULL,
      kind TEXT NOT NULL,
      name TEXT NOT NULL,
      mime TEXT NOT NULL,
      size INTEGER NOT NULL DEFAULT 0,
      part_count INTEGER NOT NULL DEFAULT 0,
      status TEXT NOT NULL DEFAULT 'uploading',
      error TEXT,
      page_count INTEGER NOT NULL DEFAULT 0,
      rendered_count INTEGER NOT NULL DEFAULT 0,
      render_claimed_at INTEGER,
      render_stalls INTEGER NOT NULL DEFAULT 0,
      duration_sec REAL,
      bucket_sec INTEGER,
      note TEXT,
      source_ref TEXT,
      derived_ref TEXT,
      created_by TEXT NOT NULL,
      created_at TEXT NOT NULL,
      ready_at TEXT
    );
    CREATE INDEX IF NOT EXISTS idx_send_versions_doc ON send_versions(document_id, n);
    CREATE INDEX IF NOT EXISTS idx_send_versions_status ON send_versions(status, render_claimed_at);

    CREATE TABLE IF NOT EXISTS send_version_parts (
      version_id TEXT NOT NULL REFERENCES send_versions(id) ON DELETE CASCADE,
      n INTEGER NOT NULL,
      ref TEXT NOT NULL,
      size INTEGER NOT NULL,
      PRIMARY KEY (version_id, n)
    );

    CREATE TABLE IF NOT EXISTS send_pages (
      version_id TEXT NOT NULL REFERENCES send_versions(id) ON DELETE CASCADE,
      page INTEGER NOT NULL,
      ref TEXT NOT NULL,
      width INTEGER NOT NULL,
      height INTEGER NOT NULL,
      PRIMARY KEY (version_id, page)
    );

    CREATE TABLE IF NOT EXISTS send_spaces (
      id TEXT PRIMARY KEY,
      workspace_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      owner_id TEXT NOT NULL,
      title TEXT NOT NULL,
      description TEXT NOT NULL DEFAULT '',
      sharing TEXT NOT NULL DEFAULT 'private',
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      deleted_at TEXT
    );
    CREATE INDEX IF NOT EXISTS idx_send_spaces_ws ON send_spaces(workspace_id, deleted_at, updated_at);

    CREATE TABLE IF NOT EXISTS send_space_items (
      space_id TEXT NOT NULL REFERENCES send_spaces(id) ON DELETE CASCADE,
      document_id TEXT NOT NULL REFERENCES send_documents(id) ON DELETE CASCADE,
      position INTEGER NOT NULL DEFAULT 0,
      folder TEXT NOT NULL DEFAULT '',
      added_at TEXT NOT NULL,
      PRIMARY KEY (space_id, document_id)
    );

    CREATE TABLE IF NOT EXISTS send_links (
      id TEXT PRIMARY KEY,
      workspace_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      document_id TEXT REFERENCES send_documents(id) ON DELETE CASCADE,
      space_id TEXT REFERENCES send_spaces(id) ON DELETE CASCADE,
      created_by TEXT NOT NULL,
      name TEXT NOT NULL,
      recipient_email TEXT,
      token_hash TEXT NOT NULL UNIQUE,
      token_sealed TEXT NOT NULL,
      require_email INTEGER NOT NULL DEFAULT 0,
      verify_email INTEGER NOT NULL DEFAULT 0,
      passcode_hash TEXT,
      expires_at TEXT,
      allow_download INTEGER NOT NULL DEFAULT 0,
      access_mode TEXT NOT NULL DEFAULT 'none',
      access_list TEXT NOT NULL DEFAULT '[]',
      watermark INTEGER NOT NULL DEFAULT 0,
      nda_template_id TEXT,
      message TEXT NOT NULL DEFAULT '',
      notify INTEGER NOT NULL DEFAULT 1,
      use_branding INTEGER NOT NULL DEFAULT 1,
      access_epoch INTEGER NOT NULL DEFAULT 1,
      disabled_at TEXT,
      last_visit_at TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      deleted_at TEXT
    );
    CREATE INDEX IF NOT EXISTS idx_send_links_doc ON send_links(document_id, deleted_at);
    CREATE INDEX IF NOT EXISTS idx_send_links_space ON send_links(space_id, deleted_at);

    CREATE TABLE IF NOT EXISTS send_link_items (
      link_id TEXT NOT NULL REFERENCES send_links(id) ON DELETE CASCADE,
      document_id TEXT NOT NULL REFERENCES send_documents(id) ON DELETE CASCADE,
      visible INTEGER NOT NULL DEFAULT 1,
      downloadable INTEGER NOT NULL DEFAULT 1,
      PRIMARY KEY (link_id, document_id)
    );

    CREATE TABLE IF NOT EXISTS send_space_access (
      space_id TEXT NOT NULL REFERENCES send_spaces(id) ON DELETE CASCADE,
      email TEXT NOT NULL,
      document_ids TEXT NOT NULL DEFAULT '[]',
      created_at TEXT NOT NULL,
      PRIMARY KEY (space_id, email)
    );

    CREATE TABLE IF NOT EXISTS send_visitors (
      id TEXT PRIMARY KEY,
      workspace_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      email TEXT,
      contact_id TEXT,
      first_seen_at TEXT NOT NULL,
      last_seen_at TEXT NOT NULL
    );
    CREATE UNIQUE INDEX IF NOT EXISTS idx_send_visitors_email ON send_visitors(workspace_id, email) WHERE email IS NOT NULL;

    CREATE TABLE IF NOT EXISTS send_sessions (
      id TEXT PRIMARY KEY,
      link_id TEXT NOT NULL REFERENCES send_links(id) ON DELETE CASCADE,
      workspace_id TEXT NOT NULL,
      visitor_id TEXT,
      token_hash TEXT NOT NULL UNIQUE,
      epoch INTEGER NOT NULL DEFAULT 1,
      passcode_ok INTEGER NOT NULL DEFAULT 0,
      email TEXT,
      email_verified INTEGER NOT NULL DEFAULT 0,
      nda_envelope_id TEXT,
      nda_signed_at TEXT,
      created_at TEXT NOT NULL,
      expires_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_send_sessions_link ON send_sessions(link_id);

    CREATE TABLE IF NOT EXISTS send_email_codes (
      id TEXT PRIMARY KEY,
      session_id TEXT NOT NULL REFERENCES send_sessions(id) ON DELETE CASCADE,
      email TEXT NOT NULL,
      code_hash TEXT NOT NULL,
      attempts INTEGER NOT NULL DEFAULT 0,
      expires_at TEXT NOT NULL,
      used_at TEXT,
      created_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_send_email_codes_session ON send_email_codes(session_id, created_at);

    CREATE TABLE IF NOT EXISTS send_visits (
      id TEXT PRIMARY KEY,
      workspace_id TEXT NOT NULL,
      link_id TEXT NOT NULL REFERENCES send_links(id) ON DELETE CASCADE,
      session_id TEXT NOT NULL,
      visitor_id TEXT,
      document_id TEXT NOT NULL,
      version_id TEXT NOT NULL,
      email TEXT,
      email_verified INTEGER NOT NULL DEFAULT 0,
      forwarded INTEGER NOT NULL DEFAULT 0,
      started_at TEXT NOT NULL,
      last_ping_at TEXT NOT NULL,
      seconds REAL NOT NULL DEFAULT 0,
      pages_seen INTEGER NOT NULL DEFAULT 0,
      page_total INTEGER NOT NULL DEFAULT 0,
      downloads INTEGER NOT NULL DEFAULT 0,
      device TEXT NOT NULL DEFAULT '',
      os TEXT NOT NULL DEFAULT '',
      browser TEXT NOT NULL DEFAULT '',
      country TEXT,
      city TEXT,
      alerted_at TEXT
    );
    CREATE INDEX IF NOT EXISTS idx_send_visits_doc ON send_visits(document_id, started_at);
    CREATE INDEX IF NOT EXISTS idx_send_visits_link ON send_visits(link_id, started_at);
    CREATE INDEX IF NOT EXISTS idx_send_visits_session ON send_visits(session_id, document_id, last_ping_at);
    CREATE INDEX IF NOT EXISTS idx_send_visits_visitor ON send_visits(visitor_id, started_at);

    CREATE TABLE IF NOT EXISTS send_page_stats (
      visit_id TEXT NOT NULL REFERENCES send_visits(id) ON DELETE CASCADE,
      page INTEGER NOT NULL,
      seconds REAL NOT NULL DEFAULT 0,
      first_at TEXT NOT NULL,
      last_at TEXT NOT NULL,
      PRIMARY KEY (visit_id, page)
    );

    CREATE TABLE IF NOT EXISTS send_events (
      id TEXT PRIMARY KEY,
      workspace_id TEXT NOT NULL,
      link_id TEXT NOT NULL,
      document_id TEXT,
      type TEXT NOT NULL,
      email TEXT,
      detail TEXT NOT NULL DEFAULT '',
      created_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_send_events_link ON send_events(link_id, created_at);

    CREATE TABLE IF NOT EXISTS send_download_cache (
      session_id TEXT NOT NULL,
      version_id TEXT NOT NULL,
      refs TEXT NOT NULL,
      size INTEGER NOT NULL,
      expires_at TEXT NOT NULL,
      PRIMARY KEY (session_id, version_id)
    );

    CREATE TABLE IF NOT EXISTS send_settings (
      workspace_id TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
      brand_name TEXT NOT NULL DEFAULT '',
      logo_url TEXT NOT NULL DEFAULT '',
      brand_color TEXT NOT NULL DEFAULT '',
      site_url TEXT NOT NULL DEFAULT '',
      updated_at TEXT NOT NULL
    );
  `);
}
