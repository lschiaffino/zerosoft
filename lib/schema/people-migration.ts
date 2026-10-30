import type { Client } from '@libsql/client';

/**
 * People (BambooHR): fichas de las personas del workspace (user_id apunta a
 * los miembros reales; una ficha sin user_id es un ingreso que todavía no se
 * sumó), campos propios, sueldos cifrados, licencias (políticas, pedidos,
 * ajustes, feriados propios), onboarding y offboarding, documentos con
 * acuse, evaluaciones, objetivos, notas 1:1 y el registro de auditoría de
 * lo sensible. Todo cuelga del workspace (workspace_id = id del owner).
 */
export async function peopleUp(client: Client): Promise<void> {
  await client.executeMultiple(`
    CREATE TABLE IF NOT EXISTS people_settings (
      workspace_id TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
      visibility TEXT NOT NULL DEFAULT '{}',
      welcome TEXT NOT NULL DEFAULT '',
      handbook_page_id TEXT,
      countries TEXT NOT NULL DEFAULT '[]',
      updated_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS people_hr_admins (
      workspace_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      created_at TEXT NOT NULL,
      PRIMARY KEY (workspace_id, user_id)
    );
    CREATE TABLE IF NOT EXISTS people_employees (
      id TEXT PRIMARY KEY,
      workspace_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      user_id TEXT REFERENCES users(id) ON DELETE SET NULL,
      name TEXT NOT NULL,
      work_email TEXT NOT NULL DEFAULT '',
      phone TEXT NOT NULL DEFAULT '',
      job_title TEXT NOT NULL DEFAULT '',
      department TEXT NOT NULL DEFAULT '',
      location TEXT NOT NULL DEFAULT '',
      country TEXT NOT NULL DEFAULT '',
      manager_id TEXT,
      start_date TEXT,
      end_date TEXT,
      employment_type TEXT NOT NULL DEFAULT 'full_time',
      pay_period TEXT NOT NULL DEFAULT 'monthly',
      status TEXT NOT NULL DEFAULT 'active',
      photo_url TEXT NOT NULL DEFAULT '',
      pronouns TEXT NOT NULL DEFAULT '',
      bio TEXT NOT NULL DEFAULT '',
      personal TEXT NOT NULL DEFAULT '',
      custom TEXT NOT NULL DEFAULT '{}',
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
    CREATE UNIQUE INDEX IF NOT EXISTS idx_people_employees_user ON people_employees(workspace_id, user_id) WHERE user_id IS NOT NULL;
    CREATE INDEX IF NOT EXISTS idx_people_employees_ws ON people_employees(workspace_id, name);
    CREATE INDEX IF NOT EXISTS idx_people_employees_mgr ON people_employees(workspace_id, manager_id);
    CREATE TABLE IF NOT EXISTS people_fields (
      id TEXT PRIMARY KEY,
      workspace_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      label TEXT NOT NULL,
      kind TEXT NOT NULL DEFAULT 'text',
      options TEXT NOT NULL DEFAULT '[]',
      sensitive INTEGER NOT NULL DEFAULT 0,
      position INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS people_compensation (
      id TEXT PRIMARY KEY,
      workspace_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      employee_id TEXT NOT NULL REFERENCES people_employees(id) ON DELETE CASCADE,
      effective_date TEXT NOT NULL,
      data TEXT NOT NULL,
      created_by TEXT,
      created_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_people_comp_emp ON people_compensation(employee_id, effective_date);
    CREATE TABLE IF NOT EXISTS people_audit (
      id TEXT PRIMARY KEY,
      workspace_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      actor_id TEXT NOT NULL,
      employee_id TEXT,
      action TEXT NOT NULL,
      field TEXT NOT NULL,
      via TEXT NOT NULL DEFAULT 'app',
      created_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_people_audit_ws ON people_audit(workspace_id, created_at);
    CREATE TABLE IF NOT EXISTS people_policies (
      id TEXT PRIMARY KEY,
      workspace_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      name TEXT NOT NULL,
      kind TEXT NOT NULL DEFAULT 'vacation',
      accrual TEXT NOT NULL DEFAULT 'annual',
      days_per_year REAL NOT NULL DEFAULT 0,
      carryover_max REAL,
      cap_days REAL,
      half_day INTEGER NOT NULL DEFAULT 1,
      archived INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS people_adjustments (
      id TEXT PRIMARY KEY,
      workspace_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      employee_id TEXT NOT NULL REFERENCES people_employees(id) ON DELETE CASCADE,
      policy_id TEXT NOT NULL REFERENCES people_policies(id) ON DELETE CASCADE,
      date TEXT NOT NULL,
      days REAL NOT NULL,
      note TEXT NOT NULL DEFAULT '',
      created_by TEXT,
      created_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS people_requests (
      id TEXT PRIMARY KEY,
      workspace_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      employee_id TEXT NOT NULL REFERENCES people_employees(id) ON DELETE CASCADE,
      policy_id TEXT NOT NULL REFERENCES people_policies(id) ON DELETE CASCADE,
      start_date TEXT NOT NULL,
      end_date TEXT NOT NULL,
      half TEXT NOT NULL DEFAULT '',
      days REAL NOT NULL,
      note TEXT NOT NULL DEFAULT '',
      status TEXT NOT NULL DEFAULT 'pending',
      decided_by TEXT,
      decided_at TEXT,
      decision_note TEXT NOT NULL DEFAULT '',
      cal_slot_id TEXT,
      talk_set INTEGER NOT NULL DEFAULT 0,
      created_by TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_people_requests_ws ON people_requests(workspace_id, status, start_date);
    CREATE INDEX IF NOT EXISTS idx_people_requests_emp ON people_requests(employee_id, start_date);
    CREATE TABLE IF NOT EXISTS people_holidays (
      id TEXT PRIMARY KEY,
      workspace_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      country TEXT NOT NULL DEFAULT '',
      date TEXT NOT NULL,
      name TEXT NOT NULL,
      created_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS people_templates (
      id TEXT PRIMARY KEY,
      workspace_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      name TEXT NOT NULL,
      kind TEXT NOT NULL DEFAULT 'onboarding',
      tasks TEXT NOT NULL DEFAULT '[]',
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS people_checklists (
      id TEXT PRIMARY KEY,
      workspace_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      employee_id TEXT NOT NULL REFERENCES people_employees(id) ON DELETE CASCADE,
      template_id TEXT,
      kind TEXT NOT NULL DEFAULT 'onboarding',
      name TEXT NOT NULL,
      anchor_date TEXT NOT NULL,
      created_by TEXT,
      created_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS people_tasks (
      id TEXT PRIMARY KEY,
      workspace_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      checklist_id TEXT NOT NULL REFERENCES people_checklists(id) ON DELETE CASCADE,
      employee_id TEXT NOT NULL REFERENCES people_employees(id) ON DELETE CASCADE,
      title TEXT NOT NULL,
      description TEXT NOT NULL DEFAULT '',
      assignee_role TEXT NOT NULL DEFAULT 'hr',
      assignee_id TEXT,
      due_date TEXT,
      done_at TEXT,
      done_by TEXT,
      position INTEGER NOT NULL DEFAULT 0
    );
    CREATE INDEX IF NOT EXISTS idx_people_tasks_cl ON people_tasks(checklist_id, position);
    CREATE INDEX IF NOT EXISTS idx_people_tasks_assignee ON people_tasks(workspace_id, assignee_id, done_at);
    CREATE TABLE IF NOT EXISTS people_exit_interviews (
      employee_id TEXT PRIMARY KEY REFERENCES people_employees(id) ON DELETE CASCADE,
      workspace_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      data TEXT NOT NULL,
      created_by TEXT,
      created_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS people_documents (
      id TEXT PRIMARY KEY,
      workspace_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      employee_id TEXT REFERENCES people_employees(id) ON DELETE CASCADE,
      title TEXT NOT NULL,
      kind TEXT NOT NULL DEFAULT 'other',
      url TEXT NOT NULL DEFAULT '',
      file_name TEXT NOT NULL DEFAULT '',
      mime TEXT NOT NULL DEFAULT '',
      size INTEGER NOT NULL DEFAULT 0,
      docs_page_id TEXT,
      visibility TEXT NOT NULL DEFAULT 'hr',
      requires_ack INTEGER NOT NULL DEFAULT 0,
      created_by TEXT,
      created_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_people_docs_emp ON people_documents(workspace_id, employee_id);
    CREATE TABLE IF NOT EXISTS people_doc_acks (
      document_id TEXT NOT NULL REFERENCES people_documents(id) ON DELETE CASCADE,
      employee_id TEXT NOT NULL REFERENCES people_employees(id) ON DELETE CASCADE,
      acked_at TEXT NOT NULL,
      PRIMARY KEY (document_id, employee_id)
    );
    CREATE TABLE IF NOT EXISTS people_cycles (
      id TEXT PRIMARY KEY,
      workspace_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      name TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'draft',
      questions TEXT NOT NULL DEFAULT '[]',
      self_review INTEGER NOT NULL DEFAULT 1,
      manager_review INTEGER NOT NULL DEFAULT 1,
      peer_review INTEGER NOT NULL DEFAULT 0,
      due_date TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS people_reviews (
      id TEXT PRIMARY KEY,
      workspace_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      cycle_id TEXT NOT NULL REFERENCES people_cycles(id) ON DELETE CASCADE,
      subject_id TEXT NOT NULL REFERENCES people_employees(id) ON DELETE CASCADE,
      reviewer_id TEXT NOT NULL REFERENCES people_employees(id) ON DELETE CASCADE,
      kind TEXT NOT NULL,
      answers TEXT NOT NULL DEFAULT '{}',
      status TEXT NOT NULL DEFAULT 'pending',
      submitted_at TEXT,
      UNIQUE (cycle_id, subject_id, reviewer_id, kind)
    );
    CREATE INDEX IF NOT EXISTS idx_people_reviews_reviewer ON people_reviews(reviewer_id, status);
    CREATE TABLE IF NOT EXISTS people_goals (
      id TEXT PRIMARY KEY,
      workspace_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      employee_id TEXT NOT NULL REFERENCES people_employees(id) ON DELETE CASCADE,
      title TEXT NOT NULL,
      progress INTEGER NOT NULL DEFAULT 0,
      due_date TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS people_one_on_ones (
      id TEXT PRIMARY KEY,
      workspace_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      a_id TEXT NOT NULL REFERENCES people_employees(id) ON DELETE CASCADE,
      b_id TEXT NOT NULL REFERENCES people_employees(id) ON DELETE CASCADE,
      date TEXT NOT NULL,
      notes TEXT NOT NULL DEFAULT '',
      created_by TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
  `);
}
