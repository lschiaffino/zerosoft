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
