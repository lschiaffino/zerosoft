import type { Migration } from '../migrations';

/**
 * Inbox: un chat vinculado al CRM de zerosoft (pestaña CRM del panel del chat), como en Lines.
 *
 * Inbox es de la persona y el CRM es del workspace: el vínculo va por chat y por workspace (`workspace_id`, el
 * workspace activo cuando se vinculó), así quien está en dos workspaces tiene uno en cada uno. `owner_id` es la
 * persona dueña del chat. Los ids se vuelven a mirar con la visibilidad del CRM al leerlos (lib/inbox/crm.ts).
 * Cae con el chat (FK en cascada).
 *
 * Idempotente: tabla e índice con IF NOT EXISTS.
 */
export default {
  id: '20261123_2011_inbox_crm_links',
  up: async (c) => {
    await c.execute(`
      CREATE TABLE IF NOT EXISTS inbox_crm_links (
        thread_id TEXT NOT NULL REFERENCES inbox_threads(id) ON DELETE CASCADE,
        workspace_id TEXT NOT NULL,
        owner_id TEXT NOT NULL,
        crm_contact_id TEXT,
        crm_company_id TEXT,
        updated_at TEXT NOT NULL DEFAULT (datetime('now')),
        PRIMARY KEY (thread_id, workspace_id)
      )
    `);
    await c.execute('CREATE INDEX IF NOT EXISTS idx_inbox_crm_links_owner ON inbox_crm_links(owner_id, workspace_id)');
  },
} satisfies Migration;
