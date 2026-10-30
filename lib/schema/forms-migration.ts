import type { Client } from '@libsql/client';

/**
 * Forms (Typeform): formularios con su definición (preguntas, lógica,
 * finales, traducciones) y ajustes en JSON, acceso por formulario (todo el
 * workspace o personas elegidas), respuestas completas y parciales, archivos
 * privados de las respuestas, y visitas por pregunta para el abandono (sin
 * respuestas ni IP). Todo cuelga del workspace (workspace_id = id del owner).
 */
export async function formsUp(client: Client): Promise<void> {
  await client.executeMultiple(`
    CREATE TABLE IF NOT EXISTS forms_forms (
      id TEXT PRIMARY KEY,
      workspace_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      name TEXT NOT NULL,
      slug TEXT NOT NULL UNIQUE,
      status TEXT NOT NULL DEFAULT 'draft',
      definition TEXT NOT NULL DEFAULT '{}',
      settings TEXT NOT NULL DEFAULT '{}',
      sharing TEXT NOT NULL DEFAULT 'workspace',
      webhook_secret TEXT NOT NULL DEFAULT '',
      response_count INTEGER NOT NULL DEFAULT 0,
      created_by TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      published_at TEXT
    );
    CREATE INDEX IF NOT EXISTS idx_forms_forms_ws ON forms_forms(workspace_id, updated_at);
    CREATE TABLE IF NOT EXISTS forms_members (
      form_id TEXT NOT NULL REFERENCES forms_forms(id) ON DELETE CASCADE,
      user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      created_at TEXT NOT NULL,
      PRIMARY KEY (form_id, user_id)
    );
    CREATE TABLE IF NOT EXISTS forms_responses (
      id TEXT PRIMARY KEY,
      form_id TEXT NOT NULL REFERENCES forms_forms(id) ON DELETE CASCADE,
      workspace_id TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'completed',
      answers TEXT NOT NULL DEFAULT '{}',
      hidden TEXT NOT NULL DEFAULT '{}',
      vars TEXT NOT NULL DEFAULT '{}',
      ending_id TEXT,
      lang TEXT NOT NULL DEFAULT 'en',
      ip_hash TEXT NOT NULL DEFAULT '',
      user_agent TEXT NOT NULL DEFAULT '',
      resume_hash TEXT,
      contact_id TEXT,
      consent INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      submitted_at TEXT,
      purge_claimed_at TEXT
    );
    CREATE INDEX IF NOT EXISTS idx_forms_responses_form ON forms_responses(form_id, status, created_at);
    CREATE INDEX IF NOT EXISTS idx_forms_responses_ip ON forms_responses(form_id, ip_hash);
    CREATE UNIQUE INDEX IF NOT EXISTS idx_forms_responses_resume ON forms_responses(resume_hash) WHERE resume_hash IS NOT NULL;
    CREATE TABLE IF NOT EXISTS forms_files (
      id TEXT PRIMARY KEY,
      workspace_id TEXT NOT NULL,
      form_id TEXT NOT NULL REFERENCES forms_forms(id) ON DELETE CASCADE,
      question_id TEXT NOT NULL,
      response_id TEXT,
      ref TEXT NOT NULL,
      name TEXT NOT NULL,
      mime TEXT NOT NULL,
      size INTEGER NOT NULL,
      created_at TEXT NOT NULL,
      purge_claimed_at TEXT
    );
    CREATE INDEX IF NOT EXISTS idx_forms_files_response ON forms_files(response_id);
    CREATE INDEX IF NOT EXISTS idx_forms_files_orphan ON forms_files(created_at) WHERE response_id IS NULL;
    CREATE TABLE IF NOT EXISTS forms_visits (
      id TEXT PRIMARY KEY,
      form_id TEXT NOT NULL REFERENCES forms_forms(id) ON DELETE CASCADE,
      created_at TEXT NOT NULL,
      completed INTEGER NOT NULL DEFAULT 0
    );
    CREATE INDEX IF NOT EXISTS idx_forms_visits_form ON forms_visits(form_id, created_at);
    CREATE TABLE IF NOT EXISTS forms_visit_steps (
      visit_id TEXT NOT NULL REFERENCES forms_visits(id) ON DELETE CASCADE,
      form_id TEXT NOT NULL,
      question_id TEXT NOT NULL,
      PRIMARY KEY (visit_id, question_id)
    );
    CREATE INDEX IF NOT EXISTS idx_forms_visit_steps_form ON forms_visit_steps(form_id, question_id);
    CREATE TABLE IF NOT EXISTS forms_settings (
      workspace_id TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
      retention_days INTEGER NOT NULL DEFAULT 0,
      updated_at TEXT NOT NULL
    );
  `);
}
