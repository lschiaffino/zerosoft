/**
 * Calendar — schemas zod para payloads de rutas API.
 */
import { z } from 'zod';
import { MAX_PERIOD_LIMIT, SLOT_INTERVAL_MAX, SLOT_INTERVAL_MIN } from './calendar-limits';
import { isValidRedirectUrl } from './calendar-redirect';

// ---------- Primitivas ----------

const id = z.string().min(1).max(64);
const shortText = z.string().trim().max(200);
const longText = z.string().trim().max(2000);
const slug = z
  .string()
  .trim()
  .min(1)
  .max(64)
  .regex(/^[a-z0-9-]+$/, { message: 'invalid_slug' });
const hexColor = z
  .string()
  .trim()
  .regex(/^#[0-9A-Fa-f]{6}$/, { message: 'invalid_color' });
const time = z
  .string()
  .trim()
  .regex(/^([01]\d|2[0-3]):([0-5]\d)$/, { message: 'invalid_time' });
const isoDate = z.string().trim().min(1);
/** Nombre de persona en una línea: sin saltos ni caracteres de control (va a headers y al .ics). */
// eslint-disable-next-line no-control-regex
export const personName = shortText.regex(/^[^\x00-\x1f\x7f]*$/, { message: 'invalid_name' });
const email = z
  .string()
  .trim()
  .min(1)
  .max(320)
  .regex(/^[^\s@]+@[^\s@]+\.[^\s@]+$/, { message: 'invalid_email' });

const bookingStatus = z.enum(['confirmed', 'cancelled', 'no_show']);

const periodLimit = z.number().int().min(1).max(MAX_PERIOD_LIMIT).optional();
/** Topes de reuniones por día, semana y mes (en la zona del horario del evento). */
const periodLimits = z.object({ day: periodLimit, week: periodLimit, month: periodLimit });

const bookingRules = z
  .object({
    bufferBeforeMin: z.number().int().min(0).optional(),
    bufferAfterMin: z.number().int().min(0).optional(),
    minNoticeHours: z.number().int().min(0).optional(),
    maxFutureDays: z.number().int().min(1).optional(),
    allowGuests: z.boolean().optional(),
    /** Cada cuánto se ofrece un inicio (sin el campo: la duración). */
    slotIntervalMin: z.number().int().min(SLOT_INTERVAL_MIN).max(SLOT_INTERVAL_MAX).optional(),
    /** Topes del tipo de evento (todas sus reservas) y de cada host (las suyas de este evento). */
    meetingLimits: periodLimits.optional(),
    hostMeetingLimits: periodLimits.optional(),
    /** La reserva queda pendiente hasta que el anfitrión la confirme. */
    requiresConfirmation: z.boolean().optional(),
    /** Destino del invitado después de reservar (http/https) y si lleva los datos de la reserva. */
    redirectUrl: z
      .string()
      .trim()
      .max(2000)
      .refine(isValidRedirectUrl, { message: 'invalid_redirect' })
      .optional(),
    redirectPassDetails: z.boolean().optional(),
  })
  .optional();

const customField = z.object({
  name: z.string().trim().min(1).max(64).regex(/^[a-z][a-z0-9_]*$/),
  label: shortText,
  type: z.enum(['text', 'number', 'boolean']),
  required: z.boolean().optional(),
});

const logoUrl = z
  .string()
  .trim()
  .max(500)
  .regex(/^(https:\/\/|http:\/\/|\/)/, { message: 'invalid_input' });

// ---------- Config ----------

/** Zona horaria IANA válida (Intl la acepta). */
export const ianaTimezone = z
  .string()
  .trim()
  .max(64)
  .refine((tz) => {
    try {
      new Intl.DateTimeFormat('en', { timeZone: tz });
      return true;
    } catch {
      return false;
    }
  }, 'invalid_timezone');

export const calendarConfigUpdateSchema = z.object({
  handle: z.string().trim().toLowerCase().min(3).max(32).optional(),
  timezone: ianaTimezone.optional(),
  weekStart: z.number().int().min(0).max(6).optional(),
  bufferBeforeMin: z.number().int().min(0).optional(),
  bufferAfterMin: z.number().int().min(0).optional(),
  minNoticeHours: z.number().int().min(0).optional(),
  maxBookingDays: z.number().int().min(1).optional(),
  // Marca del workspace en las páginas públicas. null = sin valor.
  brandColor: hexColor.nullish(),
  logoUrl: logoUrl.nullish(),
  displayName: z.string().trim().max(80).nullish(),
});

// ---------- Event types ----------

export const eventTypeCreateSchema = z.object({
  slug,
  title: shortText,
  durationMin: z.number().int().min(1),
  location: longText.optional(),
  description: longText.optional(),
  color: hexColor.optional(),
  active: z.boolean().optional(),
  bookingRules,
  fields: z.array(customField).max(20).optional(),
  teamId: id.nullish(),
  // F3: branding del booking page.
  brandColor: hexColor.nullish(),
  welcomeMessage: longText.optional(),
  logoUrl: logoUrl.nullish(),
  // F3: link de un solo uso.
  singleUse: z.boolean().optional(),
  // F3: pool de hosts (round-robin) — user_ids del team.
  hostIds: z.array(id).max(50).optional(),
  // D9: horario reutilizable y precio (Stripe Checkout).
  scheduleId: id.nullish(),
  priceCents: z.number().int().min(0).max(100_000_000).optional(),
  currency: z.enum(['usd', 'eur', 'ars', 'brl', 'mxn', 'clp', 'cop', 'gbp']).optional(),
});

export const eventTypeUpdateSchema = eventTypeCreateSchema.partial();

// ---------- Availability ----------

export const availabilityCreateSchema = z.object({
  eventTypeId: id,
  dayOfWeek: z.number().int().min(0).max(6),
  startTime: time,
  endTime: time,
});

/** Una franja semanal: el fin tiene que ser posterior al inicio (si no, no genera slots). */
const scheduleRule = z
  .object({ dayOfWeek: z.number().int().min(0).max(6), startTime: time, endTime: time })
  .refine((r) => r.endTime > r.startTime, { message: 'invalid_range' });

export const availabilityBatchSchema = z.object({
  rules: z.array(scheduleRule).max(100),
});

// ---------- Blocked slots ----------

/** Fecha y hora válida, normalizada a ISO UTC (así se compara bien como texto en SQL). */
const isoInstant = isoDate
  .refine((v) => !Number.isNaN(new Date(v).getTime()), { message: 'invalid_date' })
  .transform((v) => new Date(v).toISOString());

const blockedSlotFields = z.object({
  startsAt: isoInstant,
  endsAt: isoInstant,
  reason: longText.nullish(),
});

export const blockedSlotCreateSchema = blockedSlotFields.refine((b) => b.endsAt > b.startsAt, {
  message: 'invalid_range',
  path: ['endsAt'],
});

export const blockedSlotUpdateSchema = blockedSlotFields.partial();

// ---------- Bookings ----------

export const bookingCreateSchema = z.object({
  eventTypeId: id,
  email: email,
  name: personName,
  start: isoDate,
  timezone: ianaTimezone.optional(),
  answers: z
    .record(z.unknown())
    .refine((a) => Object.keys(a).length <= 20, { message: 'too_many_answers' })
    .optional(),
  locale: z.enum(['en', 'es', 'pt']).optional(),
  /** utm_* de la URL de la página de reserva (se limpian con sanitizeUtm). */
  utm: z.record(z.unknown()).optional(),
});

const ANSWER_MAX = 2000;

/**
 * Valida las respuestas de una reserva contra los campos del tipo de evento:
 * solo claves definidas, tipo según el campo, textos de hasta 2000 caracteres
 * y los requeridos completos. Devuelve las respuestas normalizadas o null.
 */
export function validateBookingAnswers(
  fields: Array<Record<string, unknown>>,
  answers: Record<string, unknown> | undefined,
): Record<string, string | number | boolean> | null {
  const input = answers ?? {};
  const defs = new Map<string, z.infer<typeof customField>>();
  for (const f of fields) {
    const parsed = customField.safeParse(f);
    if (parsed.success) defs.set(parsed.data.name, parsed.data);
  }
  for (const key of Object.keys(input)) if (!defs.has(key)) return null;

  const out: Record<string, string | number | boolean> = {};
  for (const field of defs.values()) {
    const raw = input[field.name];
    if (raw === undefined || raw === null || raw === '') {
      if (field.required) return null;
      continue;
    }
    if (field.type === 'boolean') {
      if (typeof raw !== 'boolean') return null;
      if (field.required && !raw) return null;
      out[field.name] = raw;
    } else if (field.type === 'number') {
      const n = typeof raw === 'number' ? raw : typeof raw === 'string' && raw.trim() !== '' ? Number(raw) : NaN;
      if (!Number.isFinite(n)) return null;
      out[field.name] = n;
    } else {
      if (typeof raw !== 'string' || raw.length > ANSWER_MAX) return null;
      const text = raw.trim();
      if (!text) {
        if (field.required) return null;
        continue;
      }
      out[field.name] = text;
    }
  }
  return out;
}

/** Acciones del invitado desde su link de gestión. */
export const bookingManageSchema = z.discriminatedUnion('action', [
  z.object({ action: z.literal('cancel'), reason: z.string().trim().max(500).optional() }),
  z.object({
    action: z.literal('reschedule'),
    start: isoDate,
    timezone: ianaTimezone.optional(),
    locale: z.enum(['en', 'es', 'pt']).optional(),
  }),
]);

export const bookingUpdateSchema = z.object({
  status: bookingStatus.optional(),
  cancelReason: longText.nullish(),
});

/** Respuesta del anfitrión a una reserva que pide confirmación. */
export const bookingApprovalSchema = z.object({
  decision: z.enum(['confirm', 'decline']),
  reason: z.string().trim().max(500).optional(),
});

// ---------- Routing forms ----------

export const routingFormCreateSchema = z.object({
  slug,
  title: shortText,
  description: longText.optional(),
  active: z.boolean().optional(),
  defaultEventTypeId: id.nullish(),
});

export const routingFormUpdateSchema = routingFormCreateSchema.partial();

const routingFieldName = z
  .string()
  .trim()
  .min(1)
  .max(64)
  .regex(/^[a-z][a-z0-9_]*$/, { message: 'invalid_input' });

export const routingFieldCreateSchema = z.object({
  name: routingFieldName,
  label: shortText,
  type: z.enum(['text', 'select', 'boolean']),
  options: z.array(shortText).max(50).optional(),
  required: z.boolean().optional(),
  position: z.number().int().min(0).optional(),
});

export const routingFieldUpdateSchema = routingFieldCreateSchema.partial();

export const routingRuleCreateSchema = z.object({
  fieldId: id,
  operator: z.enum(['is', 'is_not', 'contains', 'truthy']),
  value: z.string().trim().max(200).optional(),
  eventTypeId: id,
  position: z.number().int().min(0).optional(),
});

export const routingRuleUpdateSchema = routingRuleCreateSchema.partial();

export const routingEvaluateSchema = z.object({
  answers: z.record(z.unknown()),
});

// ---------- Tipos inferidos ----------

export type CalendarConfigUpdatePayload = z.infer<typeof calendarConfigUpdateSchema>;
export type EventTypeCreatePayload = z.infer<typeof eventTypeCreateSchema>;
export type EventTypeUpdatePayload = z.infer<typeof eventTypeUpdateSchema>;
export type AvailabilityCreatePayload = z.infer<typeof availabilityCreateSchema>;
export type AvailabilityBatchPayload = z.infer<typeof availabilityBatchSchema>;
export type BlockedSlotCreatePayload = z.infer<typeof blockedSlotCreateSchema>;
export type BlockedSlotUpdatePayload = z.infer<typeof blockedSlotUpdateSchema>;
export type BookingCreatePayload = z.infer<typeof bookingCreateSchema>;
export type BookingUpdatePayload = z.infer<typeof bookingUpdateSchema>;
export type RoutingFormCreatePayload = z.infer<typeof routingFormCreateSchema>;
export type RoutingFormUpdatePayload = z.infer<typeof routingFormUpdateSchema>;
export type RoutingFieldCreatePayload = z.infer<typeof routingFieldCreateSchema>;
export type RoutingFieldUpdatePayload = z.infer<typeof routingFieldUpdateSchema>;
export type RoutingRuleCreatePayload = z.infer<typeof routingRuleCreateSchema>;
export type RoutingRuleUpdatePayload = z.infer<typeof routingRuleUpdateSchema>;

// ---------- Horarios reutilizables (fase D9) ----------

const isoDay = z.string().trim().regex(/^\d{4}-\d{2}-\d{2}$/, { message: 'invalid_date' });

/** Excepción por fecha: sin horas = no disponible; con horas = reemplaza las horas semanales de ese día. */
const scheduleOverride = z
  .object({ date: isoDay, startTime: time.nullish(), endTime: time.nullish() })
  .refine((o) => (!o.startTime && !o.endTime) || (!!o.startTime && !!o.endTime && o.endTime > o.startTime), {
    message: 'invalid_range',
  });

export const scheduleCreateSchema = z.object({
  name: z.string().trim().min(1).max(80),
  timezone: ianaTimezone,
  isDefault: z.boolean().optional(),
  rules: z.array(scheduleRule).max(100).optional(),
  overrides: z.array(scheduleOverride).max(366).optional(),
});

export const scheduleUpdateSchema = scheduleCreateSchema.partial();

export type ScheduleCreatePayload = z.infer<typeof scheduleCreateSchema>;
export type ScheduleUpdatePayload = z.infer<typeof scheduleUpdateSchema>;

// ---------- Reservas: administración del anfitrión ----------

export const bookingListQuerySchema = z.object({
  q: z.string().trim().max(200).optional(),
  status: z.enum(['confirmed', 'cancelled', 'no_show', 'pending']).optional(),
  from: isoDay.optional(),
  to: isoDay.optional(),
  limit: z.coerce.number().int().min(1).max(500).optional(),
});

export const hostRescheduleSchema = z.object({
  start: isoDate,
  timezone: ianaTimezone.optional(),
});

// ---------- Workflows de recordatorio ----------

export const WORKFLOW_MAX_OFFSET_MIN = 60 * 24 * 30;

export const workflowStepSchema = z.object({
  recipient: z.enum(['guest', 'host']),
  /** Minutos relativos al inicio: negativo = antes, positivo = después. */
  offsetMin: z.number().int().min(-WORKFLOW_MAX_OFFSET_MIN).max(WORKFLOW_MAX_OFFSET_MIN),
  subject: z.string().trim().min(1).max(200),
  body: z.string().trim().min(1).max(5000),
});

export const workflowStepsSchema = z.object({ steps: z.array(workflowStepSchema).max(10) });

export type WorkflowStepPayload = z.infer<typeof workflowStepSchema>;

// ---------- Pagos ----------

export const CAL_CURRENCIES = ['usd', 'eur', 'ars', 'brl', 'mxn', 'clp', 'cop', 'gbp'] as const;

export const paymentSettingsSchema = z.object({
  /** '' = borrar. Sin el campo = no cambia. */
  stripeSecretKey: z
    .string()
    .trim()
    .max(300)
    .regex(/^$|^(sk|rk)_(test|live)_[A-Za-z0-9]+$/, { message: 'invalid_key' })
    .optional(),
  stripeWebhookSecret: z
    .string()
    .trim()
    .max(300)
    .regex(/^$|^whsec_[A-Za-z0-9+/=]+$/, { message: 'invalid_key' })
    .optional(),
});
