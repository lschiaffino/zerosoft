import type { Migration } from '../migrations';

/**
 * People: notas sobre una persona (la pestaña Notas de la ficha). Las ven HR
 * y la cadena de managers, nunca la persona. Borrar la ficha borra sus notas.
 * Idempotente.
 */
export default {
  id: '20261119_1415_people_notes',
  up: async (c) => {
    await c.execute(`
      CREATE TABLE IF NOT EXISTS people_notes (
        id TEXT PRIMARY KEY,
        workspace_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        employee_id TEXT NOT NULL REFERENCES people_employees(id) ON DELETE CASCADE,
        author_id TEXT NOT NULL,
        body TEXT NOT NULL,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      )
    `);
    await c.execute('CREATE INDEX IF NOT EXISTS people_notes_employee ON people_notes (workspace_id, employee_id, created_at)');
  },
} satisfies Migration;
