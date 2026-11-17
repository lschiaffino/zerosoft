import type { Migration } from '../migrations';

/**
 * HubSpot: propiedades del contacto y del negocio en Lines e Inbox
 * (lib/hubspot-objects.ts).
 * - hubspot_object_schema: la definición de las propiedades de contactos y de
 *   negocios de la cuenta, sus grupos y las que el workspace eligió mostrar,
 *   por workspace y objeto; con el error si el token no las puede leer.
 * - hubspot_view_object_props: las que cada persona eligió ver del contacto y
 *   del negocio (la empresa sigue en hubspot_view_props).
 */
export default {
  id: '20261117_1003_hubspot_object_props',
  up: async (c) => {
    await c.executeMultiple(`
      CREATE TABLE IF NOT EXISTS hubspot_object_schema (
        ws TEXT NOT NULL,
        object_type TEXT NOT NULL,
        props TEXT NOT NULL DEFAULT '[]',
        groups TEXT NOT NULL DEFAULT '[]',
        pinned TEXT NOT NULL DEFAULT '[]',
        synced_at TEXT,
        error TEXT NOT NULL DEFAULT '',
        PRIMARY KEY (ws, object_type)
      );
      CREATE TABLE IF NOT EXISTS hubspot_view_object_props (
        ws TEXT NOT NULL,
        user_id TEXT NOT NULL,
        object_type TEXT NOT NULL,
        props TEXT NOT NULL DEFAULT '[]',
        updated_at TEXT NOT NULL,
        PRIMARY KEY (ws, user_id, object_type)
      );
    `);
  },
} satisfies Migration;
