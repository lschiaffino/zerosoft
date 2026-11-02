// Generado por scripts/mcp-catalog.mjs: no editar a mano.
import * as r0 from "@/app/api/people/audit/route";
import * as r1 from "@/app/api/people/calendar/route";
import * as r2 from "@/app/api/people/checklists/route";
import * as r3 from "@/lib/routes/people/checklists/[id]/route";
import * as r4 from "@/app/api/people/cycles/route";
import * as r5 from "@/lib/routes/people/cycles/[id]/route";
import * as r6 from "@/lib/routes/people/cycles/[id]/launch/route";
import * as r7 from "@/app/api/people/documents/route";
import * as r8 from "@/lib/routes/people/documents/[id]/route";
import * as r9 from "@/lib/routes/people/documents/[id]/ack/route";
import * as r10 from "@/app/api/people/employees/route";
import * as r11 from "@/lib/routes/people/employees/[id]/route";
import * as r12 from "@/lib/routes/people/employees/[id]/balances/route";
import * as r13 from "@/lib/routes/people/employees/[id]/compensation/route";
import * as r14 from "@/lib/routes/people/employees/[id]/exit-interview/route";
import * as r15 from "@/lib/routes/people/employees/[id]/goals/route";
import * as r16 from "@/lib/routes/people/employees/[id]/offboard/route";
import * as r17 from "@/lib/routes/people/employees/[id]/one-on-ones/route";
import * as r18 from "@/lib/routes/people/employees/[id]/photo/route";
import * as r19 from "@/app/api/people/export/route";
import * as r20 from "@/app/api/people/fields/route";
import * as r21 from "@/lib/routes/people/fields/[id]/route";
import * as r22 from "@/lib/routes/people/goals/[id]/route";
import * as r23 from "@/app/api/people/handbook/route";
import * as r24 from "@/app/api/people/holidays/route";
import * as r25 from "@/lib/routes/people/holidays/[id]/route";
import * as r26 from "@/app/api/people/me/route";
import * as r27 from "@/lib/routes/people/one-on-ones/[id]/route";
import * as r28 from "@/app/api/people/org/route";
import * as r29 from "@/app/api/people/policies/route";
import * as r30 from "@/lib/routes/people/policies/[id]/route";
import * as r31 from "@/app/api/people/reports/route";
import * as r32 from "@/app/api/people/reviews/route";
import * as r33 from "@/lib/routes/people/reviews/[id]/route";
import * as r34 from "@/app/api/people/settings/route";
import * as r35 from "@/lib/routes/people/tasks/[id]/route";
import * as r36 from "@/app/api/people/templates/route";
import * as r37 from "@/lib/routes/people/templates/[id]/route";
import * as r38 from "@/app/api/people/time-off/route";
import * as r39 from "@/lib/routes/people/time-off/[id]/route";

export const routes: Record<string, unknown> = {
  "/api/people/audit": r0,
  "/api/people/calendar": r1,
  "/api/people/checklists": r2,
  "/api/people/checklists/[id]": r3,
  "/api/people/cycles": r4,
  "/api/people/cycles/[id]": r5,
  "/api/people/cycles/[id]/launch": r6,
  "/api/people/documents": r7,
  "/api/people/documents/[id]": r8,
  "/api/people/documents/[id]/ack": r9,
  "/api/people/employees": r10,
  "/api/people/employees/[id]": r11,
  "/api/people/employees/[id]/balances": r12,
  "/api/people/employees/[id]/compensation": r13,
  "/api/people/employees/[id]/exit-interview": r14,
  "/api/people/employees/[id]/goals": r15,
  "/api/people/employees/[id]/offboard": r16,
  "/api/people/employees/[id]/one-on-ones": r17,
  "/api/people/employees/[id]/photo": r18,
  "/api/people/export": r19,
  "/api/people/fields": r20,
  "/api/people/fields/[id]": r21,
  "/api/people/goals/[id]": r22,
  "/api/people/handbook": r23,
  "/api/people/holidays": r24,
  "/api/people/holidays/[id]": r25,
  "/api/people/me": r26,
  "/api/people/one-on-ones/[id]": r27,
  "/api/people/org": r28,
  "/api/people/policies": r29,
  "/api/people/policies/[id]": r30,
  "/api/people/reports": r31,
  "/api/people/reviews": r32,
  "/api/people/reviews/[id]": r33,
  "/api/people/settings": r34,
  "/api/people/tasks/[id]": r35,
  "/api/people/templates": r36,
  "/api/people/templates/[id]": r37,
  "/api/people/time-off": r38,
  "/api/people/time-off/[id]": r39,
};
