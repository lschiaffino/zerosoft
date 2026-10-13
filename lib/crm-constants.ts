/**
 * CRM — constantes puro-cliente (no importa server-only lib/db).
 */

export const LIFECYCLE_STAGES = [
  'subscriber',
  'lead',
  'mql',
  'sql',
  'opportunity',
  'customer',
  'evangelist',
] as const;
export const LEAD_STATUSES = [
  'new',
  'open',
  'in_progress',
  'open_deal',
  'unqualified',
  'connected',
  'bad_timing',
] as const;
export const SOURCES = ['organic', 'referral', 'ads', 'social', 'email', 'event', 'other'] as const;
export const ACTIVITY_TYPES = ['note', 'task', 'call', 'meeting', 'email'] as const;
export const PRIORITIES = ['low', 'medium', 'high'] as const;

export type LifecycleStage = (typeof LIFECYCLE_STAGES)[number];
export type LeadStatus = (typeof LEAD_STATUSES)[number];
export type Source = (typeof SOURCES)[number];
export type ActivityType = (typeof ACTIVITY_TYPES)[number];
export type Priority = (typeof PRIORITIES)[number];

// ---------- Modelo nivel HubSpot (asociaciones, tags, productos, quotes) ----------

/** Labels de la asociación contacto ↔ empresa ('' = sin label). "Primaria" es un flag aparte. */
export const CONTACT_COMPANY_LABELS = [
  'employee',
  'decision_maker',
  'billing',
  'champion',
  'influencer',
  'former_employee',
] as const;
export type ContactCompanyLabel = (typeof CONTACT_COMPANY_LABELS)[number];

/** Colores de tags = paleta de acentos de producto (var(--c-<key>)). */
export const TAG_COLORS = [
  'crm',
  'link',
  'cal',
  'track',
  'chat',
  'docs',
  'flow',
  'agents',
  'notes',
  'board',
  'robots',
] as const;
export type TagColor = (typeof TAG_COLORS)[number];

export const TAG_ENTITIES = ['contact', 'company', 'deal'] as const;
export type TagEntity = (typeof TAG_ENTITIES)[number];

export const RECURRING_INTERVALS = ['none', 'monthly', 'yearly'] as const;
export type RecurringInterval = (typeof RECURRING_INTERVALS)[number];

export const QUOTE_STATUSES = ['draft', 'sent', 'accepted', 'declined', 'expired'] as const;
export type QuoteStatus = (typeof QUOTE_STATUSES)[number];

/** Monedas sugeridas en los selectores (se acepta cualquier código ISO de 3 letras). */
export const COMMON_CURRENCIES = [
  'USD',
  'EUR',
  'GBP',
  'ARS',
  'BRL',
  'MXN',
  'CLP',
  'COP',
  'PEN',
  'UYU',
  'CAD',
  'AUD',
  'JPY',
  'CHF',
] as const;
