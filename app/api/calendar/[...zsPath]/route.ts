// Generado por scripts/consolidate-routes.mjs: no editar a mano.
// Agrupa rutas dinámicas en un solo catch-all para no pasar el límite de
// rutas de Vercel. Los handlers viven en lib/routes/ (ver docs/routes-budget.md).
import { createDispatcher } from '@/lib/routes/dispatch';
import * as m0 from '@/lib/routes/calendar/blocked-slots/[id]/route';
import * as m1 from '@/lib/routes/calendar/bookings/[id]/route';
import * as m2 from '@/lib/routes/calendar/bookings/[id]/approval/route';
import * as m3 from '@/lib/routes/calendar/bookings/[id]/reschedule/route';
import * as m4 from '@/lib/routes/calendar/bookings/[id]/slots/route';
import * as m5 from '@/lib/routes/calendar/bookings/manage/[token]/route';
import * as m6 from '@/lib/routes/calendar/event-types/[id]/route';
import * as m7 from '@/lib/routes/calendar/event-types/[id]/availability/route';
import * as m8 from '@/lib/routes/calendar/event-types/[id]/slots/route';
import * as m9 from '@/lib/routes/calendar/event-types/[id]/workflows/route';
import * as m10 from '@/lib/routes/calendar/payments/webhook/[token]/route';
import * as m11 from '@/lib/routes/calendar/poll-votes/[token]/route';
import * as m12 from '@/lib/routes/calendar/polls/[id]/route';
import * as m13 from '@/lib/routes/calendar/polls/[id]/book/route';
import * as m14 from '@/lib/routes/calendar/routing/[id]/route';
import * as m15 from '@/lib/routes/calendar/routing/[id]/fields/route';
import * as m16 from '@/lib/routes/calendar/routing/[id]/fields/[fieldId]/route';
import * as m17 from '@/lib/routes/calendar/routing/[id]/route/route';
import * as m18 from '@/lib/routes/calendar/routing/[id]/rules/route';
import * as m19 from '@/lib/routes/calendar/routing/[id]/rules/[ruleId]/route';
import * as m20 from '@/lib/routes/calendar/routing/[id]/submissions/route';
import * as m21 from '@/lib/routes/calendar/schedules/[id]/route';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const d = createDispatcher('zsPath', [
  { pattern: 'blocked-slots/[id]', mod: m0 }, // lib/routes/calendar/blocked-slots/[id]
  { pattern: 'bookings/[id]', mod: m1 }, // lib/routes/calendar/bookings/[id]
  { pattern: 'bookings/[id]/approval', mod: m2 }, // lib/routes/calendar/bookings/[id]/approval
  { pattern: 'bookings/[id]/reschedule', mod: m3 }, // lib/routes/calendar/bookings/[id]/reschedule
  { pattern: 'bookings/[id]/slots', mod: m4 }, // lib/routes/calendar/bookings/[id]/slots
  { pattern: 'bookings/manage/[token]', mod: m5 }, // lib/routes/calendar/bookings/manage/[token]
  { pattern: 'event-types/[id]', mod: m6 }, // lib/routes/calendar/event-types/[id]
  { pattern: 'event-types/[id]/availability', mod: m7 }, // lib/routes/calendar/event-types/[id]/availability
  { pattern: 'event-types/[id]/slots', mod: m8 }, // lib/routes/calendar/event-types/[id]/slots
  { pattern: 'event-types/[id]/workflows', mod: m9 }, // lib/routes/calendar/event-types/[id]/workflows
  { pattern: 'payments/webhook/[token]', mod: m10 }, // lib/routes/calendar/payments/webhook/[token]
  { pattern: 'poll-votes/[token]', mod: m11 }, // lib/routes/calendar/poll-votes/[token]
  { pattern: 'polls/[id]', mod: m12 }, // lib/routes/calendar/polls/[id]
  { pattern: 'polls/[id]/book', mod: m13 }, // lib/routes/calendar/polls/[id]/book
  { pattern: 'routing/[id]', mod: m14 }, // lib/routes/calendar/routing/[id]
  { pattern: 'routing/[id]/fields', mod: m15 }, // lib/routes/calendar/routing/[id]/fields
  { pattern: 'routing/[id]/fields/[fieldId]', mod: m16 }, // lib/routes/calendar/routing/[id]/fields/[fieldId]
  { pattern: 'routing/[id]/route', mod: m17 }, // lib/routes/calendar/routing/[id]/route
  { pattern: 'routing/[id]/rules', mod: m18 }, // lib/routes/calendar/routing/[id]/rules
  { pattern: 'routing/[id]/rules/[ruleId]', mod: m19 }, // lib/routes/calendar/routing/[id]/rules/[ruleId]
  { pattern: 'routing/[id]/submissions', mod: m20 }, // lib/routes/calendar/routing/[id]/submissions
  { pattern: 'schedules/[id]', mod: m21 }, // lib/routes/calendar/schedules/[id]
]);

export const GET = d.GET;
export const HEAD = d.HEAD;
export const OPTIONS = d.OPTIONS;
export const POST = d.POST;
export const PUT = d.PUT;
export const DELETE = d.DELETE;
export const PATCH = d.PATCH;
