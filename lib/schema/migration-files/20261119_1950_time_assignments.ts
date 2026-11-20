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
 * Time: quién carga horas en cada proyecto y con qué tareas (como el equipo y
 * las tareas de un proyecto en Harvest).
 *
 * - time_projects.everyone: 1 = todas las personas con Time (lo de siempre);
 *   0 = solo las de time_project_people.
 * - time_projects.all_tasks: 1 = todas las tareas activas del workspace, cada
 *   una con su facturable; 0 = solo las de time_project_tasks, con el
 *   facturable que se eligió para este proyecto.
 *
 * Los proyectos que ya existen quedan como estaban (todos, todas las tareas).
 * Idempotente: columnas con addColumn y tablas IF NOT EXISTS.
 */
export default {
  id: '20261119_1950_time_assignments',
  up: async (c) => {
    await addColumn(c, 'ALTER TABLE time_projects ADD COLUMN everyone INTEGER NOT NULL DEFAULT 1');
    await addColumn(c, 'ALTER TABLE time_projects ADD COLUMN all_tasks INTEGER NOT NULL DEFAULT 1');
    await c.executeMultiple(`
      CREATE TABLE IF NOT EXISTS time_project_people (
        project_id TEXT NOT NULL REFERENCES time_projects(id) ON DELETE CASCADE,
        workspace_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        person_id TEXT NOT NULL,
        created_at TEXT NOT NULL,
        PRIMARY KEY (project_id, person_id)
      );
      CREATE INDEX IF NOT EXISTS idx_time_project_people_person ON time_project_people(workspace_id, person_id);

      CREATE TABLE IF NOT EXISTS time_project_tasks (
        project_id TEXT NOT NULL REFERENCES time_projects(id) ON DELETE CASCADE,
        workspace_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        task_id TEXT NOT NULL REFERENCES time_tasks(id) ON DELETE CASCADE,
        billable INTEGER NOT NULL DEFAULT 1,
        created_at TEXT NOT NULL,
        PRIMARY KEY (project_id, task_id)
      );
      CREATE INDEX IF NOT EXISTS idx_time_project_tasks_task ON time_project_tasks(workspace_id, task_id);
    `);
  },
} satisfies Migration;
