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
 * Triage time en Insights (como Linear): cuándo salió el issue de triage
 * (aceptado, rechazado, marcado duplicado o movido a otro team). Desde que se
 * creó hasta acá es su tiempo en triage. Los issues que salieron antes de esta
 * migración quedan sin dato y no entran en la medida.
 */
export default {
  id: '20261123_2312_track_triage_resolved_at',
  up: async (c) => {
    await addColumn(c, 'ALTER TABLE track_issues ADD COLUMN triage_resolved_at TEXT');
  },
} satisfies Migration;
