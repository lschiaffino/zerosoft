/**
 * Reglas de los emails de ciclo de vida, sin base ni red (se testean solas).
 *
 * Elige como mucho UN email por vez, en este orden:
 *   1. Bienvenida (día 0, cuando terminó el onboarding o pasaron 2 horas).
 *   2. Tope de frecuencia: nada si el último salió hace menos de 2 días.
 *   3. Reenganche si hace 14 días que no entra (2 como mucho, separados 30 días).
 *   4. Nada si entró hoy (en su zona horaria): el email sobra.
 *   5. El paso de configuración que le falta, después invitar al equipo (admins),
 *      después la función que no usó y sirve para sus apps, y al final tips.
 *   6. Si no queda nada o la cuenta tiene más de 30 días, la serie terminó.
 * El digest semanal va aparte (digestKey): es opcional y no cuenta para el tope.
 */
import type { ProductKey } from '../products';
import {
  categoryAllowed,
  TEMPLATE_CATEGORY,
  type EmailPrefs,
  type LifecycleCategory,
  type LifecycleSignals,
  type LifecycleStateRow,
  type LifecycleTemplate,
  type SentRecord,
} from './types';

const HOUR = 3_600_000;
const DAY = 24 * HOUR;

export const LIFECYCLE_LIMITS = {
  /** Entre dos emails de la serie (el digest no cuenta). */
  minGapMs: 2 * DAY,
  /** La bienvenida sale solo en los primeros días. */
  welcomeWindowMs: 3 * DAY,
  /** Sin terminar el onboarding, la bienvenida espera esto desde el alta. */
  welcomeGraceMs: 2 * HOUR,
  /** Después de esto la serie de configuración y tips termina. */
  sequenceWindowMs: 30 * DAY,
  inactiveMs: 14 * DAY,
  reengageMax: 2,
  reengageGapMs: 30 * DAY,
  pendingInviteMs: 3 * DAY,
  /** El digest necesita una semana de cuenta. */
  digestMinAgeMs: 7 * DAY,
  /** Hora local desde la que sale el digest del lunes. */
  digestHour: 8,
} as const;

/** Apps donde "crear lo primero" tiene sentido como paso de configuración. */
export const FIRST_ITEM_APPS: ProductKey[] = ['docs', 'track', 'crm', 'notes', 'board', 'link', 'cal'];

/** Herramientas de origen con importador (las mismas que SOURCE_TOOLS con importHref). */
export const IMPORT_HREFS: Record<string, string> = {
  hubspot: '/app/crm/settings?tab=import&from=hubspot',
  pipedrive: '/app/crm/settings?tab=import&from=pipedrive',
  notion: '/app/docs/import',
  linear: '/app/track/settings?tab=import',
  jira: '/app/track/settings?tab=import',
  github: '/app/track/settings?tab=import',
  calendly: '/app/calendar/settings?tab=import',
  bitly: '/app/links/settings?tab=import',
};

export interface Candidate {
  template: LifecycleTemplate;
  key: string;
  app?: ProductKey;
}

export type LifecycleDecision =
  | { action: 'send'; template: LifecycleTemplate; category: LifecycleCategory; key: string; app?: ProductKey }
  | { action: 'wait'; reason: string; until: string }
  | { action: 'done'; reason: string };

export interface RuleInput {
  signals: LifecycleSignals;
  state: Pick<LifecycleStateRow, 'legacy' | 'created_at' | 'last_active_at' | 'done_at'>;
  sent: SentRecord[];
  prefs: EmailPrefs;
  now: Date;
}

/**
 * Milisegundos de una fecha de la base: ISO o "YYYY-MM-DD HH:MM:SS" de
 * datetime('now'), que es UTC (new Date lo leería como hora local).
 */
export function parseTime(v: string | null | undefined): number {
  if (!v) return 0;
  const s = /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}(:\d{2})?$/.test(v) ? `${v.replace(' ', 'T')}Z` : v;
  const t = new Date(s).getTime();
  return Number.isNaN(t) ? 0 : t;
}

/** Fecha local (YYYY-MM-DD) en la zona de la persona; UTC si la zona no sirve. */
export function localDate(at: Date, timeZone: string): string {
  try {
    return new Intl.DateTimeFormat('en-CA', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit' }).format(at);
  } catch {
    return at.toISOString().slice(0, 10);
  }
}

function localWeekdayHour(at: Date, timeZone: string): { weekday: number; hour: number } {
  try {
    const parts = new Intl.DateTimeFormat('en-US', { timeZone, weekday: 'short', hour: 'numeric', hourCycle: 'h23' }).formatToParts(at);
    const wd = parts.find((p) => p.type === 'weekday')?.value ?? 'Mon';
    const hour = Number(parts.find((p) => p.type === 'hour')?.value ?? '0');
    return { weekday: ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].indexOf(wd), hour };
  } catch {
    return { weekday: at.getUTCDay(), hour: at.getUTCHours() };
  }
}

/** Semana ISO (2026-W45) del día local: la clave del digest. */
export function isoWeek(at: Date, timeZone: string): string {
  const [y, m, d] = localDate(at, timeZone).split('-').map(Number);
  const date = new Date(Date.UTC(y, m - 1, d));
  const day = date.getUTCDay() || 7;
  date.setUTCDate(date.getUTCDate() + 4 - day);
  const yearStart = new Date(Date.UTC(date.getUTCFullYear(), 0, 1));
  const week = Math.ceil(((date.getTime() - yearStart.getTime()) / DAY + 1) / 7);
  return `${date.getUTCFullYear()}-W${String(week).padStart(2, '0')}`;
}

/** ¿Entró hoy, en su día local? */
export function activeToday(lastActiveAt: string | null, now: Date, timeZone: string): boolean {
  if (!lastActiveAt) return false;
  const last = new Date(lastActiveAt);
  if (Number.isNaN(last.getTime())) return false;
  return localDate(last, timeZone) === localDate(now, timeZone);
}

function relevantToApps(apps: ProductKey[], wanted: ProductKey[]): boolean {
  return apps.length === 0 || apps.some((a) => wanted.includes(a));
}

/**
 * Los emails de la serie que todavía tienen sentido para esta persona, en
 * orden de utilidad. No mira lo ya enviado ni las preferencias.
 */
export function sequenceCandidates(s: LifecycleSignals, now: Date): Candidate[] {
  const out: Candidate[] = [];
  // 1. Configuración: lo primero en su app de entrada, importar, conectar.
  const entry = s.apps.find((a) => FIRST_ITEM_APPS.includes(a));
  if (entry && !s.createdFirstItem[entry]) out.push({ template: 'setup_first_item', key: `setup:first:${entry}`, app: entry });
  if (s.sourceTool && IMPORT_HREFS[s.sourceTool] && !s.imported) out.push({ template: 'setup_import', key: `setup:import:${s.sourceTool}` });
  if (s.apps.includes('cal') && !s.calendarConnected) out.push({ template: 'setup_calendar', key: 'setup:calendar' });
  if (s.apps.includes('groups') && !s.whatsappConnected) out.push({ template: 'setup_whatsapp', key: 'setup:whatsapp' });
  // 2. Equipo: solo para quien puede invitar en un workspace de equipo.
  if (s.isTeamAdmin && s.memberCount <= 1) {
    const stale = s.oldestPendingInviteAt && now.getTime() - parseTime(s.oldestPendingInviteAt) >= LIFECYCLE_LIMITS.pendingInviteMs;
    if (s.pendingInvites === 0) out.push({ template: 'team_invite', key: 'team:invite' });
    else if (stale) out.push({ template: 'team_pending', key: 'team:pending' });
  }
  // 3. Funciones que no usó, si sirven para lo que eligió.
  if (!s.usedAssistant) out.push({ template: 'feature_assistant', key: 'feature:assistant' });
  if (!s.usedVoice && relevantToApps(s.apps, ['voice', 'notes', 'docs', 'cal', 'crm', 'track'])) out.push({ template: 'feature_voice', key: 'feature:voice' });
  if (!s.desktopInstalled) out.push({ template: 'feature_desktop', key: 'feature:desktop' });
  const technical = s.role === 'engineering' || s.role === 'product' || s.role === 'founder';
  if (!s.usedMcp && (technical || relevantToApps(s.apps, ['track', 'docs', 'crm']))) out.push({ template: 'feature_mcp', key: 'feature:mcp' });
  // 4. Tips.
  out.push({ template: 'tip_search', key: 'tip:search' });
  return out;
}

function iso(ms: number): string {
  return new Date(ms).toISOString();
}

/** El próximo email de la serie para esta persona, o por qué no hay. */
export function decideNext(input: RuleInput): LifecycleDecision {
  const { signals: s, state, sent, prefs, now } = input;
  const t = now.getTime();
  if (prefs.unsubscribedAll) return { action: 'done', reason: 'unsubscribed_all' };
  const sentKeys = new Set(sent.map((r) => r.key));
  const created = parseTime(state.created_at);
  const age = t - created;
  const legacy = state.legacy === 1;

  // 1. Bienvenida.
  if (!legacy && !sentKeys.has('welcome') && age < LIFECYCLE_LIMITS.welcomeWindowMs && categoryAllowed(prefs, 'onboarding')) {
    if (!s.onboardedAt && age < LIFECYCLE_LIMITS.welcomeGraceMs) {
      return { action: 'wait', reason: 'welcome_grace', until: iso(created + LIFECYCLE_LIMITS.welcomeGraceMs) };
    }
    return { action: 'send', template: 'welcome', category: 'onboarding', key: 'welcome' };
  }
  if (legacy) return { action: 'done', reason: 'legacy' };

  // 2. Tope de frecuencia (el digest no cuenta).
  const series = sent.filter((r) => r.category !== 'digest');
  const lastAt = series.reduce((m, r) => Math.max(m, parseTime(r.at)), 0);
  if (lastAt && t - lastAt < LIFECYCLE_LIMITS.minGapMs) {
    return { action: 'wait', reason: 'frequency', until: iso(lastAt + LIFECYCLE_LIMITS.minGapMs) };
  }

  // 3. Reenganche.
  const lastActive = parseTime(state.last_active_at ?? state.created_at);
  if (t - lastActive >= LIFECYCLE_LIMITS.inactiveMs) {
    const reengages = sent.filter((r) => r.template === 'reengage');
    const lastRe = reengages.reduce((m, r) => Math.max(m, parseTime(r.at)), 0);
    const reAfterActivity = lastRe > lastActive;
    if (categoryAllowed(prefs, 'reengagement') && reengages.length < LIFECYCLE_LIMITS.reengageMax) {
      if (!reAfterActivity || t - lastRe >= LIFECYCLE_LIMITS.reengageGapMs) {
        return { action: 'send', template: 'reengage', category: 'reengagement', key: `reengage:${reengages.length + 1}` };
      }
      return { action: 'wait', reason: 'reengage_gap', until: iso(lastRe + LIFECYCLE_LIMITS.reengageGapMs) };
    }
    // Inactiva y sin reenganche posible: no se le manda la serie a quien no entra.
    return state.done_at ? { action: 'done', reason: 'inactive' } : { action: 'wait', reason: 'inactive', until: iso(t + 7 * DAY) };
  }

  if (state.done_at) return { action: 'done', reason: 'sequence_done' };
  if (age >= LIFECYCLE_LIMITS.sequenceWindowMs) return { action: 'done', reason: 'sequence_window' };

  // 4. Si entró hoy, nada: lo vemos mañana.
  if (activeToday(state.last_active_at, now, s.timeZone)) {
    return { action: 'wait', reason: 'active_today', until: iso(t + 6 * HOUR) };
  }

  // 5. Lo más útil que falta.
  for (const c of sequenceCandidates(s, now)) {
    if (sentKeys.has(c.key)) continue;
    const category = TEMPLATE_CATEGORY[c.template];
    if (!categoryAllowed(prefs, category)) continue;
    return { action: 'send', template: c.template, category, key: c.key, ...(c.app ? { app: c.app } : {}) };
  }
  return { action: 'done', reason: 'nothing_left' };
}

/** Clave del digest de esta semana si toca mandarlo ahora (lunes desde las 8 locales), o null. */
export function digestKey(input: Pick<RuleInput, 'signals' | 'state' | 'sent' | 'prefs' | 'now'>): string | null {
  const { signals: s, state, sent, prefs, now } = input;
  if (!categoryAllowed(prefs, 'digest')) return null;
  if (now.getTime() - parseTime(state.created_at) < LIFECYCLE_LIMITS.digestMinAgeMs) return null;
  const { weekday, hour } = localWeekdayHour(now, s.timeZone);
  if (weekday !== 1 || hour < LIFECYCLE_LIMITS.digestHour) return null;
  const key = `digest:${isoWeek(now, s.timeZone)}`;
  return sent.some((r) => r.key === key) ? null : key;
}
