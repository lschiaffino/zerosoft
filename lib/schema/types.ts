/** Tipos de filas de la base (uno por tabla). */

export interface UserRow {
  id: string;
  email: string;
  name: string | null;
  image: string | null;
  handle?: string | null;
  active_team_id?: string | null;
  seeded_at?: string | null;
  created_at: string;
}

export interface LinkRow {
  bio_position?: number | null;
  domain_id: string | null;
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
  utm_term?: string | null;
  utm_content?: string | null;
  og_title: string | null;
  og_description: string | null;
  og_image: string | null;
  clicks: number;
  /** JSON LinkTargeting (lib/link-targeting.ts); null = sin reglas. */
  targeting?: string | null;
  qr_scans?: number;
  /** 1 = los query params del link corto viajan al destino (default). */
  forward_params?: number;
  /** A dónde va el link vencido o sin clicks disponibles (null = página de zerosoft). */
  expired_url?: string | null;
  /** Persona que lo creó (id real, no el del owner); null en links viejos. */
  created_by?: string | null;
  /** Id propio del cliente de la API v1 (único por workspace). */
  external_id?: string | null;
  /** Carpeta (link_folders); null = sin carpeta. */
  folder_id?: string | null;
  created_at: string;
  updated_at: string;
}

export type LinkFolderAccess = 'none' | 'view' | 'edit';

export interface LinkFolderRow {
  id: string;
  user_id: string;
  name: string;
  /** Acceso de los miembros sin excepción propia. */
  default_access: LinkFolderAccess;
  created_at: string;
}

export interface LinkFolderMemberRow {
  folder_id: string;
  user_id: string;
  access: LinkFolderAccess;
}

export interface LinkAnalyticsShareRow {
  id: string;
  user_id: string;
  token: string;
  link_id: string | null;
  tag: string | null;
  created_by: string | null;
  created_at: string;
  revoked_at: string | null;
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
  /** 'link' (clic) | 'qr' (escaneo del QR). */
  source?: string;
  /** Destino servido cuando hay segmentación o A/B (etiqueta). */
  variant?: string | null;
  /** Ciudad y región (ISO 3166-2) de la visita, si la infraestructura las da. */
  city?: string | null;
  region?: string | null;
  /** URL del referrer sin query (salvo utm_*) ni hash. */
  referrer_url?: string | null;
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
  created_by: string | null;
  /** '*' = todos; si no, scopes separados por espacio (lib/api-scopes.ts). */
  scopes: string;
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
  /** Lead score (lib/crm-scoring.ts) y su desglose JSON ScoreBreakdownItem[]. */
  score: number;
  score_breakdown: string;
  score_updated_at: string | null;
  created_at: string;
  updated_at: string;
  /** Fechas de actividad mantenidas por triggers (lib/crm-activity-dates.ts). */
  last_activity_at?: string | null;
  last_contacted_at?: string | null;
  next_activity_at?: string | null;
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
  /** Empresa madre (jerarquía); null = raíz. Sin ciclos (lib/crm-assoc.ts). */
  parent_company_id: string | null;
  custom: string; // JSON object
  created_at: string;
  updated_at: string;
  /** Fechas de actividad mantenidas por triggers (lib/crm-activity-dates.ts). */
  last_activity_at?: string | null;
  last_contacted_at?: string | null;
  next_activity_at?: string | null;
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
  /** Días sin actividad para marcar un deal como rotting (null = default 14). */
  rotting_days: number | null;
  /** JSON string[]: propiedades que el deal necesita para entrar (lib/crm-stage-rules.ts). */
  required_fields?: string;
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
  /** 1 = el amount es manual aunque haya line items (si no, se recalcula). */
  amount_override: number;
  custom: string; // JSON object
  created_at: string;
  updated_at: string;
  /** Fechas de actividad mantenidas por triggers (lib/crm-activity-dates.ts). */
  last_activity_at?: string | null;
  last_contacted_at?: string | null;
  next_activity_at?: string | null;
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
  due_fired_at?: string | null;
  booking_id?: string | null;
  chat_conversation_id?: string | null;
  pinned: 0 | 1;
  direction: string;
  outcome: string;
  /** Llamadas: '' = teléfono, 'whatsapp' = toque por WhatsApp. */
  channel?: string;
  duration_min: number | null;
  contact_id: string | null;
  company_id: string | null;
  deal_id: string | null;
  project_id: string | null;
  /** Repetición de tareas (lib/crm-task-repeat.ts). */
  repeat?: 'none' | 'daily' | 'weekly' | 'monthly';
  /** Tarea siguiente de la serie, una vez creada al completar esta. */
  repeat_next_id?: string | null;
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

/** Archivo adjunto a un contacto, empresa o deal (057). */
export interface CrmRecordFileRow {
  id: string;
  user_id: string;
  contact_id: string | null;
  company_id: string | null;
  deal_id: string | null;
  filename: string;
  content_type: string;
  size: number;
  url: string;
  uploaded_by: string;
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
  type: CrmCustomFieldType;
  /** JSON string[]: opciones (select, multiselect) o [moneda ISO] (currency). */
  options: string;
  position: number;
}

export const CRM_CUSTOM_FIELD_TYPES = [
  'text', 'number', 'date', 'select', 'boolean', 'multiselect', 'url', 'phone', 'currency', 'user',
] as const;
export type CrmCustomFieldType = (typeof CRM_CUSTOM_FIELD_TYPES)[number];

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
  message_id: string;
  in_reply_to: string;
  cc_emails: string;
  /** Persona dueña del buzón (sync) o que envió el email desde el CRM. */
  person_id: string | null;
  activity_id: string | null;
  tracking_token: string | null;
  open_count: number;
  click_count: number;
  first_opened_at: string | null;
  last_opened_at: string | null;
  replied_at: string | null;
  enrollment_id: string | null;
  step_id: string | null;
}

export interface CrmEmailSyncRow {
  user_id: string;
  person_id: string;
  history_id: string | null;
  status: string;
  error: string | null;
  last_sync_at: string | null;
  last_full_sync_at: string | null;
  locked_until: string | null;
  created_at: string;
}

export interface CrmEmailEventRow {
  id: string;
  user_id: string;
  email_id: string;
  kind: 'open' | 'click';
  url: string;
  user_agent: string;
  created_at: string;
}

export interface CrmEmailTemplateRow {
  id: string;
  user_id: string;
  created_by: string | null;
  kind: 'template' | 'snippet';
  name: string;
  subject: string;
  body: string;
  created_at: string;
  updated_at: string;
}

export interface CrmSequenceRow {
  id: string;
  user_id: string;
  created_by: string | null;
  name: string;
  timezone: string;
  window_start: string;
  window_end: string;
  business_days: 0 | 1;
  archived: 0 | 1;
  created_at: string;
  updated_at: string;
}

export interface CrmSequenceStepRow {
  id: string;
  sequence_id: string;
  position: number;
  type: 'email' | 'task' | 'wait';
  wait_days: number;
  template_id: string | null;
  subject: string;
  body: string;
  new_thread: 0 | 1;
}

export interface CrmSequenceEnrollmentRow {
  id: string;
  user_id: string;
  sequence_id: string;
  contact_id: string;
  sender_id: string;
  enrolled_by: string | null;
  status: 'active' | 'paused' | 'finished' | 'exited';
  exit_reason: string | null;
  current_step: number;
  next_run_at: string | null;
  thread_id: string;
  last_message_id: string;
  thread_subject: string;
  locked_until: string | null;
  created_at: string;
  updated_at: string;
  finished_at: string | null;
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

// ---------- CRM: modelo nivel HubSpot (022_crm_model_tables) ----------

export interface CrmContactCompanyRow {
  contact_id: string;
  company_id: string;
  user_id: string;
  is_primary: number;
  label: string;
  created_at: string;
}

export interface CrmDealCompanyRow {
  deal_id: string;
  company_id: string;
  user_id: string;
  is_primary: number;
  created_at: string;
}

export interface CrmTagRow {
  id: string;
  user_id: string;
  name: string;
  color: string;
  created_at: string;
}

export interface CrmSettingsRow {
  user_id: string;
  base_currency: string;
  quote_accept_moves_deal: number;
  /** Qué ven los members: 'all' | 'mine' | 'team' (admins/owner ven todo). */
  member_visibility: string;
  /** JSON string[] con los resultados de llamada; NULL = los de siempre. */
  call_outcomes?: string | null;
  updated_at: string;
}

export interface CrmExchangeRateRow {
  user_id: string;
  currency: string;
  /** Cuántas unidades de la moneda base vale 1 unidad de `currency`. */
  rate: number;
  updated_at: string;
}

export interface CrmProductRow {
  id: string;
  user_id: string;
  name: string;
  sku: string;
  description: string;
  price: number;
  currency: string;
  recurring: 'none' | 'monthly' | 'yearly';
  tax_pct: number;
  active: number;
  created_at: string;
  updated_at: string;
}

export interface CrmLineItemRow {
  id: string;
  user_id: string;
  deal_id: string;
  product_id: string | null;
  name: string;
  sku: string;
  description: string;
  quantity: number;
  unit_price: number;
  discount_pct: number;
  tax_pct: number;
  recurring: string;
  position: number;
  created_at: string;
  updated_at: string;
}

export type CrmQuoteStatus = 'draft' | 'sent' | 'accepted' | 'declined' | 'expired';

export interface CrmQuoteRow {
  id: string;
  user_id: string;
  deal_id: string;
  number: string;
  title: string;
  status: CrmQuoteStatus;
  token: string;
  currency: string;
  items: string; // JSON QuoteItemSnapshot[]
  subtotal: number;
  discount_total: number;
  tax_total: number;
  total: number;
  expires_at: string | null;
  terms: string;
  notes: string;
  sender_name: string;
  sender_email: string;
  sender_company: string;
  recipient_name: string;
  recipient_email: string;
  recipient_company: string;
  created_by: string | null;
  sent_at: string | null;
  accepted_at: string | null;
  declined_at: string | null;
  signer_name: string;
  signer_ip_hash: string;
  decline_reason: string;
  created_at: string;
  updated_at: string;
}

export interface CrmImportPresetRow {
  id: string;
  user_id: string;
  entity: string;
  name: string;
  mapping: string; // JSON { header: field }
  created_at: string;
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
  /** Orden manual entre hermanos (NULL = sin orden manual). */
  position?: number | null;
  small_text?: 0 | 1;
  full_width?: 0 | 1;
  /** Publicada en el centro de ayuda (/h/<handle>/<slug>). */
  published?: 0 | 1;
  slug?: string | null;
  published_at?: string | null;
  /** 1 = la mandó a la papelera la cascada de un ancestro (y vuelve con él). */
  archived_by_parent?: 0 | 1;
  /** 1 = hereda los shares de los ancestros (default); 0 = solo los propios. */
  inherit_shares?: 0 | 1;
  created_at: string;
  updated_at: string;
}

export interface DocsShareRow {
  id: string;
  page_id: string;
  kind: 'public' | 'team' | 'user';
  target_id: string | null;
  /** 'view' | 'edit' (default 'view'). */
  role?: 'view' | 'edit';
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
  /** Marca del workspace en las páginas públicas (migración 035). */
  brand_color: string | null;
  logo_url: string | null;
  display_name: string | null;
  created_at: string;
  updated_at: string;
  /** Links fijos del anfitrión, JSON { zoomUrl, teamsUrl, phone } (063). */
  conferencing: string;
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
  /** Horario reutilizable (027_cal_schedules). NULL = reglas propias en calendar_availability. */
  schedule_id: string | null;
  /** Precio en centavos (0 = gratis) y moneda ISO en minúsculas (027_cal_payments). */
  price_cents: number;
  currency: string;
  /** Reunión única: JSON de inicios ISO elegidos a mano (057). NULL = evento normal. */
  one_off_times: string | null;
  /** Ubicaciones que puede elegir el invitado, JSON [{ kind, value }] (063). */
  locations: string;
  /** round_robin: un host libre del pool; collective: todos los hosts libres (063). */
  scheduling: 'round_robin' | 'collective';
  /** Lugares por horario (0 = una reserva por horario) (063). */
  seats: number;
}

export interface CalendarScheduleRow {
  id: string;
  user_id: string;
  name: string;
  timezone: string;
  is_default: 0 | 1;
  created_at: string;
  updated_at: string;
}

export interface CalendarScheduleRuleRow {
  id: string;
  schedule_id: string;
  day_of_week: number;
  start_time: string;
  end_time: string;
}

export interface CalendarScheduleOverrideRow {
  id: string;
  schedule_id: string;
  date: string;
  start_time: string | null;
  end_time: string | null;
}

export interface CalendarWorkflowStepRow {
  id: string;
  event_type_id: string;
  position: number;
  recipient: 'guest' | 'host';
  offset_min: number;
  subject: string;
  body: string;
  created_at: string;
}

export interface CalendarWorkflowRunRow {
  id: string;
  step_id: string;
  booking_id: string;
  send_at: string;
  sent_at: string | null;
  created_at: string;
}

export interface CalendarPaymentSettingsRow {
  user_id: string;
  stripe_secret_key: string;
  stripe_webhook_secret: string;
  webhook_token: string;
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
  status: 'confirmed' | 'cancelled' | 'no_show' | 'pending';
  answers: string; // JSON object
  cancel_reason: string | null;
  host_user_id: string | null;
  created_at: string;
  updated_at: string;
  manage_token: string | null;
  rescheduled_from: string | null;
  google_event_id: string | null;
  meeting_url: string | null;
  locale: string;
  /** none | pending | paid | expired (027_cal_payments). */
  payment_status: 'none' | 'pending' | 'paid' | 'expired' | 'refunded';
  hold_expires_at: string | null;
  stripe_session_id: string | null;
  amount_cents: number;
  currency: string;
  /** Buffers propios al reservar (040_cal_booking_buffers): protegen también a la reserva existente. */
  buffer_before_min: number;
  buffer_after_min: number;
  /** utm_* de la página de reserva, JSON (050_cal_booking_utm_approval). */
  utm: string;
  /** Confirmación del anfitrión: none | pending | approved | declined (050). */
  approval: 'none' | 'pending' | 'approved' | 'declined';
  /** Invitados extra del invitado principal, JSON string[] de emails (057). */
  guests: string;
  /** Ubicación elegida ya resuelta (link, dirección o teléfono) y su tipo (063). */
  location: string;
  location_kind: string;
  /** Co-anfitriones de un evento colectivo, JSON string[] de user ids (063). */
  co_host_ids: string;
  /** 1 = ocupa un lugar de un horario compartido (063). */
  seated: 0 | 1;
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
  /** Si ninguna regla matchea: event (default_event_type_id) | url | message (063). */
  fallback_action: 'event' | 'url' | 'message';
  fallback_url: string;
  fallback_message: string;
  /** Las respuestas viajan al destino (página de reserva o URL) (063). */
  pass_answers: 0 | 1;
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
  /** NULL cuando la regla termina en una URL o un mensaje (063). */
  event_type_id: string | null;
  position: number;
  action: 'event' | 'url' | 'message';
  target_url: string;
  message: string;
}

export interface CalendarRoutingSubmissionRow {
  id: string;
  form_id: string;
  answers: string; // JSON object
  /** event | url | message | none */
  outcome: string;
  /** Slug del evento, URL o '' (mensaje / sin ruta). */
  target: string;
  rule_id: string | null;
  created_at: string;
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
  /** 1 = los issues creados desde afuera entran a la cola de triage. */
  triage_enabled?: number;
  /** 1 = Track crea los cycles solo (cada `cycle_weeks` semanas) y arrastra lo sin terminar. */
  cycle_auto?: number;
  cycle_weeks?: number;
  /** Prefijo del nombre de los cycles automáticos ("Cycle" → "Cycle 4"). */
  cycle_name?: string;
  /** Último día (UTC) en que el tick revisó los cycles automáticos. */
  cycle_auto_day?: string | null;
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
  /** Cuándo se completó (a mano o por el arrastre automático). */
  completed_at?: string | null;
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
  /** Origen: 'app' | 'api' | 'chat' | 'flow' | 'github' | 'agent'. */
  source?: string;
  /** 1 = pendiente en la cola de triage del proyecto. */
  triage?: number;
  milestone_id?: string | null;
  created_at: string;
  updated_at: string;
}

export interface TrackMilestoneRow {
  id: string;
  project_id: string;
  name: string;
  description: string;
  target_date: string | null;
  created_at: string;
  updated_at: string;
}

export interface TrackIssueTemplateRow {
  id: string;
  project_id: string;
  name: string;
  title: string;
  description: string;
  status_id: string | null;
  priority: 'urgent' | 'high' | 'medium' | 'low' | null;
  assignee_id: string | null;
  estimate: number | null;
  labels: string; // JSON TrackLabel[]
  created_at: string;
  updated_at: string;
}

export type TrackRecurringFrequency = 'daily' | 'weekly' | 'monthly' | 'yearly';

export interface TrackRecurringIssueRow {
  id: string;
  project_id: string;
  creator_id: string;
  title: string;
  description: string;
  status_id: string | null;
  priority: 'urgent' | 'high' | 'medium' | 'low';
  assignee_id: string | null;
  labels: string; // JSON TrackLabel[]
  frequency: TrackRecurringFrequency;
  every: number;
  start_on: string;
  next_run_on: string;
  due_days: number | null;
  timezone: string;
  active: number;
  last_issue_id: string | null;
  last_run_at: string | null;
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
  /** Última edición del autor (null si nunca se editó). */
  updated_at: string | null;
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
  bot_source: 'canned' | 'docs' | 'ai' | 'agent';
  /** Agente que responde cuando bot_source = 'agent' (lib/agents-chat.ts). */
  agent_id?: string | null;
  office_hours: string | null; // JSON OfficeHoursConfig
  /** Pestaña "Ayuda" del widget con artículos publicados de Docs. */
  help_enabled?: 0 | 1;
  /** Idioma del widget embebido: 'auto' (página / navegador) o fijo. */
  locale?: 'auto' | 'en' | 'es' | 'pt';
  /** Minutos sin leer antes de mandar por email una respuesta del agente (0 = nunca). */
  offline_email_minutes?: number;
  /** JSON ChatAttributeDef[]: atributos de conversación (lib/chat-attributes.ts). */
  conversation_attributes?: string;
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
  /**
   * 1 si el email está verificado: firmado por el sitio con el secreto del
   * widget (HMAC) o cargado por alguien del equipo. 0 = lo declaró el widget.
   */
  email_verified?: 0 | 1;
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
  /** JSON objeto id de atributo → valor (lib/chat-attributes.ts). */
  attributes?: string;
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
  /** Nota interna: solo la ven los agentes. */
  is_note?: 0 | 1;
  /** Última edición de su autor (marca "editado"). */
  edited_at?: string | null;
  /** Borrado por su autor: el visitante no lo ve más; el inbox muestra la marca. */
  deleted_at?: string | null;
  /** Claim del aviso por email al visitante (lib/chat-offline-email.ts). */
  offline_email_at?: string | null;
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
  /** JSON CannedActions (macro): status, assign, tag, snooze. */
  actions?: string;
  created_at: string;
  updated_at: string;
}

export interface NotificationRow {
  id: string;
  user_id: string;
  type: 'mention' | 'assigned' | 'status_change' | 'comment' | 'subtask' | 'relation' | 'chat_message' | 'issue_update' | 'track_reminder';
  title: string;
  body: string | null;
  href: string | null;
  read_at: string | null;
  source_type: string;
  source_id: string;
  meta: string;
  /** Pospuesto hasta esta fecha (no aparece en la bandeja ni cuenta como sin leer). */
  snoozed_until?: string | null;
  created_at: string;
}

export interface AiUsageRow {
  id: string;
  user_id: string; // workspace (dueño)
  feature: string;
  model: string;
  input_tokens: number;
  output_tokens: number;
  created_at: string;
}

export type RoadmapItemStatus = 'proposed' | 'idea' | 'considering' | 'planned' | 'in_progress' | 'done' | 'declined';
export type RoadmapItemKind = 'idea' | 'bug';

export interface RoadmapItemRow {
  id: string;
  title: string;
  description: string;
  product: string; // PRODUCT_KEYS (lib/product-taxonomy.ts)
  kind: RoadmapItemKind;
  status: RoadmapItemStatus;
  votes: number; // señales + votos (usuarios + IP legado), recalculado con COUNT
  is_public: number; // 0/1: visible en el board (moderación)
  shipped_changelog_id: string | null;
  author_id: string | null; // quien lo propuso en el board (null si vino del feedback)
  declined_reason: string | null; // motivo visible cuando status = declined
  comment_count: number;
  status_changed_at: string | null;
  created_at: string;
  updated_at: string;
}

export interface RoadmapSignalRow {
  id: string;
  item_id: string;
  source: 'feedback' | 'chat';
  source_id: string; // feedback.id o chat_conversations.id
  excerpt: string;
  created_at: string;
}

/** Un voto por usuario por ítem; los votos por IP anteriores al board quedan como legado. */
export interface RoadmapVoteRow {
  id: string;
  item_id: string;
  user_id: string | null;
  ip_hash: string | null; // HMAC-SHA256 de la IP (legado, nunca la IP en claro)
  created_at: string;
}

export interface RoadmapCommentRow {
  id: string;
  item_id: string;
  user_id: string | null;
  body: string; // HTML sanitizado (párrafos, links, énfasis)
  is_official: number; // 0/1: respuesta oficial "Equipo zerosoft"
  pinned: number; // 0/1
  created_at: string;
  updated_at: string;
}

export interface RoadmapStatusEventRow {
  id: string;
  item_id: string;
  from_status: string | null;
  to_status: string;
  note: string | null;
  actor_id: string | null;
  changelog_id: string | null;
  created_at: string;
}

export interface RoadmapSubscriptionRow {
  item_id: string;
  user_id: string;
  reason: 'author' | 'vote' | 'comment' | 'manual';
  active: number; // 0 = desuscripto (no se vuelve a suscribir solo)
  locale: string; // idioma de los emails (el del board cuando se suscribió)
  created_at: string;
}

export interface ChangelogEntryRow {
  id: string; // ancla (#id) e id del feed
  date: string; // yyyy-mm-dd
  title_en: string;
  title_es: string;
  title_pt: string;
  body_en: string; // markdown
  body_es: string;
  body_pt: string;
  products: string; // JSON ProductKey[]
  published: number; // 0/1
  created_by: string | null;
  created_at: string;
  updated_at: string;
}

// ---------- Flow (automatizaciones) ----------

export interface FlowFlowRow {
  id: string;
  user_id: string; // workspace (dueño)
  name: string;
  description: string;
  enabled: number; // 0 | 1
  graph: string; // JSON FlowGraph
  version: number;
  trigger_type: string | null;
  trigger_event: string | null;
  next_run_at: string | null; // ISO
  error_flow_id: string | null; // flow que corre cuando una corrida falla
  failure_alerts?: number; // 0 | 1: email al dueño cuando una corrida falla
  auto_replay?: number; // 0 | 1: replay automático de corridas fallidas
  failure_email_at?: string | null; // último aviso de falla (tope: uno por hora)
  pinned_data?: string; // JSON { nodeId: salida fijada } para probar un paso solo
  created_by: string | null;
  created_at: string;
  updated_at: string;
}

export interface FlowTableRow {
  id: string;
  user_id: string; // workspace
  name: string;
  columns: string; // JSON FlowTableColumn[]
  created_by: string | null;
  created_at: string;
  updated_at: string;
}

export interface FlowTableDataRow {
  id: string;
  table_id: string;
  user_id: string;
  data: string; // JSON { columna: valor }
  created_at: string;
  updated_at: string;
}

export interface FlowVersionRow {
  id: string;
  flow_id: string;
  user_id: string;
  version: number;
  name: string;
  graph: string; // JSON FlowGraph
  created_by: string | null;
  created_at: string;
}

export interface FlowCredentialRow {
  id: string;
  user_id: string; // workspace
  name: string;
  type: string;
  data: string; // cifrado (lib/flow-credentials.ts)
  hint: string; // pista enmascarada (últimos caracteres)
  /** Secreto TOTP (2FA) cifrado con lib/secret-box; NULL si no tiene. */
  totp_secret?: string | null;
  created_by: string | null;
  created_at: string;
  updated_at: string;
}

export type FlowRunStatus = 'queued' | 'running' | 'success' | 'failed' | 'waiting';

export interface FlowRunRow {
  id: string;
  flow_id: string;
  user_id: string;
  trigger_type: string;
  status: FlowRunStatus;
  input: string; // JSON
  context: string; // JSON (salidas de nodos, para reanudar)
  error: string | null;
  chain_depth: number;
  chain_seen: string; // JSON string[]
  step_count: number;
  locked_until: string | null;
  rerun_of: string | null; // corrida original (re-ejecución desde un paso)
  parent_run_id: string | null; // corrida que la lanzó (sub-flow o flow de error)
  replay_at?: string | null; // replay automático agendado (corrida fallida)
  created_at: string;
  started_at: string | null;
  finished_at: string | null;
}

export type FlowStepStatus = 'running' | 'success' | 'failed' | 'skipped' | 'waiting';

export interface FlowStepRow {
  id: string;
  run_id: string;
  node_id: string;
  node_type: string;
  status: FlowStepStatus;
  input: string | null;
  output: string | null;
  error: string | null;
  started_at: string;
  finished_at: string | null;
}

export interface FlowJobRow {
  id: string;
  run_id: string;
  node_id: string;
  run_at: string;
  attempts: number;
  locked_until: string | null;
  payload: string; // JSON
  created_at: string;
}

export interface FlowSettingsRow {
  user_id: string; // workspace
  retention_days: number; // días que se guardan corridas y pasos
  locale: string; // idioma de los avisos por email
  updated_at: string;
}

export interface FlowWebhookRow {
  id: string;
  flow_id: string;
  user_id: string;
  node_id: string;
  token: string;
  created_at: string;
}

// ---------- Notes ----------

export interface NoteNotebookRow {
  id: string;
  workspace_id: string; // dueño del workspace
  person_id: string; // persona real (las notas son personales)
  name: string;
  created_at: string;
  updated_at: string;
}

export interface NoteRow {
  id: string;
  workspace_id: string;
  person_id: string;
  notebook_id: string | null;
  title: string;
  content: string; // JSON DocsBlock[]
  body_text: string; // texto plano (búsqueda, snippet, AI)
  tags: string; // JSON string[]
  pinned: number; // 0/1
  source_url: string | null;
  share_token: string | null;
  trashed_at: string | null;
  created_at: string;
  updated_at: string;
}

// ---------- Board ----------

export interface BoardRow {
  id: string;
  workspace_id: string;
  created_by: string | null;
  updated_by: string | null;
  name: string;
  scene: string; // JSON { elements, appState, files }
  scene_bytes: number;
  thumbnail: string | null; // SVG chico (opcional)
  version: number;
  share_token: string | null;
  /** 'workspace' = todo el team la edita; 'restricted' = solo quien la creó, admins y board_members. */
  access?: string;
  /** Link de invitado con edición (/b/e/<token>), sin login. */
  edit_token?: string | null;
  /** Timer compartido del taller: fin (ISO) si corre, segundos restantes si está en pausa. */
  timer_ends_at?: string | null;
  timer_seconds?: number | null;
  timer_paused_left?: number | null;
  created_at: string;
  updated_at: string;
}

/** Imagen de una pizarra guardada con lib/uploads.ts (file_id = id de Excalidraw). */
export interface BoardFileRow {
  board_id: string;
  file_id: string;
  workspace_id: string;
  url: string;
  mime: string;
  size: number;
  created_at: string;
}

/** Foto de la escena (una por hora de edición como mucho). */
export interface BoardSnapshotRow {
  id: string;
  board_id: string;
  workspace_id: string;
  scene: string;
  scene_bytes: number;
  element_count: number;
  thumbnail: string | null;
  version: number;
  edited_by: string | null;
  content_at: string; // cuándo se guardó ese contenido
  taken_at: string; // cuándo se sacó la foto
}

export interface BoardCommentThreadRow {
  id: string;
  board_id: string;
  workspace_id: string;
  x: number;
  y: number;
  element_id: string | null;
  created_by: string | null;
  resolved_at: string | null;
  resolved_by: string | null;
  created_at: string;
  updated_at: string;
}

export interface BoardCommentRow {
  id: string;
  thread_id: string;
  board_id: string;
  author_id: string | null;
  body: string; // markdown
  created_at: string;
  updated_at: string;
}

// ---------- Agents (agentes de AI) ----------

export interface AgentRow {
  id: string;
  user_id: string; // workspace (dueño)
  name: string;
  emoji: string;
  instructions: string;
  welcome_message: string;
  model: string | null; // override "proveedor/modelo"; null = el de la instancia
  temperature: number;
  knowledge: string; // JSON AgentKnowledgeConfig
  tools: string; // JSON AgentToolsConfig
  handoff: string; // JSON AgentHandoffConfig
  guardrails: string; // JSON AgentGuardrailsConfig
  enabled: number; // 0 | 1
  public_handle: string | null; // /a/<handle>
  /** JSON AgentSecretHeaderStored[]: headers de http_request con el valor cifrado (secret-box). */
  http_secrets?: string;
  /** 1 = email al dueño cuando suben los pulgares abajo, errores o topes de pasos (lib/agents-alerts.ts). */
  alerts_enabled?: number;
  created_by: string | null;
  created_at: string;
  updated_at: string;
}

export interface AgentKnowledgeUrlRow {
  id: string;
  agent_id: string;
  user_id: string;
  url: string;
  title: string;
  content: string;
  status: 'pending' | 'ok' | 'error';
  error: string | null;
  fetched_at: string | null;
  created_at: string;
}

export type AgentChannel = 'playground' | 'public' | 'api' | 'chat';

export interface AgentConversationRow {
  id: string;
  agent_id: string;
  user_id: string;
  channel: AgentChannel;
  chat_conversation_id: string | null;
  visitor_key: string | null;
  title: string;
  handed_off: number; // 0 | 1
  /** 'flow' = la abrió un nodo de Flow (channel 'api'); NULL = el canal. */
  source?: string | null;
  created_by: string | null;
  created_at: string;
  updated_at: string;
}

export interface AgentMessageRow {
  id: string;
  conversation_id: string;
  role: 'user' | 'assistant' | 'system';
  content: string;
  run_id: string | null;
  /** Persona del equipo que respondió (después de una derivación); NULL = el agente. */
  author_id?: string | null;
  created_at: string;
}

export interface AgentToolCallRow {
  id: string;
  agent_id: string;
  user_id: string;
  conversation_id: string;
  run_id: string;
  tool: string;
  input: string; // JSON
  output: string | null; // JSON
  error: string | null;
  duration_ms: number;
  created_at: string;
}

export interface AgentFeedbackRow {
  id: string;
  agent_id: string;
  user_id: string;
  conversation_id: string;
  message_id: string;
  rating: number; // 1 | -1
  note: string;
  created_by: string | null;
  created_at: string;
}

export interface AgentTestCaseRow {
  id: string;
  agent_id: string;
  user_id: string;
  question: string;
  expected: string;
  last_status: 'pass' | 'fail' | 'error' | null;
  last_reason: string;
  last_reply: string;
  last_tools: string; // JSON AgentTestToolSummary[]
  last_run_at: string | null;
  created_by: string | null;
  created_at: string;
  updated_at: string;
}

// ---------- Robots ----------

export type RobotRunStatus = 'queued' | 'running' | 'success' | 'failed';
export type RobotRunTrigger = 'manual' | 'flow' | 'schedule' | 'api' | 'agent';

export interface RobotRow {
  id: string;
  user_id: string; // workspace (dueño)
  name: string;
  description: string;
  steps: string; // JSON RobotStep[]
  inputs: string; // JSON RobotInputDef[]
  enabled: number; // 0 | 1 (apagado: no corre por Flow ni por schedule)
  schedule: string | null; // JSON RobotSchedule
  next_run_at: string | null;
  timeout_sec: number;
  persist_session: number; // 0 | 1 (cookies/localStorage entre corridas)
  failure_alerts: number; // 0 | 1 (email al dueño si falla una corrida automática)
  pause_after: number; // fallas seguidas que pausan el schedule (0 = nunca)
  consecutive_failures: number;
  last_alert_at: string | null;
  paused_at: string | null; // pausado solo por fallas seguidas
  alert_locale: string;
  retention_days: number; // 0 = ROBOTS_RUN_RETENTION_DAYS
  created_by: string | null;
  created_at: string;
  updated_at: string;
}

export interface RobotRunRow {
  id: string;
  robot_id: string;
  user_id: string;
  status: RobotRunStatus;
  trigger: RobotRunTrigger;
  input: string; // JSON
  output: string; // JSON (variables extraídas)
  error: string | null;
  logs: string; // JSON RobotLogEntry[]
  screenshots: string; // JSON [{ name, url }]
  backend: string | null;
  created_by: string | null;
  locked_until: string | null;
  created_at: string;
  started_at: string | null;
  finished_at: string | null;
  duration_ms: number | null;
  warnings: number; // pasos / elementos de loop que fallaron con continueOnError
  failure: string | null; // JSON RobotRunFailure (captura, URL y DOM del paso que falló)
  /** Lote de la API v1 (bulk) al que pertenece la corrida. */
  batch_id?: string | null;
  /** La salida cambió contra la corrida exitosa anterior (1/0; NULL sin comparar). */
  changed?: number | null;
}

// ---------- CRM: formularios, scoring, equipos, cuotas ----------

export interface CrmFormRow {
  id: string;
  user_id: string;
  name: string;
  slug: string | null;
  token: string;
  status: 'active' | 'paused' | 'archived';
  fields: string; // JSON FormField[]
  settings: string; // JSON FormSettings
  submission_count: number;
  created_by: string | null;
  created_at: string;
  updated_at: string;
}

export interface CrmFormSubmissionRow {
  id: string;
  form_id: string;
  user_id: string;
  contact_id: string | null;
  contact_created: number;
  data: string; // JSON Record<string, string | boolean>
  utm: string; // JSON
  page_url: string;
  referrer: string;
  ip_hash: string;
  user_agent: string;
  created_at: string;
}

export interface CrmScoreRuleRow {
  id: string;
  user_id: string;
  name: string;
  kind: 'property' | 'activity';
  config: string; // JSON
  points: number;
  enabled: number;
  position: number;
  created_at: string;
  updated_at: string;
}

export interface CrmSalesTeamRow {
  id: string;
  user_id: string;
  name: string;
  created_at: string;
}

export interface CrmQuotaRow {
  id: string;
  user_id: string;
  person_id: string;
  metric: 'won_value' | 'won_count' | 'meetings';
  period: 'month' | 'quarter';
  target: number;
  created_at: string;
  updated_at: string;
}
