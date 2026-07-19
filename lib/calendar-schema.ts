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
  timezone: z.string().trim().max(64).optional(),
  weekStart: z.number().int().min(0).max(6).optional(),
  bufferBeforeMin: z.number().int().min(0).optional(),
  bufferAfterMin: z.number().int().min(0).optional(),
  minNoticeHours: z.number().int().min(0).optional(),
  maxBookingDays: z.number().int().min(1).optional(),
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
  inviteeEmail: email,
  inviteeName: shortText,
  startsAt: isoDate,
  endsAt: isoDate,
  timezone: z.string().trim().max(64).optional(),
  answers: z.record(z.unknown()).optional(),
});

export const bookingUpdateSchema = z.object({
  status: bookingStatus.optional(),
  cancelReason: longText.nullish(),
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
