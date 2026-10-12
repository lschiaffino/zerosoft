import type { Client } from '@libsql/client';

/**
 * Esquema base (v001): el DDL completo tal como existía antes de las
 * migraciones versionadas, más los ALTER y rebuilds históricos. Todo es
 * idempotente, así que correrlo sobre una base existente es seguro.
 * NO editar: los cambios nuevos van en una migración nueva (migrations.ts).
 */

export const BASELINE_DDL = `
    CREATE TABLE IF NOT EXISTS users (
      id TEXT PRIMARY KEY,
      email TEXT NOT NULL UNIQUE,
      name TEXT,
      image TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS links (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      slug TEXT NOT NULL UNIQUE,
      url TEXT NOT NULL,
      title TEXT,
      tags TEXT NOT NULL DEFAULT '[]',
      password_hash TEXT,
      expires_at TEXT,
      max_clicks INTEGER,
      archived INTEGER NOT NULL DEFAULT 0,
      redirect_type INTEGER NOT NULL DEFAULT 302,
      utm_source TEXT,
      utm_medium TEXT,
      utm_campaign TEXT,
      og_title TEXT,
      og_description TEXT,
      og_image TEXT,
      clicks INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE INDEX IF NOT EXISTS idx_links_user ON links(user_id, created_at DESC);

    CREATE TABLE IF NOT EXISTS clicks (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      link_id TEXT NOT NULL REFERENCES links(id) ON DELETE CASCADE,
      ts TEXT NOT NULL DEFAULT (datetime('now')),
      referrer TEXT,
      country TEXT,
      device TEXT,
      browser TEXT,
      os TEXT
    );
    CREATE INDEX IF NOT EXISTS idx_clicks_link_ts ON clicks(link_id, ts);

    CREATE TABLE IF NOT EXISTS api_keys (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      name TEXT NOT NULL,
      prefix TEXT NOT NULL,
      key_hash TEXT NOT NULL UNIQUE,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      last_used_at TEXT,
      revoked INTEGER NOT NULL DEFAULT 0
    );
    CREATE INDEX IF NOT EXISTS idx_api_keys_user ON api_keys(user_id);

    -- ---------- CRM ----------

    CREATE TABLE IF NOT EXISTS crm_contacts (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      owner_id TEXT,
      first_name TEXT NOT NULL DEFAULT '',
      last_name TEXT NOT NULL DEFAULT '',
      email TEXT NOT NULL DEFAULT '',
      phone TEXT NOT NULL DEFAULT '',
      job_title TEXT NOT NULL DEFAULT '',
      website TEXT NOT NULL DEFAULT '',
      city TEXT NOT NULL DEFAULT '',
      country TEXT NOT NULL DEFAULT '',
      lifecycle_stage TEXT NOT NULL DEFAULT 'lead',
      lead_status TEXT NOT NULL DEFAULT 'new',
      source TEXT NOT NULL DEFAULT '',
      company_id TEXT,
      custom TEXT NOT NULL DEFAULT '{}',
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE INDEX IF NOT EXISTS idx_crm_contacts_user ON crm_contacts(user_id, created_at DESC);
    CREATE INDEX IF NOT EXISTS idx_crm_contacts_email ON crm_contacts(user_id, email);

    CREATE TABLE IF NOT EXISTS crm_companies (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      owner_id TEXT,
      name TEXT NOT NULL DEFAULT '',
      domain TEXT NOT NULL DEFAULT '',
      industry TEXT NOT NULL DEFAULT '',
      employees INTEGER,
      phone TEXT NOT NULL DEFAULT '',
      website TEXT NOT NULL DEFAULT '',
      city TEXT NOT NULL DEFAULT '',
      country TEXT NOT NULL DEFAULT '',
      lifecycle_stage TEXT NOT NULL DEFAULT 'lead',
      custom TEXT NOT NULL DEFAULT '{}',
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE INDEX IF NOT EXISTS idx_crm_companies_user ON crm_companies(user_id, created_at DESC);

    CREATE TABLE IF NOT EXISTS crm_pipelines (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      name TEXT NOT NULL,
      position INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS crm_stages (
      id TEXT PRIMARY KEY,
      pipeline_id TEXT NOT NULL REFERENCES crm_pipelines(id) ON DELETE CASCADE,
      name TEXT NOT NULL,
      probability INTEGER NOT NULL DEFAULT 0,
      position INTEGER NOT NULL DEFAULT 0,
      is_won INTEGER NOT NULL DEFAULT 0,
      is_lost INTEGER NOT NULL DEFAULT 0
    );
    CREATE INDEX IF NOT EXISTS idx_crm_stages_pipeline ON crm_stages(pipeline_id, position);

    CREATE TABLE IF NOT EXISTS crm_deals (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      owner_id TEXT,
      pipeline_id TEXT NOT NULL,
      stage_id TEXT NOT NULL,
      name TEXT NOT NULL DEFAULT '',
      amount REAL NOT NULL DEFAULT 0,
      currency TEXT NOT NULL DEFAULT 'USD',
      close_date TEXT,
      priority TEXT NOT NULL DEFAULT 'medium',
      source TEXT NOT NULL DEFAULT '',
      description TEXT NOT NULL DEFAULT '',
      lost_reason TEXT NOT NULL DEFAULT '',
      position REAL NOT NULL DEFAULT 0,
      closed_at TEXT,
      custom TEXT NOT NULL DEFAULT '{}',
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE INDEX IF NOT EXISTS idx_crm_deals_user ON crm_deals(user_id, created_at DESC);
    CREATE INDEX IF NOT EXISTS idx_crm_deals_stage ON crm_deals(stage_id, position);

    CREATE TABLE IF NOT EXISTS crm_deal_contacts (
      deal_id TEXT NOT NULL REFERENCES crm_deals(id) ON DELETE CASCADE,
      contact_id TEXT NOT NULL REFERENCES crm_contacts(id) ON DELETE CASCADE,
      PRIMARY KEY (deal_id, contact_id)
    );

    CREATE TABLE IF NOT EXISTS crm_activities (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      type TEXT NOT NULL CHECK (type IN ('note', 'task', 'call', 'meeting', 'email')),
      subject TEXT NOT NULL DEFAULT '',
      body TEXT NOT NULL DEFAULT '',
      due_at TEXT,
      done INTEGER NOT NULL DEFAULT 0,
      done_at TEXT,
      pinned INTEGER NOT NULL DEFAULT 0,
      direction TEXT NOT NULL DEFAULT '',
      outcome TEXT NOT NULL DEFAULT '',
      duration_min INTEGER,
      contact_id TEXT,
      company_id TEXT,
      deal_id TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE INDEX IF NOT EXISTS idx_crm_activities_user ON crm_activities(user_id, created_at DESC);
    CREATE INDEX IF NOT EXISTS idx_crm_activities_due ON crm_activities(user_id, done, due_at);

    CREATE TABLE IF NOT EXISTS crm_task_projects (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      name TEXT NOT NULL,
      color TEXT NOT NULL DEFAULT '#666666',
      archived INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE INDEX IF NOT EXISTS idx_crm_task_projects_user ON crm_task_projects(user_id, archived, name);

    CREATE TABLE IF NOT EXISTS crm_task_files (
      id TEXT PRIMARY KEY,
      activity_id TEXT NOT NULL REFERENCES crm_activities(id) ON DELETE CASCADE,
      filename TEXT NOT NULL,
      content_type TEXT NOT NULL DEFAULT '',
      size INTEGER NOT NULL DEFAULT 0,
      url TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE INDEX IF NOT EXISTS idx_crm_task_files_activity ON crm_task_files(activity_id, created_at DESC);

    -- Audit trail: una fila por cada cambio de propiedad de contact/company/deal.
    CREATE TABLE IF NOT EXISTS crm_property_events (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      entity TEXT NOT NULL,
      entity_id TEXT NOT NULL,
      field TEXT NOT NULL,
      old_value TEXT NOT NULL DEFAULT '',
      new_value TEXT NOT NULL DEFAULT '',
      actor_email TEXT NOT NULL DEFAULT '',
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE INDEX IF NOT EXISTS idx_crm_prop_events ON crm_property_events(user_id, entity, entity_id, created_at DESC);

    CREATE TABLE IF NOT EXISTS crm_lists (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      name TEXT NOT NULL,
      entity TEXT NOT NULL DEFAULT 'contacts',
      kind TEXT NOT NULL CHECK (kind IN ('static', 'dynamic')) DEFAULT 'static',
      filter TEXT NOT NULL DEFAULT '{}',
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS crm_list_members (
      list_id TEXT NOT NULL REFERENCES crm_lists(id) ON DELETE CASCADE,
      contact_id TEXT NOT NULL REFERENCES crm_contacts(id) ON DELETE CASCADE,
      PRIMARY KEY (list_id, contact_id)
    );

    CREATE TABLE IF NOT EXISTS crm_custom_fields (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      entity TEXT NOT NULL,
      name TEXT NOT NULL,
      label TEXT NOT NULL,
      type TEXT NOT NULL CHECK (type IN ('text', 'number', 'date', 'select', 'boolean')),
      options TEXT NOT NULL DEFAULT '[]',
      position INTEGER NOT NULL DEFAULT 0
    );

    CREATE TABLE IF NOT EXISTS crm_saved_views (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      entity TEXT NOT NULL,
      name TEXT NOT NULL,
      query TEXT NOT NULL DEFAULT '{}',
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS crm_saved_reports (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      name TEXT NOT NULL,
      report_type TEXT NOT NULL,
      filters TEXT NOT NULL DEFAULT '{}',
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS crm_dashboards (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      name TEXT NOT NULL,
      position INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE INDEX IF NOT EXISTS idx_crm_dashboards_user ON crm_dashboards(user_id, position);

    CREATE TABLE IF NOT EXISTS crm_dashboard_widgets (
      id TEXT PRIMARY KEY,
      dashboard_id TEXT NOT NULL REFERENCES crm_dashboards(id) ON DELETE CASCADE,
      type TEXT NOT NULL,
      config TEXT NOT NULL DEFAULT '{}',
      x INTEGER NOT NULL DEFAULT 0,
      y INTEGER NOT NULL DEFAULT 0,
      w INTEGER NOT NULL DEFAULT 4,
      h INTEGER NOT NULL DEFAULT 3,
      position INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE INDEX IF NOT EXISTS idx_crm_dashboard_widgets_dash ON crm_dashboard_widgets(dashboard_id, position);

    CREATE TABLE IF NOT EXISTS crm_imports (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      entity TEXT NOT NULL,
      total INTEGER NOT NULL DEFAULT 0,
      created INTEGER NOT NULL DEFAULT 0,
      updated INTEGER NOT NULL DEFAULT 0,
      skipped INTEGER NOT NULL DEFAULT 0,
      errors TEXT NOT NULL DEFAULT '[]',
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    -- ---------- Integraciones (Gmail, etc.) ----------

    CREATE TABLE IF NOT EXISTS integrations (
      user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      provider TEXT NOT NULL,
      email TEXT NOT NULL DEFAULT '',
      access_token TEXT NOT NULL DEFAULT '',
      refresh_token TEXT NOT NULL DEFAULT '',
      expires_at INTEGER NOT NULL DEFAULT 0,
      scope TEXT NOT NULL DEFAULT '',
      last_sync_at TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now')),
      PRIMARY KEY (user_id, provider)
    );

    CREATE TABLE IF NOT EXISTS crm_emails (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      contact_id TEXT NOT NULL REFERENCES crm_contacts(id) ON DELETE CASCADE,
      gmail_id TEXT NOT NULL,
      thread_id TEXT NOT NULL DEFAULT '',
      source TEXT NOT NULL DEFAULT 'gmail',
      direction TEXT NOT NULL DEFAULT 'in',
      from_email TEXT NOT NULL DEFAULT '',
      to_emails TEXT NOT NULL DEFAULT '',
      subject TEXT NOT NULL DEFAULT '',
      snippet TEXT NOT NULL DEFAULT '',
      body_html TEXT,
      body_text TEXT,
      sent_at TEXT NOT NULL DEFAULT '',
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      UNIQUE (user_id, gmail_id)
    );
    CREATE INDEX IF NOT EXISTS idx_crm_emails_contact ON crm_emails(user_id, contact_id, sent_at DESC);

    CREATE TABLE IF NOT EXISTS crm_workflows (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      name TEXT NOT NULL,
      enabled INTEGER NOT NULL DEFAULT 1,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE INDEX IF NOT EXISTS idx_crm_workflows_user ON crm_workflows(user_id, enabled, updated_at DESC);

    CREATE TABLE IF NOT EXISTS crm_workflow_triggers (
      id TEXT PRIMARY KEY,
      workflow_id TEXT NOT NULL REFERENCES crm_workflows(id) ON DELETE CASCADE,
      type TEXT NOT NULL,
      config TEXT NOT NULL DEFAULT '{}',
      position INTEGER NOT NULL DEFAULT 0
    );

    CREATE TABLE IF NOT EXISTS crm_workflow_actions (
      id TEXT PRIMARY KEY,
      workflow_id TEXT NOT NULL REFERENCES crm_workflows(id) ON DELETE CASCADE,
      type TEXT NOT NULL,
      config TEXT NOT NULL DEFAULT '{}',
      position INTEGER NOT NULL DEFAULT 0
    );

    CREATE TABLE IF NOT EXISTS crm_workflow_runs (
      id TEXT PRIMARY KEY,
      workflow_id TEXT NOT NULL REFERENCES crm_workflows(id) ON DELETE CASCADE,
      user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      trigger_entity TEXT NOT NULL DEFAULT '',
      trigger_entity_id TEXT NOT NULL DEFAULT '',
      status TEXT NOT NULL DEFAULT 'pending',
      output TEXT NOT NULL DEFAULT '{}',
      started_at TEXT NOT NULL DEFAULT (datetime('now')),
      finished_at TEXT
    );
    CREATE INDEX IF NOT EXISTS idx_crm_workflow_runs_wf ON crm_workflow_runs(workflow_id, started_at DESC);

    -- ---------- Teams (workspace compartido del owner) ----------

    CREATE TABLE IF NOT EXISTS teams (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      owner_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE INDEX IF NOT EXISTS idx_teams_owner ON teams(owner_id);

    CREATE TABLE IF NOT EXISTS team_members (
      team_id TEXT NOT NULL REFERENCES teams(id) ON DELETE CASCADE,
      user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      role TEXT NOT NULL DEFAULT 'member',
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      PRIMARY KEY (team_id, user_id)
    );
    CREATE INDEX IF NOT EXISTS idx_team_members_user ON team_members(user_id);

    CREATE TABLE IF NOT EXISTS team_invites (
      id TEXT PRIMARY KEY,
      team_id TEXT NOT NULL REFERENCES teams(id) ON DELETE CASCADE,
      email TEXT NOT NULL DEFAULT '',
      token TEXT NOT NULL UNIQUE,
      role TEXT NOT NULL DEFAULT 'member',
      status TEXT NOT NULL DEFAULT 'pending',
      invited_by TEXT NOT NULL DEFAULT '',
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      expires_at TEXT
    );
    CREATE INDEX IF NOT EXISTS idx_team_invites_team ON team_invites(team_id, status);

    -- ---------- Docs ----------

    CREATE TABLE IF NOT EXISTS docs_pages (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      parent_id TEXT REFERENCES docs_pages(id) ON DELETE CASCADE,
      title TEXT NOT NULL DEFAULT '',
      icon TEXT,
      cover_url TEXT,
      content TEXT NOT NULL DEFAULT '[]',
      is_public INTEGER NOT NULL DEFAULT 0,
      archived INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE INDEX IF NOT EXISTS idx_docs_pages_user ON docs_pages(user_id, archived, updated_at DESC);
    CREATE INDEX IF NOT EXISTS idx_docs_pages_parent ON docs_pages(parent_id, user_id);
    CREATE INDEX IF NOT EXISTS idx_docs_pages_title ON docs_pages(user_id, title);

    CREATE TABLE IF NOT EXISTS docs_shares (
      id TEXT PRIMARY KEY,
      page_id TEXT NOT NULL REFERENCES docs_pages(id) ON DELETE CASCADE,
      kind TEXT NOT NULL CHECK (kind IN ('public', 'team', 'user')),
      target_id TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE INDEX IF NOT EXISTS idx_docs_shares_page ON docs_shares(page_id);
    CREATE INDEX IF NOT EXISTS idx_docs_shares_target ON docs_shares(kind, target_id);

    -- Comentarios de página (block_id nullable → comentario a nivel página).
    CREATE TABLE IF NOT EXISTS docs_comments (
      id TEXT PRIMARY KEY,
      page_id TEXT NOT NULL REFERENCES docs_pages(id) ON DELETE CASCADE,
      user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      block_id TEXT,
      body TEXT NOT NULL DEFAULT '',
      resolved INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE INDEX IF NOT EXISTS idx_docs_comments_page ON docs_comments(page_id, resolved, created_at ASC);

    -- ---------- Calendar ----------

    CREATE TABLE IF NOT EXISTS calendar_users (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL UNIQUE REFERENCES users(id) ON DELETE CASCADE,
      timezone TEXT NOT NULL DEFAULT 'UTC',
      week_start INTEGER NOT NULL DEFAULT 1 CHECK (week_start BETWEEN 0 AND 6),
      buffer_before_min INTEGER NOT NULL DEFAULT 0 CHECK (buffer_before_min >= 0),
      buffer_after_min INTEGER NOT NULL DEFAULT 0 CHECK (buffer_after_min >= 0),
      min_notice_hours INTEGER NOT NULL DEFAULT 0 CHECK (min_notice_hours >= 0),
      max_booking_days INTEGER NOT NULL DEFAULT 30 CHECK (max_booking_days >= 1),
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS calendar_event_types (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      team_id TEXT REFERENCES teams(id) ON DELETE SET NULL,
      slug TEXT NOT NULL,
      title TEXT NOT NULL,
      duration_min INTEGER NOT NULL CHECK (duration_min >= 1),
      location TEXT NOT NULL DEFAULT '',
      description TEXT NOT NULL DEFAULT '',
      color TEXT NOT NULL DEFAULT '#000000',
      active INTEGER NOT NULL DEFAULT 1,
      booking_rules TEXT NOT NULL DEFAULT '{}',
      fields TEXT NOT NULL DEFAULT '[]',
      brand_color TEXT,
      welcome_message TEXT NOT NULL DEFAULT '',
      logo_url TEXT,
      single_use INTEGER NOT NULL DEFAULT 0,
      used_at TEXT,
      rr_cursor INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE UNIQUE INDEX IF NOT EXISTS idx_calendar_event_types_user_slug ON calendar_event_types(user_id, slug);
    CREATE UNIQUE INDEX IF NOT EXISTS idx_calendar_event_types_team_slug ON calendar_event_types(team_id, slug) WHERE team_id IS NOT NULL;
    CREATE INDEX IF NOT EXISTS idx_calendar_event_types_user ON calendar_event_types(user_id, created_at DESC);

    CREATE TABLE IF NOT EXISTS calendar_availability (
      id TEXT PRIMARY KEY,
      event_type_id TEXT NOT NULL REFERENCES calendar_event_types(id) ON DELETE CASCADE,
      day_of_week INTEGER NOT NULL CHECK (day_of_week BETWEEN 0 AND 6),
      start_time TEXT NOT NULL,
      end_time TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_calendar_availability_event_type ON calendar_availability(event_type_id);

    CREATE TABLE IF NOT EXISTS calendar_bookings (
      id TEXT PRIMARY KEY,
      event_type_id TEXT NOT NULL REFERENCES calendar_event_types(id) ON DELETE CASCADE,
      invitee_email TEXT NOT NULL,
      invitee_name TEXT NOT NULL DEFAULT '',
      starts_at TEXT NOT NULL,
      ends_at TEXT NOT NULL,
      timezone TEXT NOT NULL DEFAULT 'UTC',
      status TEXT NOT NULL DEFAULT 'confirmed' CHECK (status IN ('confirmed', 'cancelled', 'no_show')),
      answers TEXT NOT NULL DEFAULT '{}',
      cancel_reason TEXT,
      host_user_id TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE INDEX IF NOT EXISTS idx_calendar_bookings_event_type ON calendar_bookings(event_type_id, starts_at);
    CREATE INDEX IF NOT EXISTS idx_calendar_bookings_starts_at ON calendar_bookings(starts_at);

    -- Pool de hosts para eventos de equipo (round-robin por position + rr_cursor).
    CREATE TABLE IF NOT EXISTS calendar_event_hosts (
      id TEXT PRIMARY KEY,
      event_type_id TEXT NOT NULL REFERENCES calendar_event_types(id) ON DELETE CASCADE,
      user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      position INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      UNIQUE (event_type_id, user_id)
    );
    CREATE INDEX IF NOT EXISTS idx_calendar_event_hosts_event ON calendar_event_hosts(event_type_id, position);

    -- Recordatorios programados de bookings (ej. 24h antes).
    CREATE TABLE IF NOT EXISTS calendar_reminders (
      id TEXT PRIMARY KEY,
      booking_id TEXT NOT NULL REFERENCES calendar_bookings(id) ON DELETE CASCADE,
      kind TEXT NOT NULL DEFAULT 'reminder_24h' CHECK (kind IN ('reminder_24h')),
      send_at TEXT NOT NULL,
      sent_at TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE INDEX IF NOT EXISTS idx_calendar_reminders_due ON calendar_reminders(sent_at, send_at);

    CREATE TABLE IF NOT EXISTS calendar_blocked_slots (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      starts_at TEXT NOT NULL,
      ends_at TEXT NOT NULL,
      reason TEXT
    );
    CREATE INDEX IF NOT EXISTS idx_calendar_blocked_slots_user ON calendar_blocked_slots(user_id, starts_at);

    -- Routing forms: formulario público que deriva al event type correcto
    -- según las respuestas (paridad Calendly Routing Forms).
    CREATE TABLE IF NOT EXISTS calendar_routing_forms (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      slug TEXT NOT NULL,
      title TEXT NOT NULL,
      description TEXT NOT NULL DEFAULT '',
      active INTEGER NOT NULL DEFAULT 1,
      default_event_type_id TEXT REFERENCES calendar_event_types(id) ON DELETE SET NULL,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE UNIQUE INDEX IF NOT EXISTS idx_calendar_routing_forms_user_slug ON calendar_routing_forms(user_id, slug);
    CREATE INDEX IF NOT EXISTS idx_calendar_routing_forms_user ON calendar_routing_forms(user_id, created_at DESC);

    CREATE TABLE IF NOT EXISTS calendar_routing_fields (
      id TEXT PRIMARY KEY,
      form_id TEXT NOT NULL REFERENCES calendar_routing_forms(id) ON DELETE CASCADE,
      name TEXT NOT NULL,
      label TEXT NOT NULL,
      type TEXT NOT NULL DEFAULT 'text' CHECK (type IN ('text', 'select', 'boolean')),
      options TEXT NOT NULL DEFAULT '[]',
      required INTEGER NOT NULL DEFAULT 0,
      position INTEGER NOT NULL DEFAULT 0
    );
    CREATE INDEX IF NOT EXISTS idx_calendar_routing_fields_form ON calendar_routing_fields(form_id, position);

    -- Reglas evaluadas en orden (position): la primera que matchea define el
    -- event type destino; si ninguna matchea, se usa default_event_type_id.
    CREATE TABLE IF NOT EXISTS calendar_routing_rules (
      id TEXT PRIMARY KEY,
      form_id TEXT NOT NULL REFERENCES calendar_routing_forms(id) ON DELETE CASCADE,
      field_id TEXT NOT NULL REFERENCES calendar_routing_fields(id) ON DELETE CASCADE,
      operator TEXT NOT NULL CHECK (operator IN ('is', 'is_not', 'contains', 'truthy')),
      value TEXT NOT NULL DEFAULT '',
      event_type_id TEXT NOT NULL REFERENCES calendar_event_types(id) ON DELETE CASCADE,
      position INTEGER NOT NULL DEFAULT 0
    );
    CREATE INDEX IF NOT EXISTS idx_calendar_routing_rules_form ON calendar_routing_rules(form_id, position);

    -- ---------- Track ----------

    CREATE TABLE IF NOT EXISTS track_projects (
      id TEXT PRIMARY KEY,
      team_id TEXT REFERENCES teams(id) ON DELETE SET NULL,
      name TEXT NOT NULL,
      slug TEXT NOT NULL UNIQUE,
      description TEXT NOT NULL DEFAULT '',
      icon TEXT,
      color TEXT NOT NULL DEFAULT '#000000',
      status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'archived')),
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE INDEX IF NOT EXISTS idx_track_projects_team ON track_projects(team_id, status, name);

    CREATE TABLE IF NOT EXISTS track_statuses (
      id TEXT PRIMARY KEY,
      project_id TEXT NOT NULL REFERENCES track_projects(id) ON DELETE CASCADE,
      name TEXT NOT NULL,
      color TEXT NOT NULL DEFAULT '#666666',
      position INTEGER NOT NULL DEFAULT 0,
      category TEXT NOT NULL DEFAULT 'todo' CHECK (category IN ('backlog', 'todo', 'in_progress', 'done', 'cancelled')),
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE INDEX IF NOT EXISTS idx_track_statuses_project ON track_statuses(project_id, position);

    CREATE TABLE IF NOT EXISTS track_cycles (
      id TEXT PRIMARY KEY,
      project_id TEXT NOT NULL REFERENCES track_projects(id) ON DELETE CASCADE,
      name TEXT NOT NULL,
      start_at TEXT NOT NULL,
      end_at TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE INDEX IF NOT EXISTS idx_track_cycles_project ON track_cycles(project_id, start_at);

    CREATE TABLE IF NOT EXISTS track_issues (
      id TEXT PRIMARY KEY,
      project_id TEXT NOT NULL REFERENCES track_projects(id) ON DELETE CASCADE,
      identifier TEXT NOT NULL,
      title TEXT NOT NULL DEFAULT '',
      description TEXT NOT NULL DEFAULT '[]',
      status_id TEXT REFERENCES track_statuses(id) ON DELETE SET NULL,
      priority TEXT NOT NULL DEFAULT 'medium' CHECK (priority IN ('urgent', 'high', 'medium', 'low')),
      assignee_id TEXT REFERENCES users(id) ON DELETE SET NULL,
      creator_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      cycle_id TEXT REFERENCES track_cycles(id) ON DELETE SET NULL,
      estimate INTEGER CHECK (estimate >= 0),
      parent_id TEXT REFERENCES track_issues(id) ON DELETE SET NULL,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now')),
      UNIQUE (project_id, identifier)
    );
    CREATE INDEX IF NOT EXISTS idx_track_issues_project ON track_issues(project_id, created_at DESC);
    CREATE INDEX IF NOT EXISTS idx_track_issues_status ON track_issues(status_id, created_at DESC);
    CREATE INDEX IF NOT EXISTS idx_track_issues_assignee ON track_issues(assignee_id, status_id);

    CREATE TABLE IF NOT EXISTS track_issue_comments (
      id TEXT PRIMARY KEY,
      issue_id TEXT NOT NULL REFERENCES track_issues(id) ON DELETE CASCADE,
      user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      body TEXT NOT NULL DEFAULT '',
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE INDEX IF NOT EXISTS idx_track_issue_comments_issue ON track_issue_comments(issue_id, created_at DESC);

    CREATE TABLE IF NOT EXISTS track_issue_relations (
      id TEXT PRIMARY KEY,
      issue_id TEXT NOT NULL REFERENCES track_issues(id) ON DELETE CASCADE,
      related_issue_id TEXT NOT NULL REFERENCES track_issues(id) ON DELETE CASCADE,
      type TEXT NOT NULL DEFAULT 'related' CHECK (type IN ('blocks', 'related', 'duplicates')),
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      UNIQUE (issue_id, related_issue_id)
    );

    CREATE TABLE IF NOT EXISTS track_issue_views (
      id TEXT PRIMARY KEY,
      project_id TEXT NOT NULL REFERENCES track_projects(id) ON DELETE CASCADE,
      user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      name TEXT NOT NULL,
      view_type TEXT NOT NULL CHECK (view_type IN ('list', 'board', 'calendar', 'gantt')),
      filters TEXT NOT NULL DEFAULT '{}',
      sort TEXT NOT NULL DEFAULT 'newest',
      columns TEXT,
      is_default INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE INDEX IF NOT EXISTS idx_track_issue_views_project ON track_issue_views(project_id, user_id);

    CREATE TABLE IF NOT EXISTS track_issue_attachments (
      id TEXT PRIMARY KEY,
      issue_id TEXT NOT NULL REFERENCES track_issues(id) ON DELETE CASCADE,
      user_id TEXT NOT NULL REFERENCES users(id),
      filename TEXT NOT NULL,
      content_type TEXT NOT NULL,
      size INTEGER NOT NULL,
      url TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE INDEX IF NOT EXISTS idx_track_issue_attachments_issue ON track_issue_attachments(issue_id, created_at DESC);

    CREATE TABLE IF NOT EXISTS track_issue_activities (
      id TEXT PRIMARY KEY,
      issue_id TEXT NOT NULL REFERENCES track_issues(id) ON DELETE CASCADE,
      user_id TEXT NOT NULL REFERENCES users(id),
      type TEXT NOT NULL CHECK (type IN ('comment', 'status_change', 'assignee_change', 'priority_change', 'cycle_change', 'due_date_change', 'estimate_change', 'title_change', 'description_change', 'relation_added', 'relation_removed', 'attachment_added', 'subtask_added', 'created', 'closed', 'reopened')),
      meta TEXT NOT NULL DEFAULT '{}',
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE INDEX IF NOT EXISTS idx_track_issue_activities_issue ON track_issue_activities(issue_id, created_at DESC);

    -- ---------- Chat ----------

    CREATE TABLE IF NOT EXISTS chat_widgets (
      id TEXT PRIMARY KEY,
      team_id TEXT REFERENCES teams(id) ON DELETE CASCADE,
      user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      name TEXT NOT NULL,
      color TEXT NOT NULL DEFAULT '#000000',
      position TEXT NOT NULL DEFAULT 'bottom-right' CHECK (position IN ('bottom-right', 'bottom-left')),
      welcome_message TEXT,
      fields TEXT NOT NULL DEFAULT '[]',
      bot_enabled INTEGER NOT NULL DEFAULT 0,
      bot_greeting TEXT,
      bot_source TEXT NOT NULL DEFAULT 'canned' CHECK (bot_source IN ('canned', 'docs')),
      office_hours TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE INDEX IF NOT EXISTS idx_chat_widgets_user ON chat_widgets(user_id);
    CREATE INDEX IF NOT EXISTS idx_chat_widgets_team ON chat_widgets(team_id);

    CREATE TABLE IF NOT EXISTS chat_visitors (
      id TEXT PRIMARY KEY,
      widget_id TEXT NOT NULL REFERENCES chat_widgets(id) ON DELETE CASCADE,
      external_id TEXT NOT NULL,
      email TEXT,
      name TEXT,
      notes TEXT,
      metadata TEXT NOT NULL DEFAULT '{}',
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      UNIQUE (widget_id, external_id)
    );
    CREATE INDEX IF NOT EXISTS idx_chat_visitors_widget ON chat_visitors(widget_id);
    CREATE INDEX IF NOT EXISTS idx_chat_visitors_search ON chat_visitors(widget_id, email, name);

    CREATE TABLE IF NOT EXISTS chat_conversations (
      id TEXT PRIMARY KEY,
      widget_id TEXT NOT NULL REFERENCES chat_widgets(id) ON DELETE CASCADE,
      visitor_id TEXT NOT NULL REFERENCES chat_visitors(id) ON DELETE CASCADE,
      status TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'pending', 'resolved', 'snoozed')),
      assigned_to TEXT REFERENCES users(id) ON DELETE SET NULL,
      priority TEXT NOT NULL DEFAULT 'medium' CHECK (priority IN ('low', 'medium', 'high', 'urgent')),
      subject TEXT,
      first_response_at TEXT,
      resolved_at TEXT,
      sla_breach_at TEXT,
      snoozed_until TEXT,
      csat_score INTEGER,
      csat_comment TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE INDEX IF NOT EXISTS idx_chat_conversations_widget ON chat_conversations(widget_id, status, updated_at DESC);
    CREATE INDEX IF NOT EXISTS idx_chat_conversations_visitor ON chat_conversations(visitor_id);

    CREATE TABLE IF NOT EXISTS chat_messages (
      id TEXT PRIMARY KEY,
      conversation_id TEXT NOT NULL REFERENCES chat_conversations(id) ON DELETE CASCADE,
      sender_type TEXT NOT NULL CHECK (sender_type IN ('visitor', 'user', 'system', 'bot')),
      user_id TEXT REFERENCES users(id) ON DELETE SET NULL,
      body TEXT NOT NULL,
      attachments TEXT NOT NULL DEFAULT '[]',
      read_at TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE INDEX IF NOT EXISTS idx_chat_messages_conversation ON chat_messages(conversation_id, created_at ASC);

    CREATE TABLE IF NOT EXISTS chat_typing (
      id TEXT PRIMARY KEY,
      conversation_id TEXT NOT NULL REFERENCES chat_conversations(id) ON DELETE CASCADE,
      sender_type TEXT NOT NULL CHECK (sender_type IN ('visitor', 'user')),
      user_id TEXT REFERENCES users(id) ON DELETE SET NULL,
      expires_at TEXT NOT NULL,
      UNIQUE (conversation_id, sender_type, user_id)
    );
    CREATE INDEX IF NOT EXISTS idx_chat_typing_conversation ON chat_typing(conversation_id, expires_at);

    CREATE TABLE IF NOT EXISTS chat_assignment_rules (
      id TEXT PRIMARY KEY,
      widget_id TEXT NOT NULL REFERENCES chat_widgets(id) ON DELETE CASCADE,
      name TEXT NOT NULL,
      match_type TEXT NOT NULL CHECK (match_type IN ('all', 'keyword', 'time', 'round_robin')),
      match_value TEXT,
      assign_to TEXT REFERENCES users(id) ON DELETE SET NULL,
      position INTEGER NOT NULL DEFAULT 0,
      active INTEGER NOT NULL DEFAULT 1,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE INDEX IF NOT EXISTS idx_chat_rules_widget ON chat_assignment_rules(widget_id, position);

    CREATE TABLE IF NOT EXISTS chat_sla_policies (
      id TEXT PRIMARY KEY,
      widget_id TEXT NOT NULL REFERENCES chat_widgets(id) ON DELETE CASCADE,
      name TEXT NOT NULL,
      first_response_minutes INTEGER NOT NULL DEFAULT 60,
      resolution_minutes INTEGER,
      priority TEXT NOT NULL DEFAULT 'medium' CHECK (priority IN ('low', 'medium', 'high', 'urgent')),
      active INTEGER NOT NULL DEFAULT 1,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE INDEX IF NOT EXISTS idx_chat_sla_widget ON chat_sla_policies(widget_id, priority, active);

    CREATE TABLE IF NOT EXISTS chat_canned_responses (
      id TEXT PRIMARY KEY,
      widget_id TEXT NOT NULL REFERENCES chat_widgets(id) ON DELETE CASCADE,
      shortcut TEXT NOT NULL,
      title TEXT NOT NULL,
      body TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now')),
      UNIQUE (widget_id, shortcut)
    );
    CREATE UNIQUE INDEX IF NOT EXISTS idx_chat_canned_widget_shortcut ON chat_canned_responses(widget_id, shortcut);

    -- ---------- Notifications ----------

    CREATE TABLE IF NOT EXISTS notifications (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      type TEXT NOT NULL,
      title TEXT NOT NULL,
      body TEXT,
      href TEXT,
      read_at TEXT,
      source_type TEXT,
      source_id TEXT,
      meta TEXT NOT NULL DEFAULT '{}',
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE INDEX IF NOT EXISTS idx_notifications_user_read ON notifications(user_id, read_at, created_at DESC);
  `;

export async function baseline(client: Client): Promise<void> {
  await client.executeMultiple(BASELINE_DDL);
  // Columnas añadidas después del DDL inicial: ALTER idempotente
  // (falla con "duplicate column" si ya existe; se ignora).
  for (const alter of [
    'ALTER TABLE crm_activities ADD COLUMN pinned INTEGER NOT NULL DEFAULT 0',
    'ALTER TABLE crm_activities ADD COLUMN project_id TEXT',
    'ALTER TABLE crm_activities ADD COLUMN owner_id TEXT',
    'CREATE INDEX IF NOT EXISTS idx_crm_activities_project ON crm_activities(user_id, project_id, done)',
    'ALTER TABLE integrations ADD COLUMN last_sync_at TEXT',
    'ALTER TABLE users ADD COLUMN active_team_id TEXT',
    'ALTER TABLE crm_contacts ADD COLUMN owner_id TEXT',
    'ALTER TABLE crm_companies ADD COLUMN owner_id TEXT',
    'ALTER TABLE crm_deals ADD COLUMN owner_id TEXT',
    'ALTER TABLE links ADD COLUMN redirect_type INTEGER NOT NULL DEFAULT 302',
    'ALTER TABLE links ADD COLUMN og_title TEXT',
    'ALTER TABLE links ADD COLUMN og_description TEXT',
    'ALTER TABLE links ADD COLUMN og_image TEXT',
    'ALTER TABLE track_issues ADD COLUMN due_date TEXT',
    'ALTER TABLE track_issues ADD COLUMN start_date TEXT',
    'ALTER TABLE track_issues ADD COLUMN labels TEXT NOT NULL DEFAULT \'[]\'',
    'ALTER TABLE chat_visitors ADD COLUMN notes TEXT',
    'ALTER TABLE chat_visitors ADD COLUMN metadata TEXT NOT NULL DEFAULT \'{}\'',
    'ALTER TABLE chat_conversations ADD COLUMN first_response_at TEXT',
    'ALTER TABLE chat_conversations ADD COLUMN resolved_at TEXT',
    'ALTER TABLE chat_conversations ADD COLUMN sla_breach_at TEXT',
    'ALTER TABLE chat_messages ADD COLUMN read_at TEXT',
    'ALTER TABLE crm_emails ADD COLUMN source TEXT NOT NULL DEFAULT \'gmail\'',
    'ALTER TABLE crm_emails ADD COLUMN body_html TEXT',
    'ALTER TABLE crm_emails ADD COLUMN body_text TEXT',
    'ALTER TABLE docs_pages ADD COLUMN cover_url TEXT',
    'ALTER TABLE users ADD COLUMN seeded_at TEXT',
    // Calendar F3: branding, single-use links, round-robin y host asignado.
    'ALTER TABLE calendar_event_types ADD COLUMN brand_color TEXT',
    'ALTER TABLE calendar_event_types ADD COLUMN welcome_message TEXT NOT NULL DEFAULT \'\'',
    'ALTER TABLE calendar_event_types ADD COLUMN logo_url TEXT',
    'ALTER TABLE calendar_event_types ADD COLUMN single_use INTEGER NOT NULL DEFAULT 0',
    'ALTER TABLE calendar_event_types ADD COLUMN used_at TEXT',
    'ALTER TABLE calendar_event_types ADD COLUMN rr_cursor INTEGER NOT NULL DEFAULT 0',
    'ALTER TABLE calendar_bookings ADD COLUMN host_user_id TEXT',
    // Chat F4: bot, office hours, snooze y CSAT.
    'ALTER TABLE chat_widgets ADD COLUMN bot_enabled INTEGER NOT NULL DEFAULT 0',
    'ALTER TABLE chat_widgets ADD COLUMN bot_greeting TEXT',
    'ALTER TABLE chat_widgets ADD COLUMN bot_source TEXT NOT NULL DEFAULT \'canned\'',
    'ALTER TABLE chat_widgets ADD COLUMN office_hours TEXT',
    'ALTER TABLE chat_conversations ADD COLUMN snoozed_until TEXT',
    'ALTER TABLE chat_conversations ADD COLUMN csat_score INTEGER',
    'ALTER TABLE chat_conversations ADD COLUMN csat_comment TEXT',
  ]) {
    try {
      await client.execute(alter);
    } catch {
      /* la columna ya existe */
    }
  }
  // El CHECK de track_issue_views.view_type no admite ALTER: si la tabla
  // existe y no reconoce 'gantt', se reconstruye (una sola vez; el nuevo
  // DDL ya incluye 'gantt', así que el guard la hace idempotente).
  const viewsTable = await client.execute(
    "SELECT sql FROM sqlite_master WHERE type = 'table' AND name = 'track_issue_views'",
  );
  const viewsSql = viewsTable.rows.length > 0 ? String(viewsTable.rows[0].sql ?? '') : '';
  if (viewsSql && !viewsSql.includes("'gantt'")) {
    await client.executeMultiple(`
      CREATE TABLE track_issue_views_new (
        id TEXT PRIMARY KEY,
        project_id TEXT NOT NULL REFERENCES track_projects(id) ON DELETE CASCADE,
        user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        name TEXT NOT NULL,
        view_type TEXT NOT NULL CHECK (view_type IN ('list', 'board', 'calendar', 'gantt')),
        filters TEXT NOT NULL DEFAULT '{}',
        sort TEXT NOT NULL DEFAULT 'newest',
        columns TEXT,
        is_default INTEGER NOT NULL DEFAULT 0,
        created_at TEXT NOT NULL DEFAULT (datetime('now')),
        updated_at TEXT NOT NULL DEFAULT (datetime('now'))
      );
      INSERT INTO track_issue_views_new (id, project_id, user_id, name, view_type, filters, sort, columns, is_default, created_at, updated_at)
        SELECT id, project_id, user_id, name, view_type, filters, sort, columns, is_default, created_at, updated_at FROM track_issue_views;
      DROP TABLE track_issue_views;
      ALTER TABLE track_issue_views_new RENAME TO track_issue_views;
      CREATE INDEX IF NOT EXISTS idx_track_issue_views_project ON track_issue_views(project_id, user_id);
    `);
  }
  // Chat F4: los CHECK de status/priority/sender_type no admiten ALTER.
  // Si la tabla existe con el CHECK viejo, se reconstruye (una sola vez;
  // el DDL nuevo ya incluye los valores nuevos, así el guard es
  // idempotente). foreign_keys se apaga durante el rebuild: con FK ON el
  // DROP TABLE dispara un DELETE implícito que cascadearía a los hijos
  // (chat_messages / chat_typing).
  const chatTables = await client.execute(
    "SELECT name, sql FROM sqlite_master WHERE type = 'table' AND name IN ('chat_conversations', 'chat_messages', 'chat_sla_policies')",
  );
  const chatSql = new Map(
    chatTables.rows.map((r) => [String(r.name), String(r.sql ?? '')]),
  );
  const needsConversations = (chatSql.get('chat_conversations') ?? '') !== '' && !chatSql.get('chat_conversations')!.includes("'pending'");
  const needsMessages = (chatSql.get('chat_messages') ?? '') !== '' && !chatSql.get('chat_messages')!.includes("'bot'");
  const needsSla = (chatSql.get('chat_sla_policies') ?? '') !== '' && !chatSql.get('chat_sla_policies')!.includes("'medium'");
  if (needsConversations || needsMessages || needsSla) {
    try {
      await client.execute('PRAGMA foreign_keys = OFF');
    } catch {
      /* remoto puede no soportarlo */
    }
    try {
      if (needsConversations) {
        await client.executeMultiple(`
          CREATE TABLE chat_conversations_new (
            id TEXT PRIMARY KEY,
            widget_id TEXT NOT NULL REFERENCES chat_widgets(id) ON DELETE CASCADE,
            visitor_id TEXT NOT NULL REFERENCES chat_visitors(id) ON DELETE CASCADE,
            status TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'pending', 'resolved', 'snoozed')),
            assigned_to TEXT REFERENCES users(id) ON DELETE SET NULL,
            priority TEXT NOT NULL DEFAULT 'medium' CHECK (priority IN ('low', 'medium', 'high', 'urgent')),
            subject TEXT,
            first_response_at TEXT,
            resolved_at TEXT,
            sla_breach_at TEXT,
            snoozed_until TEXT,
            csat_score INTEGER,
            csat_comment TEXT,
            created_at TEXT NOT NULL DEFAULT (datetime('now')),
            updated_at TEXT NOT NULL DEFAULT (datetime('now'))
          );
          INSERT INTO chat_conversations_new (id, widget_id, visitor_id, status, assigned_to, priority, subject, first_response_at, resolved_at, sla_breach_at, snoozed_until, csat_score, csat_comment, created_at, updated_at)
            SELECT id, widget_id, visitor_id,
              CASE WHEN status = 'closed' THEN 'resolved' ELSE status END,
              assigned_to,
              CASE WHEN priority = 'normal' THEN 'medium' ELSE priority END,
              subject, first_response_at, resolved_at, sla_breach_at, snoozed_until, csat_score, csat_comment, created_at, updated_at
            FROM chat_conversations;
          DROP TABLE chat_conversations;
          ALTER TABLE chat_conversations_new RENAME TO chat_conversations;
          CREATE INDEX IF NOT EXISTS idx_chat_conversations_widget ON chat_conversations(widget_id, status, updated_at DESC);
          CREATE INDEX IF NOT EXISTS idx_chat_conversations_visitor ON chat_conversations(visitor_id);
        `);
      }
      if (needsMessages) {
        await client.executeMultiple(`
          CREATE TABLE chat_messages_new (
            id TEXT PRIMARY KEY,
            conversation_id TEXT NOT NULL REFERENCES chat_conversations(id) ON DELETE CASCADE,
            sender_type TEXT NOT NULL CHECK (sender_type IN ('visitor', 'user', 'system', 'bot')),
            user_id TEXT REFERENCES users(id) ON DELETE SET NULL,
            body TEXT NOT NULL,
            attachments TEXT NOT NULL DEFAULT '[]',
            read_at TEXT,
            created_at TEXT NOT NULL DEFAULT (datetime('now'))
          );
          INSERT INTO chat_messages_new (id, conversation_id, sender_type, user_id, body, attachments, read_at, created_at)
            SELECT id, conversation_id, sender_type, user_id, body, attachments, read_at, created_at FROM chat_messages;
          DROP TABLE chat_messages;
          ALTER TABLE chat_messages_new RENAME TO chat_messages;
          CREATE INDEX IF NOT EXISTS idx_chat_messages_conversation ON chat_messages(conversation_id, created_at ASC);
        `);
      }
      if (needsSla) {
        await client.executeMultiple(`
          CREATE TABLE chat_sla_policies_new (
            id TEXT PRIMARY KEY,
            widget_id TEXT NOT NULL REFERENCES chat_widgets(id) ON DELETE CASCADE,
            name TEXT NOT NULL,
            first_response_minutes INTEGER NOT NULL DEFAULT 60,
            resolution_minutes INTEGER,
            priority TEXT NOT NULL DEFAULT 'medium' CHECK (priority IN ('low', 'medium', 'high', 'urgent')),
            active INTEGER NOT NULL DEFAULT 1,
            created_at TEXT NOT NULL DEFAULT (datetime('now')),
            updated_at TEXT NOT NULL DEFAULT (datetime('now'))
          );
          INSERT INTO chat_sla_policies_new (id, widget_id, name, first_response_minutes, resolution_minutes, priority, active, created_at, updated_at)
            SELECT id, widget_id, name, first_response_minutes, resolution_minutes,
              CASE WHEN priority = 'normal' THEN 'medium' ELSE priority END,
              active, created_at, updated_at
            FROM chat_sla_policies;
          DROP TABLE chat_sla_policies;
          ALTER TABLE chat_sla_policies_new RENAME TO chat_sla_policies;
          CREATE INDEX IF NOT EXISTS idx_chat_sla_widget ON chat_sla_policies(widget_id, priority, active);
        `);
      }
    } finally {
      try {
        await client.execute('PRAGMA foreign_keys = ON');
      } catch {
        /* remoto puede no soportarlo */
      }
    }
  }
}
