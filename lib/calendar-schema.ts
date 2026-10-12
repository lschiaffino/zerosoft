/**
 * Calendar — schemas zod para payloads de rutas API.
 */
import { z } from 'zod';

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
const email = z
  .string()
  .trim()
  .min(1)
  .max(320)
  .regex(/^[^\s@]+@[^\s@]+\.[^\s@]+$/, { message: 'invalid_email' });

const bookingStatus = z.enum(['confirmed', 'cancelled', 'no_show']);

const bookingRules = z
  .object({
    bufferBeforeMin: z.number().int().min(0).optional(),
    bufferAfterMin: z.number().int().min(0).optional(),
    minNoticeHours: z.number().int().min(0).optional(),
    maxFutureDays: z.number().int().min(1).optional(),
    allowGuests: z.boolean().optional(),
  })
  .optional();

const customField = z.object({
  name: z.string().trim().min(1).max(64).regex(/^[a-z][a-z0-9_]*$/),
  label: shortText,
  type: z.enum(['text', 'number', 'boolean']),
  required: z.boolean().optional(),
});

// ---------- Config ----------

export const calendarConfigUpdateSchema = z.object({
  handle: z.string().trim().toLowerCase().min(3).max(32).optional(),
  timezone: z
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
    }, 'invalid_timezone')
    .optional(),
  weekStart: z.number().int().min(0).max(6).optional(),
  bufferBeforeMin: z.number().int().min(0).optional(),
  bufferAfterMin: z.number().int().min(0).optional(),
  minNoticeHours: z.number().int().min(0).optional(),
  maxBookingDays: z.number().int().min(1).optional(),
});

// ---------- Event types ----------

const logoUrl = z
  .string()
  .trim()
  .max(500)
  .regex(/^(https:\/\/|http:\/\/|\/)/, { message: 'invalid_input' });

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
});

export const eventTypeUpdateSchema = eventTypeCreateSchema.partial();

// ---------- Availability ----------

export const availabilityCreateSchema = z.object({
  eventTypeId: id,
  dayOfWeek: z.number().int().min(0).max(6),
  startTime: time,
  endTime: time,
});

export const availabilityBatchSchema = z.object({
  rules: z.array(
    z.object({
      dayOfWeek: z.number().int().min(0).max(6),
      startTime: time,
      endTime: time,
    }),
  ),
});

// ---------- Blocked slots ----------

export const blockedSlotCreateSchema = z.object({
  startsAt: isoDate,
  endsAt: isoDate,
  reason: longText.nullish(),
});

export const blockedSlotUpdateSchema = blockedSlotCreateSchema.partial();

// ---------- Bookings ----------

export const bookingCreateSchema = z.object({
  eventTypeId: id,
  email: email,
  name: shortText,
  start: isoDate,
  timezone: z.string().trim().max(64).optional(),
  answers: z.record(z.unknown()).optional(),
});

export const bookingUpdateSchema = z.object({
  status: bookingStatus.optional(),
  cancelReason: longText.nullish(),
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
