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
 * Pulse: las alertas sobre insights también pueden avisar por email.
 *
 * - analytics_alerts.email: 1 = además del aviso en la app, un email a cada
 *   persona suscripta. Las alertas de antes quedan en 0 (solo en la app).
 *
 * Idempotente: columna con addColumn.
 */
export default {
  id: '20261122_1400_pulse_alert_email',
  up: async (c) => {
    await addColumn(c, 'ALTER TABLE analytics_alerts ADD COLUMN email INTEGER NOT NULL DEFAULT 0');
  },
} satisfies Migration;
