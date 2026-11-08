/**
 * Emails de ciclo de vida: tipos compartidos entre las señales, las reglas,
 * las plantillas y el cron. Ver lib/lifecycle/scheduler.ts.
 */
import type { ProductKey } from '../products';

export type LifecycleLocale = 'en' | 'es' | 'pt';

/**
 * Categorías que una persona puede apagar por separado (Ajustes › Avisos y
 * el link de baja de cada email). El digest es opcional: arranca apagado.
 */
export const LIFECYCLE_CATEGORIES = ['onboarding', 'tips', 'team', 'reengagement', 'digest'] as const;
export type LifecycleCategory = (typeof LIFECYCLE_CATEGORIES)[number];

export function isLifecycleCategory(v: unknown): v is LifecycleCategory {
  return typeof v === 'string' && (LIFECYCLE_CATEGORIES as readonly string[]).includes(v);
}

export const LIFECYCLE_TEMPLATES = [
  'welcome',
  'setup_first_item',
  'setup_import',
  'setup_calendar',
  'setup_whatsapp',
  'team_invite',
  'team_pending',
  'feature_assistant',
  'feature_voice',
  'feature_desktop',
  'feature_mcp',
  'tip_search',
  'reengage',
  'digest',
] as const;
export type LifecycleTemplate = (typeof LIFECYCLE_TEMPLATES)[number];

export const TEMPLATE_CATEGORY: Record<LifecycleTemplate, LifecycleCategory> = {
  welcome: 'onboarding',
  setup_first_item: 'onboarding',
  setup_import: 'onboarding',
  setup_calendar: 'onboarding',
  setup_whatsapp: 'onboarding',
  team_invite: 'team',
  team_pending: 'team',
  feature_assistant: 'tips',
  feature_voice: 'tips',
  feature_desktop: 'tips',
  feature_mcp: 'tips',
  tip_search: 'tips',
  reengage: 'reengagement',
  digest: 'digest',
};

/**
 * Lo que sabemos de una persona para elegir el próximo email. Lo arma un
 * SignalsSource (lib/lifecycle/signals.ts): hoy lee las tablas de cada app;
 * cuando el módulo de estado del onboarding exista, puede venir de ahí.
 */
export interface LifecycleSignals {
  userId: string;
  email: string;
  name: string | null;
  locale: LifecycleLocale;
  timeZone: string;
  createdAt: string;
  onboardedAt: string | null;
  /** Apps que eligió (app de entrada, objetivos, la de su herramienta de origen). */
  apps: ProductKey[];
  /** Herramienta de la que viene (users.profile.sourceTool) si tiene importador. */
  sourceTool: string | null;
  role: string | null;
  /** Dueño del workspace activo (los datos de las apps cuelgan de su id) y su ficha. */
  workspaceOwnerId: string;
  teamId: string | null;
  /** Owner o admin de un workspace de equipo. */
  isTeamAdmin: boolean;
  teamName: string | null;
  memberCount: number;
  pendingInvites: number;
  /** El invite pendiente más viejo (ISO), si hay. */
  oldestPendingInviteAt: string | null;
  createdFirstItem: Partial<Record<ProductKey, boolean>>;
  imported: boolean;
  calendarConnected: boolean;
  whatsappConnected: boolean;
  desktopInstalled: boolean;
  usedVoice: boolean;
  usedAssistant: boolean;
  usedMcp: boolean;
}

export interface LifecycleStateRow {
  user_id: string;
  legacy: number;
  created_at: string;
  last_active_at: string | null;
  next_check_at: string | null;
  claimed_until: string | null;
  done_at: string | null;
}

export interface SentRecord {
  key: string;
  template: LifecycleTemplate;
  category: LifecycleCategory;
  at: string;
}

export interface EmailPrefs {
  unsubscribedAll: boolean;
  optedOut: LifecycleCategory[];
  digest: boolean;
}

export const DEFAULT_PREFS: EmailPrefs = { unsubscribedAll: false, optedOut: [], digest: false };

export function categoryAllowed(prefs: EmailPrefs, category: LifecycleCategory): boolean {
  if (prefs.unsubscribedAll) return false;
  if (category === 'digest') return prefs.digest && !prefs.optedOut.includes('digest');
  return !prefs.optedOut.includes(category);
}
