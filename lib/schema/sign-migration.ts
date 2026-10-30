import type { Client } from '@libsql/client';

/**
 * Sign (DocuSign): sobres con su PDF, destinatarios en orden de firma,
 * campos por destinatario, la línea de auditoría y plantillas con roles.
 * Todo cuelga del workspace (workspace_id = id del owner). Los archivos son
 * referencias privadas (lib/sign/files.ts), nunca URLs públicas. Los tokens de
 * firma y los códigos por email se guardan solo como hash.
 */
export async function signUp(client: Client): Promise<void> {
  await client.executeMultiple(`
    CREATE TABLE IF NOT EXISTS sign_envelopes (
      id TEXT PRIMARY KEY,
      workspace_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      created_by TEXT NOT NULL,
      title TEXT NOT NULL,
      message TEXT NOT NULL DEFAULT '',
      status TEXT NOT NULL DEFAULT 'draft',
      signing_order TEXT NOT NULL DEFAULT 'sequential',
      otp_required INTEGER NOT NULL DEFAULT 1,
      expires_days INTEGER NOT NULL DEFAULT 30,
      expires_at TEXT,
      reminder_days INTEGER NOT NULL DEFAULT 0,
      locale TEXT NOT NULL DEFAULT 'en',
      document_ref TEXT,
      document_name TEXT NOT NULL DEFAULT '',
      document_hash TEXT,
      upload_hash TEXT,
      pages TEXT NOT NULL DEFAULT '[]',
      final_ref TEXT,
      final_hash TEXT,
      flattened_hash TEXT,
      source TEXT NOT NULL DEFAULT 'upload',
      links TEXT NOT NULL DEFAULT '[]',
      template_id TEXT,
      bulk_id TEXT,
      sent_at TEXT,
      completed_at TEXT,
      declined_at TEXT,
      voided_at TEXT,
      void_reason TEXT NOT NULL DEFAULT '',
      expired_at TEXT,
      finalize_claimed_at TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_sign_envelopes_ws ON sign_envelopes(workspace_id, status, updated_at);
    CREATE INDEX IF NOT EXISTS idx_sign_envelopes_bulk ON sign_envelopes(bulk_id);
    CREATE TABLE IF NOT EXISTS sign_recipients (
      id TEXT PRIMARY KEY,
      envelope_id TEXT NOT NULL REFERENCES sign_envelopes(id) ON DELETE CASCADE,
      role TEXT NOT NULL DEFAULT 'signer',
      role_name TEXT NOT NULL DEFAULT '',
      name TEXT NOT NULL,
      email TEXT NOT NULL,
      routing_order INTEGER NOT NULL DEFAULT 1,
      status TEXT NOT NULL DEFAULT 'created',
      token_hash TEXT,
      token_nonce TEXT,
      session_hash TEXT,
      otp_hash TEXT,
      otp_expires_at TEXT,
      otp_attempts INTEGER NOT NULL DEFAULT 0,
      otp_verified_at TEXT,
      consent_at TEXT,
      notified_at TEXT,
      reminded_at TEXT,
      viewed_at TEXT,
      signed_at TEXT,
      declined_at TEXT,
      decline_reason TEXT NOT NULL DEFAULT '',
      signature_image TEXT NOT NULL DEFAULT '',
      signature_kind TEXT NOT NULL DEFAULT '',
      initials_image TEXT NOT NULL DEFAULT '',
      ip TEXT NOT NULL DEFAULT '',
      user_agent TEXT NOT NULL DEFAULT '',
      created_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_sign_recipients_env ON sign_recipients(envelope_id, routing_order);
    CREATE UNIQUE INDEX IF NOT EXISTS idx_sign_recipients_token ON sign_recipients(token_hash);
    CREATE INDEX IF NOT EXISTS idx_sign_recipients_email ON sign_recipients(email);
    CREATE TABLE IF NOT EXISTS sign_fields (
      id TEXT PRIMARY KEY,
      envelope_id TEXT NOT NULL REFERENCES sign_envelopes(id) ON DELETE CASCADE,
      recipient_id TEXT NOT NULL REFERENCES sign_recipients(id) ON DELETE CASCADE,
      kind TEXT NOT NULL,
      page INTEGER NOT NULL,
      x REAL NOT NULL,
      y REAL NOT NULL,
      w REAL NOT NULL,
      h REAL NOT NULL,
      required INTEGER NOT NULL DEFAULT 1,
      label TEXT NOT NULL DEFAULT '',
      options TEXT NOT NULL DEFAULT '[]',
      value TEXT,
      filled_at TEXT
    );
    CREATE INDEX IF NOT EXISTS idx_sign_fields_env ON sign_fields(envelope_id, recipient_id);
    CREATE TABLE IF NOT EXISTS sign_events (
      id TEXT PRIMARY KEY,
      envelope_id TEXT NOT NULL REFERENCES sign_envelopes(id) ON DELETE CASCADE,
      recipient_id TEXT,
      actor_id TEXT,
      kind TEXT NOT NULL,
      ip TEXT NOT NULL DEFAULT '',
      user_agent TEXT NOT NULL DEFAULT '',
      detail TEXT NOT NULL DEFAULT '{}',
      created_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_sign_events_env ON sign_events(envelope_id, created_at);
    CREATE TABLE IF NOT EXISTS sign_templates (
      id TEXT PRIMARY KEY,
      workspace_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      created_by TEXT NOT NULL,
      name TEXT NOT NULL,
      description TEXT NOT NULL DEFAULT '',
      message TEXT NOT NULL DEFAULT '',
      signing_order TEXT NOT NULL DEFAULT 'sequential',
      otp_required INTEGER NOT NULL DEFAULT 1,
      expires_days INTEGER NOT NULL DEFAULT 30,
      reminder_days INTEGER NOT NULL DEFAULT 0,
      document_ref TEXT,
      document_name TEXT NOT NULL DEFAULT '',
      document_hash TEXT,
      pages TEXT NOT NULL DEFAULT '[]',
      roles TEXT NOT NULL DEFAULT '[]',
      fields TEXT NOT NULL DEFAULT '[]',
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_sign_templates_ws ON sign_templates(workspace_id, updated_at);
  `);
}
