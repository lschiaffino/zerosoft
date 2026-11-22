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
 * Lines: "Crear ticket en HubSpot" (lib/groups-hubspot-tickets.ts).
 * groups_tickets.hubspot_ticket_id: el ticket de HubSpot creado desde ese
 * ticket de Lines (NULL: no se mandó). Idempotente con addColumn.
 */
export default {
  id: '20261120_1921_groups_tickets_hubspot',
  up: async (c) => {
    await addColumn(c, 'ALTER TABLE groups_tickets ADD COLUMN hubspot_ticket_id TEXT');
  },
} satisfies Migration;
