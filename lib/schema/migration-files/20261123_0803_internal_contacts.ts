import type { Migration } from '../migrations';

/**
 * Contactos internos (lib/internal-contacts.ts): teléfonos y correos del
 * equipo o de la empresa que no son clientes. Por workspace, para Lines e
 * Inbox. `internal` 1 los marca; 0 es la excepción a la regla automática (un
 * número de una línea, o un correo del dominio de la empresa, que sí es un
 * cliente). Los ajustes del workspace (las líneas cuentan como internas, los
 * dominios) van aparte, en JSON.
 */
export default {
  id: '20261123_0803_internal_contacts',
  async up(client) {
    await client.execute(
      `CREATE TABLE IF NOT EXISTS internal_contacts (
        workspace_id TEXT NOT NULL,
        handle TEXT NOT NULL,
        internal INTEGER NOT NULL DEFAULT 1,
        name TEXT NOT NULL DEFAULT '',
        created_by TEXT,
        created_at TEXT NOT NULL,
        PRIMARY KEY (workspace_id, handle)
      )`,
    );
    await client.execute('CREATE TABLE IF NOT EXISTS internal_contact_settings (workspace_id TEXT PRIMARY KEY, data TEXT NOT NULL, updated_at TEXT NOT NULL)');
  },
} satisfies Migration;
