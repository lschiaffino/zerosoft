import type { Migration } from '../migrations';

/**
 * Contactos de Lines e Inbox (lib/groups-contacts.ts, lib/inbox/contacts.ts):
 *
 * - groups_contact_links: el contacto de HubSpot de una persona en el
 *   workspace (una por teléfono o, si todavía no se sabe, por lid), con su
 *   empresa. Lo que vale para todas las líneas; los chats 1:1 de esa persona
 *   guardan su copia en groups_hubspot_links como hasta ahora.
 * - Índices para "último mensaje" de cada persona en los grupos (lo que
 *   mandó), sin recorrer todos los mensajes del workspace o de la persona.
 *
 * Se puede correr dos veces y en paralelo.
 */
export default {
  id: '20261115_1354_wa_contacts_people',
  up: async (c) => {
    await c.executeMultiple(`
      CREATE TABLE IF NOT EXISTS groups_contact_links (
        id TEXT PRIMARY KEY,
        user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        phone TEXT NOT NULL DEFAULT '',
        lid TEXT NOT NULL DEFAULT '',
        contact_id TEXT NOT NULL,
        contact_name TEXT NOT NULL DEFAULT '',
        email TEXT NOT NULL DEFAULT '',
        company_id TEXT NOT NULL DEFAULT '',
        company_name TEXT NOT NULL DEFAULT '',
        missing INTEGER NOT NULL DEFAULT 0,
        linked_by TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
      CREATE UNIQUE INDEX IF NOT EXISTS idx_groups_contact_links_phone ON groups_contact_links(user_id, phone) WHERE phone <> '';
      CREATE UNIQUE INDEX IF NOT EXISTS idx_groups_contact_links_lid ON groups_contact_links(user_id, lid) WHERE lid <> '' AND phone = '';
      CREATE INDEX IF NOT EXISTS idx_groups_contact_links_contact ON groups_contact_links(user_id, contact_id);
      CREATE INDEX IF NOT EXISTS idx_groups_messages_sender ON groups_messages(user_id, sender_phone, chat_id, created_at) WHERE direction = 'in' AND sender_phone <> '';
      CREATE INDEX IF NOT EXISTS idx_inbox_messages_sender ON inbox_messages(owner_id, sender_handle, thread_id, sent_at) WHERE from_me = 0 AND sender_handle <> '';
    `);
  },
} satisfies Migration;
