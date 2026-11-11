import type { Client } from '@libsql/client';

/**
 * Orden de la bandeja de Inbox: el último mensaje y, al final, los chats sin
 * mensajes por fecha de creación ('0' ordena antes que cualquier fecha ISO).
 * Es la misma expresión del índice idx_inbox_threads_list: si cambia acá,
 * cambia el índice (una migración nueva).
 */
export function inboxSortKey(alias = ''): string {
  const p = alias ? `${alias}.` : '';
  return `(CASE WHEN ${p}last_message_at IS NULL THEN '0' || ${p}created_at ELSE ${p}last_message_at END)`;
}

/** Orden de la bandeja de Lines (la expresión de idx_groups_chats_list). */
export function linesSortKey(alias = ''): string {
  const p = alias ? `${alias}.` : '';
  return `COALESCE(${p}last_message_at, ${p}created_at)`;
}

/**
 * Bandejas de Inbox y Lines rápidas con mucho historial.
 *
 * - Listas: índices con el orden de la lista (por dueño o workspace), así una
 *   página lee solo sus filas en vez de ordenar todos los chats en cada
 *   consulta. Parciales: solo lo que la bandeja muestra (sin Hecho ni
 *   archivados), y uno chico para "no leídos" que también sirve a los
 *   contadores.
 * - Contadores: por responder y pospuestos de Inbox, archivados y carpetas de
 *   Lines salen de un índice sin tocar las filas.
 * - inbox_scheduled(thread_id): el "programados" de cada fila recorría la
 *   tabla entera.
 * - Lines: búsqueda de texto completo en los mensajes (FTS5, como Inbox). Sin
 *   FTS5 no se crea y la búsqueda sigue con LIKE.
 * - Importación de Lines: página por chat (todo el historial, retomable).
 * - Inbox: importaciones de Gmail (cursor en inbox_imports, sin cambios de
 *   esquema) y un índice para encontrar la de cada cuenta.
 */
export async function inboxLinesPerfUp(c: Client): Promise<void> {
  const ik = inboxSortKey();
  const lk = linesSortKey();
  const statements = [
    `CREATE INDEX IF NOT EXISTS idx_inbox_threads_list ON inbox_threads(owner_id, ${ik} DESC, id DESC) WHERE done_at IS NULL AND archived_at IS NULL`,
    `CREATE INDEX IF NOT EXISTS idx_inbox_threads_unread ON inbox_threads(owner_id, ${ik} DESC, id DESC) WHERE unread > 0 AND done_at IS NULL AND archived_at IS NULL`,
    `CREATE INDEX IF NOT EXISTS idx_inbox_threads_reply ON inbox_threads(owner_id, snoozed_until) WHERE done_at IS NULL AND archived_at IS NULL AND last_from_me = 0 AND kind <> 'group' AND last_message_at IS NOT NULL`,
    'CREATE INDEX IF NOT EXISTS idx_inbox_threads_snoozed ON inbox_threads(owner_id, snoozed_until, id) WHERE snoozed_until IS NOT NULL',
    'CREATE INDEX IF NOT EXISTS idx_inbox_threads_pinned ON inbox_threads(owner_id) WHERE pinned_at IS NOT NULL',
    'CREATE INDEX IF NOT EXISTS idx_inbox_scheduled_thread ON inbox_scheduled(thread_id, status)',
    'CREATE INDEX IF NOT EXISTS idx_inbox_imports_account ON inbox_imports(account_id, kind)',
    `CREATE INDEX IF NOT EXISTS idx_groups_chats_list ON groups_chats(user_id, status, ${lk} DESC, id DESC) WHERE hidden_at IS NULL AND archived_at IS NULL`,
    `CREATE INDEX IF NOT EXISTS idx_groups_chats_line_list ON groups_chats(user_id, number_id, status, ${lk} DESC, id DESC) WHERE hidden_at IS NULL AND archived_at IS NULL`,
    `CREATE INDEX IF NOT EXISTS idx_groups_chats_unread ON groups_chats(user_id, status, ${lk} DESC, id DESC) WHERE unread_count > 0 AND hidden_at IS NULL AND archived_at IS NULL`,
    'CREATE INDEX IF NOT EXISTS idx_groups_chats_pinned ON groups_chats(user_id) WHERE pinned_at IS NOT NULL',
    'CREATE INDEX IF NOT EXISTS idx_groups_chats_archived ON groups_chats(user_id, unread_count, number_id) WHERE archived_at IS NOT NULL AND hidden_at IS NULL',
    // Reemplaza a idx_groups_chats_folder (mismo prefijo y condición) y además cubre los contadores por carpeta.
    'CREATE INDEX IF NOT EXISTS idx_groups_chats_folder_list ON groups_chats(user_id, folder_id, status, archived_at, hidden_at, unread_count, number_id) WHERE folder_id IS NOT NULL',
    'DROP INDEX IF EXISTS idx_groups_chats_folder',
  ];
  for (const sql of statements) await c.execute(sql);

  // Importación de Lines: hasta qué página de cada chat se trajo en esta corrida (0 = nada) y si alguna vez
  // se llegó al principio de su historial (una reimportación corta al encontrar una página ya importada).
  for (const sql of [
    'ALTER TABLE groups_import_chats ADD COLUMN page INTEGER NOT NULL DEFAULT 0',
    'ALTER TABLE groups_import_chats ADD COLUMN complete INTEGER NOT NULL DEFAULT 0',
  ]) {
    try {
      await c.execute(sql);
    } catch (err) {
      if (!/duplicate column/i.test(String(err))) throw err;
    }
  }

  try {
    await c.execute(
      "CREATE VIRTUAL TABLE IF NOT EXISTS groups_messages_fts USING fts5(body, content='groups_messages', content_rowid='rowid', tokenize='unicode61 remove_diacritics 2')",
    );
  } catch {
    return;
  }
  await c.executeMultiple(`
    CREATE TRIGGER IF NOT EXISTS groups_messages_fts_ai AFTER INSERT ON groups_messages BEGIN
      INSERT INTO groups_messages_fts(rowid, body) VALUES (new.rowid, new.body);
    END;
    CREATE TRIGGER IF NOT EXISTS groups_messages_fts_ad AFTER DELETE ON groups_messages BEGIN
      INSERT INTO groups_messages_fts(groups_messages_fts, rowid, body) VALUES ('delete', old.rowid, old.body);
    END;
    CREATE TRIGGER IF NOT EXISTS groups_messages_fts_au AFTER UPDATE OF body ON groups_messages BEGIN
      INSERT INTO groups_messages_fts(groups_messages_fts, rowid, body) VALUES ('delete', old.rowid, old.body);
      INSERT INTO groups_messages_fts(rowid, body) VALUES (new.rowid, new.body);
    END;
    INSERT INTO groups_messages_fts(groups_messages_fts) VALUES ('rebuild');
  `);
}
