/** Tipos de filas de la base (uno por tabla). */

export interface UserRow {
  id: string;
  email: string;
  name: string | null;
  image: string | null;
  active_team_id?: string | null;
  seeded_at?: string | null;
  created_at: string;
}

export interface LinkRow {
  id: string;
  user_id: string;
  slug: string;
  url: string;
  title: string | null;
  tags: string; // JSON string[]
  password_hash: string | null;
  expires_at: string | null;
  max_clicks: number | null;
  archived: 0 | 1;
  redirect_type: number;
  utm_source: string | null;
  utm_medium: string | null;
  utm_campaign: string | null;
  og_title: string | null;
  og_description: string | null;
  og_image: string | null;
  clicks: number;
  created_at: string;
  updated_at: string;
}

export interface ClickRow {
  id: number;
  link_id: string;
  ts: string;
  referrer: string | null;
  country: string | null;
  device: string | null;
  browser: string | null;
  os: string | null;
}

export interface ApiKeyRow {
  id: string;
  user_id: string;
  name: string;
  prefix: string;
  key_hash: string;
  created_at: string;
  last_used_at: string | null;
  revoked: 0 | 1;
}

// ---------- CRM ----------

export interface CrmContactRow {
  id: string;
  user_id: string;
  owner_id: string | null;
  first_name: string;
  last_name: string;
  email: string;
  phone: string;
  job_title: string;
  website: string;
  city: string;
  country: string;
  lifecycle_stage: string;
  lead_status: string;
  source: string;
  company_id: string | null;
  custom: string; // JSON object
  created_at: string;
  updated_at: string;
}

export interface CrmCompanyRow {
  id: string;
  user_id: string;
  owner_id: string | null;
  name: string;
  domain: string;
  industry: string;
  employees: number | null;
  phone: string;
  website: string;
  city: string;
  country: string;
  lifecycle_stage: string;
  custom: string; // JSON object
  created_at: string;
  updated_at: string;
}

export interface CrmPipelineRow {
  id: string;
  user_id: string;
  name: string;
  position: number;
  created_at: string;
}

export interface CrmStageRow {
  id: string;
  pipeline_id: string;
  name: string;
  probability: number;
  position: number;
  is_won: 0 | 1;
  is_lost: 0 | 1;
}

export interface CrmDealRow {
  id: string;
  user_id: string;
  owner_id: string | null;
  pipeline_id: string;
  stage_id: string;
  name: string;
  amount: number;
  currency: string;
  close_date: string | null;
  priority: string;
  source: string;
  description: string;
  lost_reason: string;
  position: number;
  closed_at: string | null;
  custom: string; // JSON object
  created_at: string;
  updated_at: string;
}

export interface CrmActivityRow {
  id: string;
  user_id: string;
  owner_id: string | null;
  type: 'note' | 'task' | 'call' | 'meeting' | 'email';
  subject: string;
  body: string;
  due_at: string | null;
  done: 0 | 1;
  done_at: string | null;
  pinned: 0 | 1;
  direction: string;
  outcome: string;
  duration_min: number | null;
  contact_id: string | null;
  company_id: string | null;
  deal_id: string | null;
  project_id: string | null;
  created_at: string;
  updated_at: string;
}

export interface CrmTaskProjectRow {
  id: string;
  user_id: string;
  name: string;
  color: string;
  archived: 0 | 1;
  created_at: string;
  updated_at: string;
}

export interface CrmTaskFileRow {
  id: string;
  activity_id: string;
  filename: string;
  content_type: string;
  size: number;
  url: string;
  created_at: string;
}

export interface CrmPropertyEventRow {
  id: string;
  user_id: string;
  entity: string;
  entity_id: string;
  field: string;
  old_value: string;
  new_value: string;
  actor_email: string;
  created_at: string;
}

export interface CrmListRow {
  id: string;
  user_id: string;
  name: string;
  entity: string;
  kind: 'static' | 'dynamic';
  filter: string; // JSON ContactFilter subset
  created_at: string;
}

export interface CrmCustomFieldRow {
  id: string;
  user_id: string;
  entity: string;
  name: string;
  label: string;
  type: 'text' | 'number' | 'date' | 'select' | 'boolean';
  options: string; // JSON string[]
  position: number;
}

export interface CrmSavedViewRow {
  id: string;
  user_id: string;
  entity: string;
  name: string;
  query: string; // JSON object
  created_at: string;
}

export interface CrmSavedReportRow {
  id: string;
  user_id: string;
  name: string;
  report_type: string;
  filters: string; // JSON object
  created_at: string;
}

export interface CrmDashboardRow {
  id: string;
  user_id: string;
  name: string;
  position: number;
  created_at: string;
  updated_at: string;
}

export interface CrmDashboardWidgetRow {
  id: string;
  dashboard_id: string;
  type: string;
  config: string; // JSON object
  x: number;
  y: number;
  w: number;
  h: number;
  position: number;
  created_at: string;
}

export interface CrmImportRow {
  id: string;
  user_id: string;
  entity: string;
  total: number;
  created: number;
  updated: number;
  skipped: number;
  errors: string; // JSON string[]
  created_at: string;
}

export interface IntegrationRow {
  user_id: string;
  provider: string;
  email: string;
  access_token: string;
  refresh_token: string;
  expires_at: number; // epoch ms
  scope: string;
  last_sync_at: string | null;
  created_at: string;
  updated_at: string;
}

export interface CrmEmailRow {
  id: string;
  user_id: string;
  contact_id: string;
  gmail_id: string;
  thread_id: string;
  source: 'gmail' | 'zerosoft';
  direction: 'in' | 'out';
  from_email: string;
  to_emails: string;
  subject: string;
  snippet: string;
  body_html: string | null;
  body_text: string | null;
  sent_at: string;
  created_at: string;
}

export interface CrmWorkflowRow {
  id: string;
  user_id: string;
  name: string;
  enabled: 0 | 1;
  created_at: string;
  updated_at: string;
}

export interface CrmWorkflowTriggerRow {
  id: string;
  workflow_id: string;
  type: string;
  config: string; // JSON
  position: number;
}

export interface CrmWorkflowActionRow {
  id: string;
  workflow_id: string;
  type: string;
  config: string; // JSON
  position: number;
}

export interface CrmWorkflowRunRow {
  id: string;
  workflow_id: string;
  user_id: string;
  trigger_entity: string;
  trigger_entity_id: string;
  status: 'pending' | 'running' | 'done' | 'failed';
  output: string; // JSON
  started_at: string;
  finished_at: string | null;
}

export interface TeamRow {
  id: string;
  name: string;
  owner_id: string;
  created_at: string;
}

export interface TeamMemberRow {
  team_id: string;
  user_id: string;
  role: 'owner' | 'member';
  created_at: string;
}

export interface TeamInviteRow {
  id: string;
  team_id: string;
  email: string;
  token: string;
  role: 'owner' | 'member';
  status: 'pending' | 'accepted' | 'revoked';
  invited_by: string;
  created_at: string;
  expires_at: string | null;
}

// ---------- Docs ----------

export interface DocsPageRow {
  id: string;
  user_id: string;
  parent_id: string | null;
  title: string;
  icon: string | null;
  cover_url: string | null;
  content: string; // JSON DocsBlock[]
  is_public: 0 | 1;
  archived: 0 | 1;
  created_at: string;
  updated_at: string;
}

export interface DocsShareRow {
  id: string;
  page_id: string;
  kind: 'public' | 'team' | 'user';
  target_id: string | null;
  created_at: string;
}

export interface DocsCommentRow {
  id: string;
  page_id: string;
  user_id: string;
  block_id: string | null;
  body: string;
  resolved: 0 | 1;
  created_at: string;
}

// ---------- Calendar ----------

export interface CalendarUserRow {
  id: string;
  user_id: string;
  timezone: string;
  week_start: number;
  buffer_before_min: number;
  buffer_after_min: number;
  min_notice_hours: number;
  max_booking_days: number;
  created_at: string;
  updated_at: string;
}

export interface CalendarEventTypeRow {
  id: string;
  user_id: string;
  team_id: string | null;
  slug: string;
  title: string;
  duration_min: number;
  location: string;
  description: string;
  color: string;
  active: 0 | 1;
  booking_rules: string; // JSON CalendarBookingRules
  fields: string; // JSON CalendarCustomField[]
  brand_color: string | null;
  welcome_message: string;
  logo_url: string | null;
  single_use: 0 | 1;
  used_at: string | null;
  rr_cursor: number;
  created_at: string;
  updated_at: string;
}

export interface CalendarAvailabilityRow {
  id: string;
  event_type_id: string;
  day_of_week: number;
  start_time: string;
  end_time: string;
}

export interface CalendarBookingRow {
  id: string;
  event_type_id: string;
  invitee_email: string;
  invitee_name: string;
  starts_at: string;
  ends_at: string;
  timezone: string;
  status: 'confirmed' | 'cancelled' | 'no_show';
  answers: string; // JSON object
  cancel_reason: string | null;
  host_user_id: string | null;
  created_at: string;
  updated_at: string;
}

export interface CalendarEventHostRow {
  id: string;
  event_type_id: string;
  user_id: string;
  position: number;
  created_at: string;
}

export interface CalendarReminderRow {
  id: string;
  booking_id: string;
  kind: 'reminder_24h';
  send_at: string;
  sent_at: string | null;
  created_at: string;
}

export interface CalendarBlockedSlotRow {
  id: string;
  user_id: string;
  starts_at: string;
  ends_at: string;
  reason: string | null;
}

export interface CalendarRoutingFormRow {
  id: string;
  user_id: string;
  slug: string;
  title: string;
  description: string;
  active: 0 | 1;
  default_event_type_id: string | null;
  created_at: string;
  updated_at: string;
}

export interface CalendarRoutingFieldRow {
  id: string;
  form_id: string;
  name: string;
  label: string;
  type: 'text' | 'select' | 'boolean';
  options: string; // JSON string[] (opciones del tipo select)
  required: 0 | 1;
  position: number;
}

export interface CalendarRoutingRuleRow {
  id: string;
  form_id: string;
  field_id: string;
  operator: 'is' | 'is_not' | 'contains' | 'truthy';
  value: string;
  event_type_id: string;
  position: number;
}

// ---------- Track ----------

export interface TrackProjectRow {
  id: string;
  team_id: string | null;
  owner_id: string | null;
  name: string;
  slug: string;
  description: string;
  icon: string | null;
  color: string;
  status: 'active' | 'archived';
  created_at: string;
  updated_at: string;
}

export interface TrackStatusRow {
  id: string;
  project_id: string;
  name: string;
  color: string;
  position: number;
  category: 'backlog' | 'todo' | 'in_progress' | 'done' | 'cancelled';
  created_at: string;
}

export interface TrackCycleRow {
  id: string;
  project_id: string;
  name: string;
  start_at: string;
  end_at: string;
  created_at: string;
}

export interface TrackIssueRow {
  id: string;
  project_id: string;
  identifier: string;
  title: string;
  description: string; // JSON TrackBlock[]
  status_id: string | null;
  priority: 'urgent' | 'high' | 'medium' | 'low';
  assignee_id: string | null;
  creator_id: string;
  cycle_id: string | null;
  estimate: number | null;
  parent_id: string | null;
  start_date: string | null;
  due_date: string | null;
  labels: string; // JSON TrackLabel[]
  created_at: string;
  updated_at: string;
}

export interface TrackIssueViewRow {
  id: string;
  project_id: string;
  user_id: string;
  name: string;
  view_type: 'list' | 'board' | 'calendar' | 'gantt';
  filters: string; // JSON IssueFilters
  sort: string;
  columns: string | null; // JSON string[]
  is_default: 0 | 1;
  created_at: string;
  updated_at: string;
}

export interface TrackIssueCommentRow {
  id: string;
  issue_id: string;
  user_id: string;
  body: string;
  created_at: string;
}

export interface TrackIssueRelationRow {
  id: string;
  issue_id: string;
  related_issue_id: string;
  type: 'blocks' | 'related' | 'duplicates';
  created_at: string;
}

export interface TrackIssueAttachmentRow {
  id: string;
  issue_id: string;
  user_id: string;
  filename: string;
  content_type: string;
  size: number;
  url: string;
  created_at: string;
}

export interface TrackIssueActivityRow {
  id: string;
  issue_id: string;
  user_id: string;
  type:
    | 'comment'
    | 'status_change'
    | 'assignee_change'
    | 'priority_change'
    | 'cycle_change'
    | 'due_date_change'
    | 'estimate_change'
    | 'title_change'
    | 'description_change'
    | 'relation_added'
    | 'relation_removed'
    | 'attachment_added'
    | 'subtask_added'
    | 'created'
    | 'closed'
    | 'reopened';
  meta: string;
  created_at: string;
}

// ---------- Chat ----------

export interface ChatWidgetRow {
  id: string;
  team_id: string | null;
  user_id: string;
  name: string;
  color: string;
  position: 'bottom-right' | 'bottom-left';
  welcome_message: string | null;
  fields: string; // JSON ChatFieldDef[]
  bot_enabled: 0 | 1;
  bot_greeting: string | null;
  bot_source: 'canned' | 'docs';
  office_hours: string | null; // JSON OfficeHoursConfig
  created_at: string;
  updated_at: string;
}

export interface ChatVisitorRow {
  id: string;
  widget_id: string;
  external_id: string;
  email: string | null;
  name: string | null;
  notes: string | null;
  metadata: string; // JSON object
  created_at: string;
}

export interface ChatConversationRow {
  id: string;
  widget_id: string;
  visitor_id: string;
  status: 'open' | 'pending' | 'resolved' | 'snoozed';
  assigned_to: string | null;
  priority: 'low' | 'medium' | 'high' | 'urgent';
  subject: string | null;
  first_response_at: string | null;
  resolved_at: string | null;
  sla_breach_at: string | null;
  snoozed_until: string | null;
  csat_score: number | null;
  csat_comment: string | null;
  created_at: string;
  updated_at: string;
}

export interface ChatMessageRow {
  id: string;
  conversation_id: string;
  sender_type: 'visitor' | 'user' | 'system' | 'bot';
  user_id: string | null;
  body: string;
  attachments: string; // JSON ChatAttachment[]
  read_at: string | null;
  created_at: string;
}

export interface ChatTypingRow {
  id: string;
  conversation_id: string;
  sender_type: 'visitor' | 'user';
  user_id: string | null;
  expires_at: string;
}

export interface ChatAssignmentRuleRow {
  id: string;
  widget_id: string;
  name: string;
  match_type: 'all' | 'keyword' | 'time' | 'round_robin';
  match_value: string | null;
  assign_to: string | null;
  position: number;
  active: 0 | 1;
  created_at: string;
  updated_at: string;
}

export interface ChatSlaPolicyRow {
  id: string;
  widget_id: string;
  name: string;
  first_response_minutes: number;
  resolution_minutes: number | null;
  priority: 'low' | 'medium' | 'high' | 'urgent';
  active: 0 | 1;
  created_at: string;
  updated_at: string;
}

export interface ChatCannedResponseRow {
  id: string;
  widget_id: string;
  shortcut: string;
  title: string;
  body: string;
  created_at: string;
  updated_at: string;
}

export interface NotificationRow {
  id: string;
  user_id: string;
  type: 'mention' | 'assigned' | 'status_change' | 'comment' | 'subtask' | 'relation' | 'chat_message';
  title: string;
  body: string | null;
  href: string | null;
  read_at: string | null;
  source_type: string;
  source_id: string;
  meta: string;
  created_at: string;
}
