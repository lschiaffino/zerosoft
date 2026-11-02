// Generado por scripts/mcp-catalog.mjs: no editar a mano.
import * as r0 from "@/app/api/calendar/activity/route";
import * as r1 from "@/app/api/calendar/analytics/export/route";
import * as r2 from "@/app/api/calendar/blocked-slots/route";
import * as r3 from "@/lib/routes/calendar/blocked-slots/[id]/route";
import * as r4 from "@/app/api/calendar/bookings/route";
import * as r5 from "@/lib/routes/calendar/bookings/[id]/route";
import * as r6 from "@/lib/routes/calendar/bookings/[id]/approval/route";
import * as r7 from "@/lib/routes/calendar/bookings/[id]/reschedule/route";
import * as r8 from "@/lib/routes/calendar/bookings/[id]/slots/route";
import * as r9 from "@/app/api/calendar/bookings/export/route";
import * as r10 from "@/app/api/calendar/bookings/schedule/route";
import * as r11 from "@/app/api/calendar/calendars/route";
import * as r12 from "@/app/api/calendar/config/route";
import * as r13 from "@/app/api/calendar/event-types/route";
import * as r14 from "@/lib/routes/calendar/event-types/[id]/route";
import * as r15 from "@/lib/routes/calendar/event-types/[id]/availability/route";
import * as r16 from "@/lib/routes/calendar/event-types/[id]/slots/route";
import * as r17 from "@/lib/routes/calendar/event-types/[id]/workflows/route";
import * as r18 from "@/app/api/calendar/icloud/route";
import * as r19 from "@/app/api/calendar/outlook/disconnect/route";
import * as r20 from "@/app/api/calendar/payments/route";
import * as r21 from "@/app/api/calendar/polls/route";
import * as r22 from "@/lib/routes/calendar/polls/[id]/route";
import * as r23 from "@/lib/routes/calendar/polls/[id]/book/route";
import * as r24 from "@/app/api/calendar/privacy/route";
import * as r25 from "@/app/api/calendar/routing/route";
import * as r26 from "@/lib/routes/calendar/routing/[id]/route";
import * as r27 from "@/lib/routes/calendar/routing/[id]/fields/route";
import * as r28 from "@/lib/routes/calendar/routing/[id]/fields/[fieldId]/route";
import * as r29 from "@/lib/routes/calendar/routing/[id]/rules/route";
import * as r30 from "@/lib/routes/calendar/routing/[id]/rules/[ruleId]/route";
import * as r31 from "@/lib/routes/calendar/routing/[id]/submissions/route";
import * as r32 from "@/app/api/calendar/schedules/route";
import * as r33 from "@/lib/routes/calendar/schedules/[id]/route";
import * as r34 from "@/app/api/calendar/sms/route";
import * as r35 from "@/app/api/calendar/zoom/route";

export const routes: Record<string, unknown> = {
  "/api/calendar/activity": r0,
  "/api/calendar/analytics/export": r1,
  "/api/calendar/blocked-slots": r2,
  "/api/calendar/blocked-slots/[id]": r3,
  "/api/calendar/bookings": r4,
  "/api/calendar/bookings/[id]": r5,
  "/api/calendar/bookings/[id]/approval": r6,
  "/api/calendar/bookings/[id]/reschedule": r7,
  "/api/calendar/bookings/[id]/slots": r8,
  "/api/calendar/bookings/export": r9,
  "/api/calendar/bookings/schedule": r10,
  "/api/calendar/calendars": r11,
  "/api/calendar/config": r12,
  "/api/calendar/event-types": r13,
  "/api/calendar/event-types/[id]": r14,
  "/api/calendar/event-types/[id]/availability": r15,
  "/api/calendar/event-types/[id]/slots": r16,
  "/api/calendar/event-types/[id]/workflows": r17,
  "/api/calendar/icloud": r18,
  "/api/calendar/outlook/disconnect": r19,
  "/api/calendar/payments": r20,
  "/api/calendar/polls": r21,
  "/api/calendar/polls/[id]": r22,
  "/api/calendar/polls/[id]/book": r23,
  "/api/calendar/privacy": r24,
  "/api/calendar/routing": r25,
  "/api/calendar/routing/[id]": r26,
  "/api/calendar/routing/[id]/fields": r27,
  "/api/calendar/routing/[id]/fields/[fieldId]": r28,
  "/api/calendar/routing/[id]/rules": r29,
  "/api/calendar/routing/[id]/rules/[ruleId]": r30,
  "/api/calendar/routing/[id]/submissions": r31,
  "/api/calendar/schedules": r32,
  "/api/calendar/schedules/[id]": r33,
  "/api/calendar/sms": r34,
  "/api/calendar/zoom": r35,
};
