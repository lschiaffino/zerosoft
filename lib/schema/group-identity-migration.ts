import type { Client } from '@libsql/client';

/**
 * Lines: un grupo de WhatsApp es uno solo aunque esté en varias líneas.
 *
 * groups_chats tiene una fila por línea (UNIQUE(number_id, provider_chat_id)):
 * el mismo grupo agregado a dos números son dos chats. groups_identities es el
 * grupo en sí, por workspace y JID ("1203…@g.us"), y guarda lo que es del
 * grupo y no de una línea: hoy, su empresa de HubSpot (una sola, la
 * relación es única). Los vínculos por chat (groups_hubspot_links) quedan
 * como copia de esa empresa en cada línea, para lo que ya los lee (bandeja,
 * filtros, notas).
 *
 * Al migrar: una identidad por grupo y, si las líneas tenían empresas
 * distintas, gana la vinculada más recientemente y se copia a las demás.
 * Se puede correr dos veces: lo que ya está no cambia.
 */
export async function groupIdentityUp(c: Client): Promise<void> {
  await c.executeMultiple(`
    CREATE TABLE IF NOT EXISTS groups_identities (
      user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      jid TEXT NOT NULL,
      company_id TEXT NOT NULL DEFAULT '',
      linked_by TEXT,
      linked_at TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      PRIMARY KEY (user_id, jid)
    );
    CREATE INDEX IF NOT EXISTS idx_groups_identities_company ON groups_identities(user_id, company_id) WHERE company_id != '';
    CREATE INDEX IF NOT EXISTS idx_groups_chats_jid ON groups_chats(user_id, provider_chat_id) WHERE kind = 'group';
  `);
  await c.execute(
    `INSERT OR IGNORE INTO groups_identities (user_id, jid, created_at, updated_at)
     SELECT user_id, provider_chat_id, MIN(created_at), datetime('now') FROM groups_chats WHERE kind = 'group' GROUP BY user_id, provider_chat_id`,
  );
  const links = await c.execute(
    `SELECT ch.user_id, ch.provider_chat_id AS jid, l.object_id, l.name, l.props, l.fetched_at, l.missing, l.linked_by, l.created_at
     FROM groups_hubspot_links l JOIN groups_chats ch ON ch.id = l.chat_id
     WHERE l.object_type = 'company' AND ch.kind = 'group'
     ORDER BY l.created_at DESC, l.rowid DESC`,
  );
  const seen = new Set<string>();
  for (const r of links.rows) {
    const ws = String(r.user_id);
    const jid = String(r.jid);
    const key = `${ws}\n${jid}`;
    if (seen.has(key)) continue;
    seen.add(key);
    await c.execute({
      sql: "UPDATE groups_identities SET company_id = ?, linked_by = ?, linked_at = ?, updated_at = datetime('now') WHERE user_id = ? AND jid = ? AND company_id = ''",
      args: [String(r.object_id), r.linked_by === null ? null : String(r.linked_by), String(r.created_at), ws, jid],
    });
    const id = await c.execute({ sql: 'SELECT company_id FROM groups_identities WHERE user_id = ? AND jid = ?', args: [ws, jid] });
    const companyId = String(id.rows[0]?.company_id ?? '');
    if (companyId !== String(r.object_id)) continue;
    // Las demás líneas del grupo quedan con la misma empresa.
    await c.execute({
      sql: `INSERT INTO groups_hubspot_links (chat_id, user_id, object_type, object_id, name, props, fetched_at, missing, linked_by, created_at)
            SELECT ch.id, ch.user_id, 'company', ?, ?, ?, ?, ?, ?, ? FROM groups_chats ch
            WHERE ch.user_id = ? AND ch.provider_chat_id = ? AND ch.kind = 'group'
            ON CONFLICT(chat_id, object_type) DO UPDATE SET object_id = excluded.object_id, name = excluded.name, props = excluded.props,
              fetched_at = excluded.fetched_at, missing = excluded.missing, linked_by = excluded.linked_by
            WHERE groups_hubspot_links.object_id != excluded.object_id`,
      args: [companyId, String(r.name ?? ''), String(r.props ?? '{}'), r.fetched_at === null ? null : String(r.fetched_at), Number(r.missing ?? 0), r.linked_by === null ? null : String(r.linked_by), String(r.created_at), ws, jid],
    });
  }
}
