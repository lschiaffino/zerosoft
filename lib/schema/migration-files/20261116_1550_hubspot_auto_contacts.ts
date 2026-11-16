import type { Migration } from '../migrations';

/**
 * HubSpot: alta automática de contactos cuando entra un chat 1:1 nuevo
 * (lib/hubspot-auto-contacts.ts), apagada por defecto.
 * - groups_hubspot.auto_create / auto_create_since: el ajuste del workspace
 *   para Lines y desde cuándo vale (solo chats creados después).
 * - inbox_hubspot_auto: el mismo ajuste en Inbox, por persona (sus chats son
 *   suyos), con el workspace cuyo HubSpot usa.
 * - hubspot_auto_contacts: cada chat que el cron ya miró (claim por fila), con
 *   lo que pasó: creado, ya existía o el error.
 * - hubspot_view_props: las propiedades de la empresa que cada persona eligió
 *   ver en los detalles del chat y en el panel de HubSpot (Lines e Inbox).
 */
export default {
  id: '20261116_1550_hubspot_auto_contacts',
  up: async (c) => {
    for (const sql of ['ALTER TABLE groups_hubspot ADD COLUMN auto_create INTEGER NOT NULL DEFAULT 0', 'ALTER TABLE groups_hubspot ADD COLUMN auto_create_since TEXT']) {
      try {
        await c.execute(sql);
      } catch (err) {
        if (!/duplicate column/i.test(String(err))) throw err;
      }
    }
    await c.executeMultiple(`
      CREATE TABLE IF NOT EXISTS inbox_hubspot_auto (
        owner_id TEXT PRIMARY KEY,
        ws TEXT NOT NULL,
        since TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS hubspot_auto_contacts (
        chat_key TEXT PRIMARY KEY,
        ws TEXT NOT NULL,
        result TEXT NOT NULL DEFAULT '',
        created_at TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_hubspot_auto_contacts_ws ON hubspot_auto_contacts(ws, created_at);
      CREATE TABLE IF NOT EXISTS hubspot_view_props (
        ws TEXT NOT NULL,
        user_id TEXT NOT NULL,
        props TEXT NOT NULL DEFAULT '[]',
        updated_at TEXT NOT NULL,
        PRIMARY KEY (ws, user_id)
      );
    `);
  },
} satisfies Migration;
