import type { Client } from '@libsql/client';
import type { Migration } from '../migrations';

async function addColumn(client: Client, sql: string): Promise<void> {
  try {
    await client.execute(sql);
  } catch (err) {
    if (!/duplicate column/i.test(String(err))) throw err;
  }
}

/**
 * Estado Duplicado (como Linear): marcar un issue como duplicado de otro lo
 * pasa al estado "Duplicate" de su team (de tipo cancelado), lo enlaza con el
 * original y le pasa suscriptos y pedidos de clientes.
 *
 * - track_projects.duplicate_status_id: el estado al que van los duplicados
 *   del team (se crea la primera vez que se marca uno; se puede renombrar).
 * - track_issue_duplicates: una fila por issue marcado, con lo que se movió,
 *   para poder deshacerlo (⌘Z o "Quitar duplicado") sin tocar lo que no era
 *   de la marca.
 */
export default {
  id: '20261123_0637_track_duplicate_marks',
  up: async (c) => {
    await addColumn(c, 'ALTER TABLE track_projects ADD COLUMN duplicate_status_id TEXT');
    await c.execute(`CREATE TABLE IF NOT EXISTS track_issue_duplicates (
      issue_id TEXT PRIMARY KEY,
      original_id TEXT NOT NULL,
      relation_id TEXT,
      relation_prev_type TEXT,
      prev_status_id TEXT,
      prev_triage INTEGER NOT NULL DEFAULT 0,
      moved_subscribers TEXT NOT NULL DEFAULT '[]',
      moved_requests TEXT NOT NULL DEFAULT '[]',
      summary_activity_id TEXT,
      created_by TEXT,
      created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
    )`);
    await c.execute('CREATE INDEX IF NOT EXISTS idx_track_issue_duplicates_original ON track_issue_duplicates(original_id)');
  },
} satisfies Migration;
