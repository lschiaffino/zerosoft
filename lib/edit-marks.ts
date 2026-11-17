/**
 * Quién editó qué y en qué hora (Docs y Board): una fila por página o
 * pizarra, persona y hora UTC, con cuántos guardados hubo. Lo lee la
 * analítica de cada app (lib/docs-analytics.ts, lib/board-analytics.ts).
 * Nunca tira: anotar no puede romper el guardado.
 */
import { getDb } from './db';

const TABLES = {
  docs: { table: 'docs_edit_marks', col: 'page_id' },
  board: { table: 'board_edit_marks', col: 'board_id' },
} as const;

/** La hora UTC de un instante, como se guarda ('YYYY-MM-DDTHH'). */
export const markHour = (d: Date) => d.toISOString().slice(0, 13);

/** El instante (ms) del comienzo de una hora guardada. */
export const markHourMs = (hour: string) => Date.parse(`${hour}:00:00Z`);

export async function markEdit(app: keyof typeof TABLES, workspaceId: string, id: string, personId: string | null, now = new Date()): Promise<void> {
  const { table, col } = TABLES[app];
  try {
    await getDb()
      .prepare(
        `INSERT INTO ${table} (workspace_id, ${col}, person_id, hour, saves) VALUES (?, ?, ?, ?, 1)
         ON CONFLICT(${col}, person_id, hour) DO UPDATE SET saves = MIN(saves + 1, 100000)`,
      )
      .run(workspaceId, id, personId ?? '', markHour(now));
  } catch {
    /* sin marca */
  }
}
