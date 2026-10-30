import type { Client } from '@libsql/client';

/**
 * Hiring (Workable): ajustes de la página de empleos, puestos con su equipo
 * de contratación y sus etapas, candidatos (uno por email en el workspace),
 * postulaciones, línea de tiempo, evaluadores y scorecards, entrevistas con
 * Cal, plantillas y ofertas. Un candidato es un registro por persona y
 * alcance: el mismo email en otro puesto es otro registro (ver lib/hiring/candidates.ts). Todo cuelga del workspace (workspace_id = id del
 * owner, como el resto de las apps).
 */
export async function hiringUp(client: Client): Promise<void> {
  await client.executeMultiple(`
    CREATE TABLE IF NOT EXISTS hiring_settings (
      workspace_id TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
      handle TEXT NOT NULL UNIQUE,
      company TEXT NOT NULL DEFAULT '',
      intro TEXT NOT NULL DEFAULT '',
      color TEXT,
      locale TEXT NOT NULL DEFAULT 'en',
      published INTEGER NOT NULL DEFAULT 0,
      retention_months INTEGER NOT NULL DEFAULT 12,
      consent_text TEXT NOT NULL DEFAULT '',
      auto_ack INTEGER NOT NULL DEFAULT 1,
      members_create_jobs INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS hiring_jobs (
      id TEXT PRIMARY KEY,
      workspace_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      slug TEXT NOT NULL,
      title TEXT NOT NULL,
      department TEXT NOT NULL DEFAULT '',
      location TEXT NOT NULL DEFAULT '',
      workplace TEXT NOT NULL DEFAULT 'onsite',
      employment_type TEXT NOT NULL DEFAULT 'full_time',
      salary_min INTEGER,
      salary_max INTEGER,
      salary_currency TEXT NOT NULL DEFAULT 'USD',
      salary_period TEXT NOT NULL DEFAULT 'year',
      salary_public INTEGER NOT NULL DEFAULT 0,
      description TEXT NOT NULL DEFAULT '',
      questions TEXT NOT NULL DEFAULT '[]',
      status TEXT NOT NULL DEFAULT 'draft',
      template TEXT NOT NULL DEFAULT '',
      created_by TEXT,
      published_at TEXT,
      closed_at TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      UNIQUE (workspace_id, slug)
    );
    CREATE INDEX IF NOT EXISTS idx_hiring_jobs_ws ON hiring_jobs(workspace_id, status, updated_at);
    CREATE TABLE IF NOT EXISTS hiring_job_members (
      job_id TEXT NOT NULL REFERENCES hiring_jobs(id) ON DELETE CASCADE,
      user_id TEXT NOT NULL,
      role TEXT NOT NULL,
      created_at TEXT NOT NULL,
      PRIMARY KEY (job_id, user_id)
    );
    CREATE INDEX IF NOT EXISTS idx_hiring_job_members_user ON hiring_job_members(user_id);
    CREATE TABLE IF NOT EXISTS hiring_stages (
      id TEXT PRIMARY KEY,
      job_id TEXT NOT NULL REFERENCES hiring_jobs(id) ON DELETE CASCADE,
      name TEXT NOT NULL,
      kind TEXT NOT NULL DEFAULT 'review',
      position INTEGER NOT NULL DEFAULT 0,
      criteria TEXT NOT NULL DEFAULT '[]',
      cal_event_type_id TEXT,
      created_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_hiring_stages_job ON hiring_stages(job_id, position);
    CREATE TABLE IF NOT EXISTS hiring_candidates (
      id TEXT PRIMARY KEY,
      workspace_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      email TEXT NOT NULL,
      name TEXT NOT NULL,
      phone TEXT NOT NULL DEFAULT '',
      location TEXT NOT NULL DEFAULT '',
      headline TEXT NOT NULL DEFAULT '',
      links TEXT NOT NULL DEFAULT '[]',
      tags TEXT NOT NULL DEFAULT '[]',
      resume_url TEXT,
      resume_name TEXT,
      resume_mime TEXT,
      resume_text TEXT NOT NULL DEFAULT '',
      ai_summary TEXT NOT NULL DEFAULT '',
      ai_fields TEXT NOT NULL DEFAULT '{}',
      consent_at TEXT,
      keep_consent INTEGER NOT NULL DEFAULT 0,
      forget_token_hash TEXT,
      purge_claimed_at TEXT,
      last_activity_at TEXT NOT NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_hiring_candidates_email ON hiring_candidates(workspace_id, email);
    CREATE INDEX IF NOT EXISTS idx_hiring_candidates_activity ON hiring_candidates(last_activity_at);
    CREATE TABLE IF NOT EXISTS hiring_applications (
      id TEXT PRIMARY KEY,
      workspace_id TEXT NOT NULL,
      job_id TEXT NOT NULL REFERENCES hiring_jobs(id) ON DELETE CASCADE,
      candidate_id TEXT NOT NULL REFERENCES hiring_candidates(id) ON DELETE CASCADE,
      stage_id TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'active',
      source TEXT NOT NULL DEFAULT 'manual',
      utm TEXT NOT NULL DEFAULT '{}',
      referrer TEXT NOT NULL DEFAULT '',
      answers TEXT NOT NULL DEFAULT '{}',
      knocked_out INTEGER NOT NULL DEFAULT 0,
      reject_reason TEXT NOT NULL DEFAULT '',
      stage_changed_at TEXT NOT NULL,
      hired_at TEXT,
      rejected_at TEXT,
      created_by TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      UNIQUE (job_id, candidate_id)
    );
    CREATE INDEX IF NOT EXISTS idx_hiring_applications_job ON hiring_applications(job_id, status, stage_id);
    CREATE INDEX IF NOT EXISTS idx_hiring_applications_candidate ON hiring_applications(candidate_id);
    CREATE TABLE IF NOT EXISTS hiring_documents (
      id TEXT PRIMARY KEY,
      candidate_id TEXT NOT NULL REFERENCES hiring_candidates(id) ON DELETE CASCADE,
      application_id TEXT,
      ref TEXT NOT NULL,
      name TEXT NOT NULL,
      mime TEXT NOT NULL,
      unverified INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_hiring_documents_candidate ON hiring_documents(candidate_id);
    CREATE TABLE IF NOT EXISTS hiring_events (
      id TEXT PRIMARY KEY,
      workspace_id TEXT NOT NULL,
      candidate_id TEXT NOT NULL REFERENCES hiring_candidates(id) ON DELETE CASCADE,
      application_id TEXT,
      kind TEXT NOT NULL,
      actor_id TEXT,
      data TEXT NOT NULL DEFAULT '{}',
      created_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_hiring_events_candidate ON hiring_events(candidate_id, created_at);
    CREATE INDEX IF NOT EXISTS idx_hiring_events_app ON hiring_events(application_id, kind);
    CREATE TABLE IF NOT EXISTS hiring_evaluators (
      application_id TEXT NOT NULL REFERENCES hiring_applications(id) ON DELETE CASCADE,
      user_id TEXT NOT NULL,
      stage_id TEXT NOT NULL,
      requested_at TEXT NOT NULL,
      reminded_at TEXT,
      PRIMARY KEY (application_id, user_id)
    );
    CREATE INDEX IF NOT EXISTS idx_hiring_evaluators_user ON hiring_evaluators(user_id);
    CREATE TABLE IF NOT EXISTS hiring_scorecards (
      id TEXT PRIMARY KEY,
      application_id TEXT NOT NULL REFERENCES hiring_applications(id) ON DELETE CASCADE,
      stage_id TEXT NOT NULL,
      user_id TEXT NOT NULL,
      ratings TEXT NOT NULL DEFAULT '{}',
      overall TEXT NOT NULL,
      notes TEXT NOT NULL DEFAULT '',
      submitted_at TEXT NOT NULL,
      UNIQUE (application_id, stage_id, user_id)
    );
    CREATE TABLE IF NOT EXISTS hiring_interviews (
      id TEXT PRIMARY KEY,
      application_id TEXT NOT NULL REFERENCES hiring_applications(id) ON DELETE CASCADE,
      stage_id TEXT NOT NULL,
      event_type_id TEXT NOT NULL,
      booking_id TEXT,
      starts_at TEXT,
      ends_at TEXT,
      status TEXT NOT NULL DEFAULT 'invited',
      created_by TEXT,
      created_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_hiring_interviews_app ON hiring_interviews(application_id);
    CREATE TABLE IF NOT EXISTS hiring_templates (
      id TEXT PRIMARY KEY,
      workspace_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      job_id TEXT,
      kind TEXT NOT NULL,
      name TEXT NOT NULL,
      subject TEXT NOT NULL DEFAULT '',
      body TEXT NOT NULL DEFAULT '',
      created_by TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_hiring_templates_ws ON hiring_templates(workspace_id, kind);
    CREATE TABLE IF NOT EXISTS hiring_offers (
      id TEXT PRIMARY KEY,
      workspace_id TEXT NOT NULL,
      application_id TEXT NOT NULL REFERENCES hiring_applications(id) ON DELETE CASCADE,
      status TEXT NOT NULL DEFAULT 'pending_approval',
      title TEXT NOT NULL DEFAULT '',
      salary INTEGER,
      currency TEXT NOT NULL DEFAULT 'USD',
      start_date TEXT,
      body TEXT NOT NULL DEFAULT '',
      created_by TEXT,
      approved_by TEXT,
      approved_at TEXT,
      sent_at TEXT,
      token_hash TEXT UNIQUE,
      responded_at TEXT,
      signed_name TEXT,
      signed_ip TEXT,
      signed_ua TEXT,
      body_hash TEXT,
      decline_reason TEXT NOT NULL DEFAULT '',
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_hiring_offers_app ON hiring_offers(application_id);
    CREATE TABLE IF NOT EXISTS hiring_audit (
      id TEXT PRIMARY KEY,
      workspace_id TEXT NOT NULL,
      kind TEXT NOT NULL,
      data TEXT NOT NULL DEFAULT '{}',
      created_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_hiring_audit_ws ON hiring_audit(workspace_id, created_at);
  `);
}
