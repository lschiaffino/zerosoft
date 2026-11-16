import type { Migration } from '../migrations';

/**
 * Time: registro de horas del workspace (contra Harvest).
 *
 * - time_clients: clientes de los proyectos.
 * - time_projects: proyectos, con cliente opcional, facturable, tarifa por hora
 *   (centavos) y presupuesto en minutos.
 * - time_tasks: tareas del workspace (Diseño, Desarrollo, Reuniones…), cada una
 *   facturable o no.
 * - time_entries: horas de una persona en un día, contra un proyecto y una tarea.
 *   `timer_started_at` marca el cronómetro que corre (uno por persona).
 * - time_settings: la moneda de las tarifas del workspace.
 *
 * Todo cuelga de workspace_id (el id del dueño del workspace).
 */
export default {
  id: '20261115_1940_time',
  up: async (c) => {
    await c.executeMultiple(`
      CREATE TABLE IF NOT EXISTS time_clients (
        id TEXT PRIMARY KEY,
        workspace_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        name TEXT NOT NULL,
        archived_at TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_time_clients_ws ON time_clients(workspace_id, name);

      CREATE TABLE IF NOT EXISTS time_projects (
        id TEXT PRIMARY KEY,
        workspace_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        client_id TEXT REFERENCES time_clients(id) ON DELETE SET NULL,
        name TEXT NOT NULL,
        code TEXT NOT NULL DEFAULT '',
        billable INTEGER NOT NULL DEFAULT 1,
        rate_cents INTEGER,
        budget_minutes INTEGER,
        archived_at TEXT,
        created_by TEXT NOT NULL,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_time_projects_ws ON time_projects(workspace_id, archived_at, name);

      CREATE TABLE IF NOT EXISTS time_tasks (
        id TEXT PRIMARY KEY,
        workspace_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        name TEXT NOT NULL,
        billable INTEGER NOT NULL DEFAULT 1,
        archived_at TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_time_tasks_ws ON time_tasks(workspace_id, name);

      CREATE TABLE IF NOT EXISTS time_entries (
        id TEXT PRIMARY KEY,
        workspace_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        person_id TEXT NOT NULL,
        project_id TEXT NOT NULL REFERENCES time_projects(id) ON DELETE CASCADE,
        task_id TEXT NOT NULL REFERENCES time_tasks(id),
        spent_date TEXT NOT NULL,
        minutes INTEGER NOT NULL DEFAULT 0,
        notes TEXT NOT NULL DEFAULT '',
        billable INTEGER NOT NULL DEFAULT 1,
        timer_started_at TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_time_entries_person ON time_entries(workspace_id, person_id, spent_date);
      CREATE INDEX IF NOT EXISTS idx_time_entries_project ON time_entries(project_id, spent_date);
      CREATE INDEX IF NOT EXISTS idx_time_entries_running ON time_entries(workspace_id, person_id, timer_started_at);

      CREATE TABLE IF NOT EXISTS time_settings (
        workspace_id TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
        currency TEXT NOT NULL DEFAULT 'USD',
        updated_at TEXT NOT NULL
      );
    `);
  },
} satisfies Migration;
