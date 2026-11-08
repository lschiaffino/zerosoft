import type { Client } from '@libsql/client';

/**
 * Inbox (personal): WhatsApp y Gmail de una persona. Todo cuelga de owner_id,
 * el id real de la persona (nunca el workspace): ni el workspace ni sus
 * admins llegan a estas filas. Las credenciales de cada cuenta (token de la
 * instancia de WhatsApp, tokens de Google) van cifradas en `config`.
 */
export async function inboxUp(client: Client): Promise<void> {
  await client.executeMultiple(`
    CREATE TABLE IF NOT EXISTS inbox_accounts (
      id TEXT PRIMARY KEY,
      owner_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      kind TEXT NOT NULL,
      provider TEXT NOT NULL DEFAULT '',
      label TEXT NOT NULL DEFAULT '',
      address TEXT NOT NULL DEFAULT '',
      status TEXT NOT NULL DEFAULT 'disconnected',
      config TEXT NOT NULL DEFAULT '',
      webhook_secret TEXT NOT NULL DEFAULT '',
      sync_cursor TEXT NOT NULL DEFAULT '',
      sync_claimed_until TEXT,
      last_sync_at TEXT,
      error TEXT NOT NULL DEFAULT '',
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_inbox_accounts_owner ON inbox_accounts(owner_id, kind);

    CREATE TABLE IF NOT EXISTS inbox_threads (
      id TEXT PRIMARY KEY,
      owner_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      account_id TEXT NOT NULL REFERENCES inbox_accounts(id) ON DELETE CASCADE,
      channel TEXT NOT NULL,
      kind TEXT NOT NULL,
      external_id TEXT NOT NULL,
      title TEXT NOT NULL DEFAULT '',
      handle TEXT NOT NULL DEFAULT '',
      preview TEXT NOT NULL DEFAULT '',
      last_message_at TEXT,
      last_inbound_at TEXT,
      last_outbound_at TEXT,
      last_from_me INTEGER NOT NULL DEFAULT 0,
      unread INTEGER NOT NULL DEFAULT 0,
      pinned_at TEXT,
      done_at TEXT,
      snoozed_until TEXT,
      woke_at TEXT,
      woke_reason TEXT NOT NULL DEFAULT '',
      follow_up_at TEXT,
      follow_up_since TEXT,
      muted_until TEXT,
      draft TEXT NOT NULL DEFAULT '',
      notes TEXT NOT NULL DEFAULT '',
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      UNIQUE (account_id, external_id)
    );
    CREATE INDEX IF NOT EXISTS idx_inbox_threads_owner ON inbox_threads(owner_id, done_at, last_message_at);
    CREATE INDEX IF NOT EXISTS idx_inbox_threads_snooze ON inbox_threads(snoozed_until);
    CREATE INDEX IF NOT EXISTS idx_inbox_threads_follow ON inbox_threads(follow_up_at);

    CREATE TABLE IF NOT EXISTS inbox_messages (
      id TEXT PRIMARY KEY,
      owner_id TEXT NOT NULL,
      thread_id TEXT NOT NULL REFERENCES inbox_threads(id) ON DELETE CASCADE,
      external_id TEXT NOT NULL,
      from_me INTEGER NOT NULL DEFAULT 0,
      sender_name TEXT NOT NULL DEFAULT '',
      sender_handle TEXT NOT NULL DEFAULT '',
      subject TEXT NOT NULL DEFAULT '',
      body TEXT NOT NULL DEFAULT '',
      email_to TEXT NOT NULL DEFAULT '',
      email_cc TEXT NOT NULL DEFAULT '',
      email_message_id TEXT NOT NULL DEFAULT '',
      media_type TEXT NOT NULL DEFAULT '',
      media_name TEXT NOT NULL DEFAULT '',
      media_ref TEXT NOT NULL DEFAULT '',
      reply_to TEXT NOT NULL DEFAULT '',
      status TEXT NOT NULL DEFAULT '',
      edited INTEGER NOT NULL DEFAULT 0,
      revoked_at TEXT,
      sent_at TEXT NOT NULL,
      created_at TEXT NOT NULL,
      UNIQUE (thread_id, external_id)
    );
    CREATE INDEX IF NOT EXISTS idx_inbox_messages_thread ON inbox_messages(thread_id, sent_at);
    CREATE INDEX IF NOT EXISTS idx_inbox_messages_owner ON inbox_messages(owner_id);

    CREATE TABLE IF NOT EXISTS inbox_folders (
      id TEXT PRIMARY KEY,
      owner_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      name TEXT NOT NULL,
      color TEXT NOT NULL DEFAULT '',
      icon TEXT NOT NULL DEFAULT '',
      position INTEGER NOT NULL DEFAULT 0,
      parent_id TEXT,
      rule TEXT NOT NULL DEFAULT '',
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_inbox_folders_owner ON inbox_folders(owner_id, position);

    CREATE TABLE IF NOT EXISTS inbox_thread_folders (
      thread_id TEXT NOT NULL REFERENCES inbox_threads(id) ON DELETE CASCADE,
      folder_id TEXT NOT NULL REFERENCES inbox_folders(id) ON DELETE CASCADE,
      PRIMARY KEY (thread_id, folder_id)
    );
    CREATE INDEX IF NOT EXISTS idx_inbox_thread_folders_folder ON inbox_thread_folders(folder_id);

    CREATE TABLE IF NOT EXISTS inbox_snippets (
      id TEXT PRIMARY KEY,
      owner_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      shortcut TEXT NOT NULL DEFAULT '',
      title TEXT NOT NULL,
      body TEXT NOT NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_inbox_snippets_owner ON inbox_snippets(owner_id, title);

    CREATE TABLE IF NOT EXISTS inbox_scheduled (
      id TEXT PRIMARY KEY,
      owner_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      thread_id TEXT NOT NULL REFERENCES inbox_threads(id) ON DELETE CASCADE,
      body TEXT NOT NULL,
      send_at TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'pending',
      error TEXT NOT NULL DEFAULT '',
      claimed_until TEXT,
      sent_at TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_inbox_scheduled_due ON inbox_scheduled(status, send_at);
    CREATE INDEX IF NOT EXISTS idx_inbox_scheduled_owner ON inbox_scheduled(owner_id, status);
  `);
}
