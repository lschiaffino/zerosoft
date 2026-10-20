import type { ChatWidgetRow } from '@/lib/db';
import type { OfficeHoursConfig, OfficeHoursDay } from '@/lib/chat-data';

/** Pestañas del editor del widget (?tab=). La primera es la default. */
export const WIDGET_TABS = ['look', 'form', 'bot', 'hours'] as const;
export type WidgetTab = (typeof WIDGET_TABS)[number];

export function widgetTab(raw: string | null | undefined): WidgetTab {
  return WIDGET_TABS.includes(raw as WidgetTab) ? (raw as WidgetTab) : 'look';
}

export interface WidgetFormField {
  id: string;
  name: string;
  required: boolean;
  type: 'text' | 'email' | 'number';
}

export interface WidgetFormValues {
  name: string;
  color: string;
  position: 'bottom-right' | 'bottom-left';
  welcomeMessage: string;
  botEnabled: boolean;
  botGreeting: string;
  botSource: 'canned' | 'docs' | 'ai' | 'agent';
  helpEnabled: boolean;
  locale: 'auto' | 'en' | 'es' | 'pt';
  /** Minutos sin leer antes de avisar por email al visitante (0 = nunca). */
  offlineEmailMinutes: number;
}

/** Opciones del aviso por email de respuestas sin leer (minutos; 0 = apagado). */
export const OFFLINE_EMAIL_OPTIONS = [0, 5, 10, 30, 60] as const;

export interface OfficeHoursState {
  enabled: boolean;
  timezone: string;
  days: OfficeHoursDay[];
}

function newId(): string {
  try {
    return crypto.randomUUID();
  } catch {
    return Math.random().toString(36).slice(2);
  }
}

export function emptyField(): WidgetFormField {
  return { id: newId(), name: '', required: false, type: 'text' };
}

export function initialValues(w: ChatWidgetRow): WidgetFormValues {
  return {
    name: w.name,
    color: w.color || '#111111',
    position: w.position === 'bottom-left' ? 'bottom-left' : 'bottom-right',
    welcomeMessage: w.welcome_message ?? '',
    botEnabled: w.bot_enabled === 1,
    botGreeting: w.bot_greeting ?? '',
    botSource: w.bot_source ?? 'canned',
    helpEnabled: w.help_enabled === 1,
    locale: w.locale ?? 'auto',
    offlineEmailMinutes: typeof w.offline_email_minutes === 'number' ? w.offline_email_minutes : 10,
  };
}

export function parseFields(raw: string | null | undefined): WidgetFormField[] {
  if (!raw) return [];
  try {
    const list = JSON.parse(raw) as unknown[];
    if (!Array.isArray(list)) return [];
    return list
      .filter((f): f is Record<string, unknown> => typeof f === 'object' && f !== null)
      .map((f) => ({
        id: typeof f.id === 'string' ? f.id : newId(),
        name: typeof f.name === 'string' ? f.name : '',
        required: f.required === true,
        type: ['text', 'email', 'number'].includes(typeof f.type === 'string' ? f.type : '')
          ? (f.type as WidgetFormField['type'])
          : 'text',
      }));
  } catch {
    return [];
  }
}

/** Índice 0 = domingo … 6 = sábado (Date.getDay). Lunes a viernes de 9 a 18. */
export function defaultDays(): OfficeHoursDay[] {
  return Array.from({ length: 7 }, (_, i) => ({ enabled: i >= 1 && i <= 5, start: '09:00', end: '18:00' }));
}

export function guessTimezone(): string {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';
  } catch {
    return 'UTC';
  }
}

export function parseOfficeHours(raw: string | null | undefined, fallbackZone = guessTimezone()): OfficeHoursState {
  const fallback = { enabled: false, timezone: fallbackZone, days: defaultDays() };
  if (!raw) return fallback;
  try {
    const parsed = JSON.parse(raw) as Partial<OfficeHoursConfig>;
    if (typeof parsed.timezone !== 'string' || !Array.isArray(parsed.days) || parsed.days.length !== 7) {
      return fallback;
    }
    return {
      enabled: true,
      timezone: parsed.timezone,
      days: parsed.days.map((d) => ({
        enabled: d?.enabled === true,
        start: typeof d?.start === 'string' ? d.start : '09:00',
        end: typeof d?.end === 'string' ? d.end : '18:00',
      })),
    };
  } catch {
    return fallback;
  }
}

/** Tope de un objetivo de SLA: 30 días, igual que slaPoliciesUpdateSchema. */
export const SLA_MAX_MINUTES = 43_200;

/** Minutos enteros entre 1 y SLA_MAX_MINUTES; vacío solo si el campo es opcional. */
export function isValidMinutes(value: string, allowEmpty: boolean): boolean {
  const trimmed = value.trim();
  if (trimmed === '') return allowEmpty;
  const n = Number(trimmed);
  return Number.isInteger(n) && n >= 1 && n <= SLA_MAX_MINUTES;
}

/**
 * Cuerpo del PATCH /api/chat/widgets/:id. Las cuatro pestañas guardan el
 * widget entero: lo que se tocó en otra pestaña sin guardar también viaja.
 * Los campos sin nombre se descartan y el id de cada campo sale del estado.
 */
export function buildWidgetPayload(values: WidgetFormValues, fields: WidgetFormField[], office: OfficeHoursState) {
  return {
    name: values.name.trim(),
    color: values.color,
    position: values.position,
    welcomeMessage: values.welcomeMessage.trim() || undefined,
    fields: fields
      .filter((f) => f.name.trim())
      .map((f) => ({ id: f.id, name: f.name.trim(), required: f.required, type: f.type })),
    botEnabled: values.botEnabled,
    botGreeting: values.botGreeting.trim() || undefined,
    botSource: values.botSource,
    officeHours: office.enabled ? { timezone: office.timezone.trim() || 'UTC', days: office.days } : null,
    helpEnabled: values.helpEnabled,
    locale: values.locale,
    offlineEmailMinutes: values.offlineEmailMinutes,
  };
}
